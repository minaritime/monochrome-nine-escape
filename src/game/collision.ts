import { CANVAS } from '../data/balance';
import type { Enemy } from './types';

const CELL = 80;
const COLS = Math.ceil(CANVAS.w / CELL) + 2;
const ROWS = Math.ceil(CANVAS.h / CELL) + 2;

/**
 * 균일 격자 공간 분할. 화면이 고정이라 격자 크기도 고정입니다.
 * 적 60마리 x 투사체 수백 개의 전수 비교를 피하는 것이 목적입니다.
 */
export class SpatialGrid {
  private cells: Enemy[][] = [];

  constructor() {
    for (let i = 0; i < COLS * ROWS; i++) this.cells.push([]);
  }

  clear(): void {
    for (const c of this.cells) c.length = 0;
  }

  private index(x: number, y: number): number {
    const cx = Math.min(COLS - 1, Math.max(0, Math.floor(x / CELL) + 1));
    const cy = Math.min(ROWS - 1, Math.max(0, Math.floor(y / CELL) + 1));
    return cy * COLS + cx;
  }

  rebuild(enemies: readonly Enemy[]): void {
    this.clear();
    for (const e of enemies) {
      if (e.dead) continue;
      this.cells[this.index(e.x, e.y)].push(e);
    }
  }

  /** 반경 r 안에 있을 가능성이 있는 적을 out 에 모읍니다 (정확한 거리 검사는 호출측에서) */
  query(x: number, y: number, r: number, out: Enemy[]): Enemy[] {
    out.length = 0;
    const minCx = Math.max(0, Math.floor((x - r) / CELL) + 1);
    const maxCx = Math.min(COLS - 1, Math.floor((x + r) / CELL) + 1);
    const minCy = Math.max(0, Math.floor((y - r) / CELL) + 1);
    const maxCy = Math.min(ROWS - 1, Math.floor((y + r) / CELL) + 1);
    for (let cy = minCy; cy <= maxCy; cy++) {
      const row = cy * COLS;
      for (let cx = minCx; cx <= maxCx; cx++) {
        const cell = this.cells[row + cx];
        for (let i = 0; i < cell.length; i++) out.push(cell[i]);
      }
    }
    return out;
  }
}

/** 화면 안으로 강제로 밀어넣습니다 */
export function clampToArena(pos: { x: number; y: number }, radius: number, margin = 0): void {
  const lo = radius + margin;
  if (pos.x < lo) pos.x = lo;
  if (pos.y < lo) pos.y = lo;
  if (pos.x > CANVAS.w - lo) pos.x = CANVAS.w - lo;
  if (pos.y > CANVAS.h - lo) pos.y = CANVAS.h - lo;
}

export function isOutside(x: number, y: number, margin: number): boolean {
  return x < -margin || y < -margin || x > CANVAS.w + margin || y > CANVAS.h + margin;
}
