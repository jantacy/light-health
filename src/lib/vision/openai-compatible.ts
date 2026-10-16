import { parseAnalysis } from "./parse";
import { VisionError, type VisionProvider } from "./types";

const systemPrompt = `你是饮食记录助手。只根据照片估算可见食物的一人份营养，不给医疗建议。
- 按中国家常菜/外卖常见做法估算份量和烹饪用油；看不清的成分不要假装精确。
- 照片里没有食物时，title 填"未识别到食物"，各数值填 0，confidence 填 low。
只返回一个 JSON 对象，不要输出其他文字，字段：
title（简短中文菜名，多道菜用顿号连接）、calories（总热量 kcal）、protein_g、carbs_g、fat_g（克）、
items（数组，每项 {name, portion（如"约200g"、"1碗"）, calories}）、confidence（high/medium/low）、notes（一句话说明估算依据或不确定点）。
示例：{"title":"番茄炒蛋、米饭","calories":620,"protein_g":20,"carbs_g":85,"fat_g":22,"items":[{"name":"番茄炒蛋","portion":"约200g","calories":330},{"name":"米饭","portion":"1碗约150g","calories":290}],"confidence":"medium","notes":"用油量按家常做法估算"}`;

export function createOpenAICompatibleProvider(opts: { name: string; baseUrl: string; apiKey: string; model: string }): VisionProvider {
  return {
    name: opts.name,
    model: opts.model,
    async analyze(jpeg) {
      const response = await fetch(`${opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(25000),
        body: JSON.stringify({
          model: opts.model,
          temperature: 0.1,
          max_tokens: 800,
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: [
                { type: "text", text: "识别这张饮食照片，估算整份餐食的营养。" },
                { type: "image_url", image_url: { url: `data:image/jpeg;base64,${jpeg.toString("base64")}` } }
              ]
            }
          ]
        })
      });
      if (!response.ok) {
        console.error(`[vision:${opts.name}] HTTP ${response.status}`, (await response.text().catch(() => "")).slice(0, 500));
        if (response.status === 429) throw new VisionError("识图服务繁忙，请稍后重试。", 503);
        throw new VisionError("暂时无法完成识图，请稍后重试或手动填写。", 502);
      }
      const payload = await response.json();
      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) throw new VisionError("识图结果为空，请重试或手动填写。", 502);
      const analysis = parseAnalysis(content, opts.name, opts.model);
      if (!analysis) {
        console.error(`[vision:${opts.name}] unparseable content`, content.slice(0, 500));
        throw new VisionError("识图返回的数据格式不完整，请重试或手动填写。", 502);
      }
      return analysis;
    }
  };
}
