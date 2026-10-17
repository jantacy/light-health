// Next.js 服务启动时执行：开启食物库定时更新和饭点提醒（仅 Node 运行时）。
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    (await import("./lib/food-refresh")).startFoodRefresh();
    (await import("./lib/meal-reminders")).startMealReminders();
  }
}
