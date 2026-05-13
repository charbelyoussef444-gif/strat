export const PALETTE = [
  0xff4040, // red
  0x4080ff, // blue
  0xff9020, // orange
  0x40c040, // green
  0xb060ff, // purple
  0xffd040, // yellow
  0x40d0d0, // cyan
  0xff80c0, // pink
  0xffffff, // white
  0x909090, // gray
  0xffd060, // gold
  0x60ff60, // lime
  0xff60ff, // magenta
  0x00bfff, // sky
  0xff4080, // hot pink
  0xa05040, // brown
];

export function colorFromStr(str) {
  if (!str) return 0x888888;
  const s = String(str).replace('#', '');
  return parseInt(s, 16) || 0x888888;
}

export function colorFor(sessionId) {
  if (!sessionId) return 0x888888;
  let hash = 0;
  for (let i = 0; i < sessionId.length; i++) {
    hash = (hash * 31 + sessionId.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

export function darken(hex, amount = 60) {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return (Math.max(0, r - amount) << 16)
       | (Math.max(0, g - amount) << 8)
       |  Math.max(0, b - amount);
}

export function hexStr(hex) {
  return '#' + hex.toString(16).padStart(6, '0');
}
