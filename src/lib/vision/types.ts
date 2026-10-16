// 识图结果统一格式。所有数值都是模型估算值，前端保存前允许用户修改。
// grams 为模型估计的重量（克），0 表示无法判断。
export type FoodItem = { name: string; grams: number; calories: number; protein_g: number; carbs_g: number; fat_g: number };

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

export type AnalyzeInput = { image?: Buffer; mime?: string; hint?: string };

export interface VisionProvider {
  name: string;
  model: string;
  // image 和 hint 至少有一个：只有照片=识图；照片+hint=以用户纠正的菜名为准；只有 hint=按名称估算。
  analyze(input: AnalyzeInput): Promise<FoodAnalysis>;
}

export class VisionError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
