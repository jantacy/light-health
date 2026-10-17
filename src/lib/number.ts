// 四舍五入到一位小数。先精确到 0.01 消掉浮点误差（72.55 在计算机里是 72.5499…，直接 toFixed(1) 会得到 72.5）。
export const round1 = (v: number) => Math.sign(v) * Math.round(Math.round(Math.abs(v) * 100) / 10) / 10;
