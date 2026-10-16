import { createOpenAICompatibleProvider } from "./openai-compatible";
import type { VisionProvider } from "./types";

export * from "./types";

// 预置的 OpenAI 兼容视觉服务。VISION_BASE_URL / VISION_MODEL 可覆盖默认值。
const presets: Record<string, { baseUrl: string; model: string }> = {
  deepseek: { baseUrl: "https://api.deepseek.com", model: "deepseek-flash" },
  qwen: { baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-vl-max-latest" }
};

export function getVisionProvider(): VisionProvider | null {
  const name = (process.env.VISION_PROVIDER || "deepseek").trim();
  const preset = presets[name];
  // 兼容旧配置：只填了 DEEPSEEK_API_KEY 时仍可用。
  const apiKey = process.env.VISION_API_KEY || (name === "deepseek" ? process.env.DEEPSEEK_API_KEY : undefined);
  const baseUrl = process.env.VISION_BASE_URL || preset?.baseUrl;
  const model = process.env.VISION_MODEL || preset?.model;
  if (!apiKey || !baseUrl || !model) return null;
  return createOpenAICompatibleProvider({ name, baseUrl, apiKey, model });
}
