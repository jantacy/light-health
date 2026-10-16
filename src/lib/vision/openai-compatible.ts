import { parseAnalysis } from "./parse";
import { VisionError, type AnalyzeInput, type VisionProvider } from "./types";

const systemPrompt = `你是饮食记录助手。根据照片和/或用户给出的菜名估算一人份营养，不给医疗建议。
- 按中国家常菜/外卖常见做法估算份量和烹饪用油；看不清的成分不要假装精确。
- 用户给出菜名时，以用户的菜名为准（照片识别可能有误），照片只用来判断份量；用户写了份量就按用户的份量。
- 照片里没有食物且没有菜名时，title 填"未识别到食物"，各数值填 0，confidence 填 low。
只返回一个 JSON 对象，不要输出其他文字，字段：
title（简短中文菜名，多道菜用顿号连接）、calories（总热量 kcal）、protein_g、carbs_g、fat_g（克）、
items（数组，按食物逐项列出，每项 {name, grams（估计重量，克，数字）, calories, protein_g, carbs_g, fat_g}；顶层 calories 等是各项之和）、confidence（high/medium/low）、notes（一句话说明估算依据或不确定点）。
示例：{"title":"番茄炒蛋、米饭","calories":620,"protein_g":20,"carbs_g":85,"fat_g":22,"items":[{"name":"番茄炒蛋","grams":200,"calories":330,"protein_g":16,"carbs_g":20,"fat_g":21},{"name":"米饭","grams":150,"calories":290,"protein_g":4,"carbs_g":65,"fat_g":1}],"confidence":"medium","notes":"用油量按家常做法估算"}`;

// 只按名称+重量估算单项时用的短提示词：输出很少，配合关闭推理，1~3 秒返回。
const itemPrompt = `你是营养估算助手。用户给出一种食物的名称和重量（可能没写重量），按中国常见做法估算这一份的营养。写了重量就严格按这个重量；没写就按常见一人份并给出估计的 grams。
只返回一个 JSON 对象，不要其他文字，格式：{"title":"米饭","calories":232,"protein_g":5.2,"carbs_g":51,"fat_g":0.6,"items":[{"name":"米饭","grams":200,"calories":232,"protein_g":5.2,"carbs_g":51,"fat_g":0.6}],"confidence":"medium","notes":""}`;

export function createOpenAICompatibleProvider(opts: { name: string; baseUrl: string; apiKey: string; model: string }): VisionProvider {
  return {
    name: opts.name,
    model: opts.model,
    async analyze({ image, mime, hint }: AnalyzeInput) {
      const text = image
        ? hint ? `用户确认这道菜是「${hint}」，以这个菜名为准，结合照片判断份量并估算营养。` : "识别这张饮食照片，估算整份餐食的营养。"
        : `没有照片。估算「${hint}」的营养；写了重量就严格按这个重量计算，没写就按常见一人份。title 用这个名称，items 只列这一项。`;
      const userContent: unknown[] = image ? [{ type: "text", text }] : [{ type: "text", text: `食物：${hint}` }];
      if (image) userContent.push({ type: "image_url", image_url: { url: `data:${mime};base64,${image.toString("base64")}` } });
      // 识图保留推理（更准，10~30 秒）；只有文字的单项估算关闭推理（DeepSeek 专有参数）。
      const fast = !image;
      const response = await fetch(`${opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(fast ? 20000 : 55000),
        body: JSON.stringify({
          model: opts.model,
          temperature: 0.1,
          max_tokens: fast ? 600 : 4000, // 推理 token 也计入上限
          ...(fast && opts.name === "deepseek" ? { thinking: { type: "disabled" } } : {}),
          messages: [
            { role: "system", content: fast ? itemPrompt : systemPrompt },
            { role: "user", content: userContent }
          ]
        })
      }).catch((err) => {
        if (err?.name === "TimeoutError") throw new VisionError("AI 响应超时，请再点一次重试。", 503);
        throw err;
      });
      // 用 503 而非 502：Cloudflare 会把源站 502/504 换成自己的非 JSON 错误页。
      if (!response.ok) {
        console.error(`[vision:${opts.name}] HTTP ${response.status}`, (await response.text().catch(() => "")).slice(0, 500));
        if (response.status === 429) throw new VisionError("识图服务繁忙，请稍后重试。", 503);
        throw new VisionError("暂时无法完成识图，请稍后重试或手动填写。", 503);
      }
      const payload = await response.json();
      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) throw new VisionError("识图结果为空，请重试或手动填写。", 503);
      const analysis = parseAnalysis(content, opts.name, opts.model);
      if (!analysis) {
        console.error(`[vision:${opts.name}] unparseable content`, content.slice(0, 500));
        throw new VisionError("识图返回的数据格式不完整，请重试或手动填写。", 503);
      }
      return analysis;
    }
  };
}
