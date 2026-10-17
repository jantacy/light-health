// 一道菜（通常对应一张照片）由若干食物项组成，菜的营养是各项之和。grams 为 null 表示未填重量。
// key：食物库键（同义名归一后），数据库按它统计使用次数；旧记录没有这个字段。
export type DishItem = { name: string; key?: string; grams: number | null; calories: number; protein_g: number; carbs_g: number; fat_g: number };
export type Dish = { name: string; calories: number; protein_g: number; carbs_g: number; fat_g: number; image_path: string | null; items?: DishItem[] };

export type Meal = {
  id: string;
  eaten_at: string;
  meal_type: "breakfast" | "lunch" | "dinner" | "snack";
  title: string;
  image_path: string | null;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  notes: string | null;
  dishes: Dish[];
};

export type WeightEntry = { id: string; recorded_on: string; weight_kg: number };
