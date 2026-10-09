/**
 * 十二生肖（鼠牛虎兔龙蛇马羊猴鸡狗猪）——纯函数抽签工具。
 * 用于「四圆并列」布局：为每个座位随机分配一个不重复的生肖 icon。
 */

/** 顺序固定：鼠、牛、虎、兔、龙、蛇、马、羊、猴、鸡、狗、猪 */
export const ZODIACS = [
  { emoji: '🐭', name: '鼠' },
  { emoji: '🐮', name: '牛' },
  { emoji: '🐯', name: '虎' },
  { emoji: '🐰', name: '兔' },
  { emoji: '🐲', name: '龙' },
  { emoji: '🐍', name: '蛇' },
  { emoji: '🐴', name: '马' },
  { emoji: '🐐', name: '羊' },
  { emoji: '🐵', name: '猴' },
  { emoji: '🐔', name: '鸡' },
  { emoji: '🐶', name: '狗' },
  { emoji: '🐷', name: '猪' },
];

export const DEFAULT_SEAT_COUNT = 4;

/**
 * 费雪–耶茨洗牌后取前 count 个，保证互不重复。
 * @param {number} count
 * @param {() => number} rng
 * @returns {number[]} 生肖序号（0..11）
 */
export function pickDistinctZodiacs(count = DEFAULT_SEAT_COUNT, rng = Math.random) {
  const pool = ZODIACS.map((_, i) => i);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }
  return pool.slice(0, Math.min(count, pool.length));
}

/**
 * 生成/校正座位生肖：长度固定为 count，且各不重复。
 * 传入已有的合法且唯一的值会尽量保留，缺失或重复的位置重新补抽。
 * @param {unknown} existing
 * @param {number} count
 * @param {() => number} rng
 * @returns {number[]}
 */
export function normalizeSeatZodiacs(existing, count = DEFAULT_SEAT_COUNT, rng = Math.random) {
  const size = ZODIACS.length;
  const src = Array.isArray(existing) ? existing : [];
  const seen = new Set();
  const result = new Array(count).fill(null);

  for (let i = 0; i < count; i++) {
    const v = src[i];
    if (Number.isInteger(v) && v >= 0 && v < size && !seen.has(v)) {
      seen.add(v);
      result[i] = v;
    }
  }

  const remaining = ZODIACS.map((_, i) => i).filter((i) => !seen.has(i));
  for (let i = remaining.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = remaining[i];
    remaining[i] = remaining[j];
    remaining[j] = tmp;
  }

  let k = 0;
  for (let i = 0; i < count; i++) {
    if (result[i] === null) result[i] = remaining[k++];
  }
  return result;
}

/**
 * 与 normalizeSeatZodiacs 不同：忽略旧值，完全重新抽一组。
 * @param {number} count
 * @param {() => number} rng
 * @returns {number[]}
 */
export function reshuffleZodiacs(count = DEFAULT_SEAT_COUNT, rng = Math.random) {
  return pickDistinctZodiacs(count, rng);
}

export function zodiacEmoji(index) {
  return ZODIACS[index]?.emoji ?? '❔';
}

export function zodiacName(index) {
  return ZODIACS[index]?.name ?? '';
}
