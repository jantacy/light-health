// 识图结果统一格式。所有数值都是模型估算值，前端保存前允许用户修改。
export type FoodItem = { name: string; portion: string; calories: number };

export type FoodAnalysis = {
  title: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  items: FoodItem[];
  confidence: "low" | "medium" | "high";
  notes: string;
  provider: string;
  model: string;
};

export interface VisionProvider {
  name: string;
  model: string;
  analyze(jpeg: Buffer): Promise<FoodAnalysis>;
}

export class VisionError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
