export interface Vec2 {
  x: number;
  y: number;
}

export const TAU = Math.PI * 2;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 0..1 로 정규화한 진행도 (t0 이전은 0, t1 이후는 1) */
export function progress(value: number, t0: number, t1: number): number {
  if (t1 <= t0) return value >= t1 ? 1 : 0;
  return clamp((value - t0) / (t1 - t0), 0, 1);
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

export function distSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

export function angleTo(ax: number, ay: number, bx: number, by: number): number {
  return Math.atan2(by - ay, bx - ax);
}

/** -PI..PI 범위로 접습니다 */
export function normalizeAngle(a: number): number {
  let x = a;
  while (x > Math.PI) x -= TAU;
  while (x < -Math.PI) x += TAU;
  return x;
}

/** 두 각의 최소 차이 (0..PI) */
export function angleDiff(a: number, b: number): number {
  return Math.abs(normalizeAngle(a - b));
}

/** 점 (px,py) 에서 방향 dir 로 뻗은 직선까지의 수직 거리. 뒤쪽이면 Infinity */
export function distToRay(ox: number, oy: number, dir: number, px: number, py: number): number {
  const dx = px - ox;
  const dy = py - oy;
  const along = dx * Math.cos(dir) + dy * Math.sin(dir);
  if (along < 0) return Infinity;
  const perp = Math.abs(-dx * Math.sin(dir) + dy * Math.cos(dir));
  return perp;
}

export function circleOverlap(ax: number, ay: number, ar: number, bx: number, by: number, br: number): boolean {
  const r = ar + br;
  return distSq(ax, ay, bx, by) <= r * r;
}
