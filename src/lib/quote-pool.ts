// 每日箴言：固定 60 条，积极、健康、简短，分两组，每组 15 条中文 + 15 条英文。
// 首页把它放在日期同一行靠右，和日期之间至少留 5 个字，所以每句宽度不超过约 15 个汉字
// （英文字母按半个汉字算）。新增或替换句子时注意这个宽度。
// 英文统一用小写（风格选择），但专有名词照常大写，所以直接写在句子里，不用 CSS 转换。
const groups = [
  [
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
    "eat well, live well.",
    "small steps every day.",
    "progress, not perfection.",
    "take care of your body.",
    "health is the real wealth.",
    "each meal, a fresh start.",
    "be kind to your body.",
    "drink water, rest, repeat.",
    "slow down and savor it.",
    "strong body, calm mind.",
    "eat slowly, live fully.",
    "move a little more today.",
    "sleep is self-care.",
    "fuel your body with love.",
    "one good meal at a time."
  ],
  [
    "细嚼慢咽，享受每一口。",
    "今天也给身体一点好东西。",
    "蔬菜多一点，心情亮一点。",
    "走一走，烦恼会变轻。",
    "睡个好觉，比什么都重要。",
    "三餐规律，日子就稳了。",
    "八分饱，刚刚好。",
    "认真吃饭的人，运气不会差。",
    "一杯温水，唤醒新的一天。",
    "今天比昨天，多动了一点。",
    "吃好喝好，元气满满。",
    "放下手机，好好吃这顿饭。",
    "给自己一顿用心的饭。",
    "晒晒太阳，心也暖起来。",
    "慢慢来，比较快。",
    "balance beats extremes.",
    "you are worth the effort.",
    "greens make the day.",
    "rest well, rise strong.",
    "consistency is the key.",
    "breathe deep, eat slow.",
    "good food, good mood.",
    "walk it off, feel better.",
    "listen to your body.",
    "little habits, big change.",
    "nourish, don't punish.",
    "today is a fresh plate.",
    "treat your body kindly.",
    "water first, then coffee.",
    "choose what fuels you."
  ]
];

// 轮换：按 30 天一段，两组交替使用，每段内的顺序按段号随机打乱。
// 任意连续 30 天最多跨两段，用的是不同的两组，所以 30 天内不会重复。
// 只由日期决定：同一天所有人看到同一句，离线也能算出来。
const PERIOD = 30;

function shuffled<T>(items: T[], seed: number) {
  const out = [...items];
  let s = seed;
  const rand = () => { // mulberry32
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

export function quoteForDate(date: string) {
  const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
  const period = Math.floor(day / PERIOD);
  return shuffled(groups[period % 2], period)[day % PERIOD];
}
