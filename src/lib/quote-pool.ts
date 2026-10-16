// 内置的每日箴言：抓取失败或离线时使用。积极、健康、简短。
export const quotePool = [
  "好好吃饭，就是好好爱自己。",
  "慢慢吃，身体会感谢你。",
  "今天的选择，塑造明天的你。",
  "照顾好身体，它是你唯一的家。",
  "不求完美，只求比昨天好一点。",
  "多喝水，多走路，多微笑。",
  "饮食有节，起居有常。",
  "每一餐，都是重新开始的机会。",
  "坚持的意义，在于日积月累。",
  "早睡早起，精神百倍。",
  "健康不是目标，而是生活方式。",
  "温柔对待自己，也是一种自律。",
  "吃得清淡，活得明朗。",
  "小小的坚持，会有大大的改变。",
  "身体是一切的本钱。",
  "Eat well, live well.",
  "Small steps every day.",
  "Progress, not perfection.",
  "Take care of your body.",
  "Health is the real wealth.",
  "Every meal is a fresh start.",
  "Be kind to your body.",
  "Drink water, rest, repeat.",
  "Slow down and savor it.",
  "Strong body, calm mind."
];

// 按日期稳定地挑一句，同一天看到的是同一句。
export function fallbackQuote(date: string) {
  let h = 0;
  for (const c of date) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return quotePool[h % quotePool.length];
}
