/**
 * 房间码生成与校验（纯函数）。
 * 字母表刻意去掉易混字符 0/O/1/I/L/U。
 */

export const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
export const ROOM_ID_LENGTH = 6;

/**
 * @param {number} length
 * @param {() => number} rng
 * @param {string} alphabet
 * @returns {string}
 */
export function randomCode(length = ROOM_ID_LENGTH, rng = Math.random, alphabet = ROOM_ALPHABET) {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[Math.floor(rng() * alphabet.length)];
  }
  return out;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isRoomId(value) {
  if (typeof value !== 'string' || value.length !== ROOM_ID_LENGTH) return false;
  for (const ch of value) {
    if (!ROOM_ALPHABET.includes(ch)) return false;
  }
  return true;
}
