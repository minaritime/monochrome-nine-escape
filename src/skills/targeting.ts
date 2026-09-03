import { angleTo, distSq, distToRay } from '../core/math';
import type { Enemy } from '../game/types';
import type { World } from '../game/world';

/**
 * 타겟 선택 함수 모음.
 * 은신 중인 적은 targetable 이 false 라 여기서 전부 걸러집니다.
 * 이걸 지키지 않으면 자동공격이 은신적을 계속 때려서 은신의 의미가 사라집니다.
 */
export function canTarget(e: Enemy): boolean {
  return !e.dead && e.targetable;
}

export function nearestEnemy(w: World, x: number, y: number, maxRange = Infinity): Enemy | null {
  let best: Enemy | null = null;
  let bestD = maxRange * maxRange;
  for (const e of w.enemies) {
    if (!canTarget(e)) continue;
    const d = distSq(x, y, e.x, e.y);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

export function farthestEnemy(w: World, x: number, y: number, maxRange = Infinity): Enemy | null {
  let best: Enemy | null = null;
  let bestD = -1;
  const limit = maxRange * maxRange;
  for (const e of w.enemies) {
    if (!canTarget(e)) continue;
    const d = distSq(x, y, e.x, e.y);
    if (d > bestD && d <= limit) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

/** 적이 가장 밀집한 방향 (부채꼴 스킬용) */
export function densestDirection(w: World, x: number, y: number, range: number, spread: number): number | null {
  const inRange: Enemy[] = [];
  const r2 = range * range;
  for (const e of w.enemies) {
    if (!canTarget(e)) continue;
    if (distSq(x, y, e.x, e.y) <= r2) inRange.push(e);
  }
  if (inRange.length === 0) return null;

  const SAMPLES = 24;
  let bestAngle = angleTo(x, y, inRange[0].x, inRange[0].y);
  let bestScore = -1;
  for (let i = 0; i < SAMPLES; i++) {
    const a = (i / SAMPLES) * Math.PI * 2;
    let score = 0;
    for (const e of inRange) {
      const ea = angleTo(x, y, e.x, e.y);
      let diff = Math.abs(((ea - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (diff <= spread) {
        // 가까울수록, 정면일수록 높은 점수
        const d = Math.sqrt(distSq(x, y, e.x, e.y));
        score += (1 - diff / spread) * (1 - d / (range * 1.2));
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestAngle = a;
    }
  }
  return bestScore > 0 ? bestAngle : bestAngle;
}

/** 폭발 반경 안에 가장 많이 들어오는 지점 (유탄용) */
export function densestPoint(w: World, x: number, y: number, range: number, blast: number): { x: number; y: number } | null {
  const inRange: Enemy[] = [];
  const r2 = range * range;
  for (const e of w.enemies) {
    if (!canTarget(e)) continue;
    if (distSq(x, y, e.x, e.y) <= r2) inRange.push(e);
  }
  if (inRange.length === 0) return null;

  let best = inRange[0];
  let bestCount = -1;
  const b2 = blast * blast;
  for (const c of inRange) {
    let count = 0;
    for (const e of inRange) {
      if (distSq(c.x, c.y, e.x, e.y) <= b2) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      best = c;
    }
  }
  return { x: best.x, y: best.y };
}

/** 일직선에 가장 많이 걸리는 방향 (레이저용) */
export function bestLineDirection(w: World, x: number, y: number, width: number): number | null {
  const list: Enemy[] = [];
  for (const e of w.enemies) {
    if (canTarget(e)) list.push(e);
  }
  if (list.length === 0) return null;

  let bestAngle = angleTo(x, y, list[0].x, list[0].y);
  let bestCount = -1;
  // 각 적 방향을 후보로 삼아 그 직선에 몇 마리가 걸리는지 셉니다
  for (const c of list) {
    const a = angleTo(x, y, c.x, c.y);
    let count = 0;
    for (const e of list) {
      if (distToRay(x, y, a, e.x, e.y) <= width / 2 + e.radius) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      bestAngle = a;
    }
  }
  return bestAngle;
}

/** 체력이 가장 적게 남은 적 여러 마리 (추적 미사일용) */
export function lowestHpEnemies(w: World, count: number, x: number, y: number, range = Infinity): Enemy[] {
  const list: Enemy[] = [];
  const r2 = range * range;
  for (const e of w.enemies) {
    if (!canTarget(e)) continue;
    if (distSq(x, y, e.x, e.y) <= r2) list.push(e);
  }
  list.sort((a, b) => a.hp - b.hp);
  return list.slice(0, count);
}

/**
 * 체력이 가장 많이 남은 적 (스나이퍼용).
 *
 * 최대 체력이 아니라 **남은 체력** 기준입니다. 그래야 이미 반쯤 깎아둔 탱커 대신
 * 방금 나온 멀쩡한 놈으로 옮겨가서, 단단한 것부터 차례로 걷어내는 흐름이 됩니다.
 * 동점이면 먼저 만난 쪽을 그대로 둡니다. 매 발마다 대상이 흔들리면 아무것도 못 죽입니다.
 */
export function highestHpEnemy(w: World, maxRange = Infinity, x = 0, y = 0): Enemy | null {
  let best: Enemy | null = null;
  let bestHp = -1;
  const limit = maxRange * maxRange;
  for (const e of w.enemies) {
    if (!canTarget(e)) continue;
    if (maxRange !== Infinity && distSq(x, y, e.x, e.y) > limit) continue;
    if (e.hp > bestHp) {
      bestHp = e.hp;
      best = e;
    }
  }
  return best;
}

export function enemyById(w: World, id: number): Enemy | null {
  for (const e of w.enemies) {
    if (e.id === id && !e.dead) return e;
  }
  return null;
}
