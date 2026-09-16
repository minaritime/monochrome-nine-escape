import { angleTo, distSq, distToRay } from '../core/math';
import { challengeTauntId } from '../game/challenge';
import type { EnemyId } from '../data/balance';
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

/**
 * 지금 도발이 걸려 있는 적의 종류. 없으면 null 입니다 (2026-09-16).
 *
 * **사거리를 같이 봅니다.** 도발 대상이 그 사거리 안에 하나라도 있어야 걸립니다.
 * 이걸 안 보면 방패적이 경기장 반대편에 있을 때도 도발이 걸려서, 평타가 겨눌
 * 대상을 못 찾고 아예 안 나갑니다. 사거리 밖의 도발은 도발이 아닙니다.
 *
 * 살아 있는지도 같이 봅니다. 전멸한 순간 조준 대상이 없어지면 공격이 멈춥니다.
 *
 * **함수마다 한 번만 부릅니다.** 적마다 부르면 적 수의 제곱이 됩니다
 */
function tauntId(w: World, x: number, y: number, range: number): EnemyId | null {
  const id = challengeTauntId(w);
  if (!id) return null;
  const r2 = range * range;
  for (const e of w.enemies) {
    if (e.dead || !e.targetable || e.defId !== id) continue;
    if (distSq(x, y, e.x, e.y) <= r2) return id;
  }
  return null;
}

/**
 * 조준 후보인가. **조준 함수 7개는 전부 이것을 거칩니다.**
 *
 * `canTarget` 과 나눠 둔 이유가 있습니다. 저쪽은 피해 판정도 쓰고 있어서
 * (`projectile.ts` 도탄), 거기에 도발을 넣으면 "안 겨누는 적"이 아니라
 * "안 맞는 적"이 됩니다. 도발은 조준에만 걸어야 합니다
 */
function isPick(e: Enemy, taunt: EnemyId | null): boolean {
  return canTarget(e) && (taunt === null || e.defId === taunt);
}

export function nearestEnemy(w: World, x: number, y: number, maxRange = Infinity): Enemy | null {
  const taunt = tauntId(w, x, y, maxRange);
  let best: Enemy | null = null;
  let bestD = maxRange * maxRange;
  for (const e of w.enemies) {
    if (!isPick(e, taunt)) continue;
    const d = distSq(x, y, e.x, e.y);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

export function farthestEnemy(w: World, x: number, y: number, maxRange = Infinity): Enemy | null {
  const taunt = tauntId(w, x, y, maxRange);
  let best: Enemy | null = null;
  let bestD = -1;
  const limit = maxRange * maxRange;
  for (const e of w.enemies) {
    if (!isPick(e, taunt)) continue;
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
  const taunt = tauntId(w, x, y, range);
  const inRange: Enemy[] = [];
  const r2 = range * range;
  for (const e of w.enemies) {
    if (!isPick(e, taunt)) continue;
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
  const taunt = tauntId(w, x, y, range);
  const inRange: Enemy[] = [];
  const r2 = range * range;
  for (const e of w.enemies) {
    if (!isPick(e, taunt)) continue;
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
  // 레이저는 사거리 개념이 없습니다 (화면 끝까지 그어집니다). 그래서 도발도
  // 거리를 안 봅니다
  const taunt = tauntId(w, x, y, Infinity);
  const list: Enemy[] = [];
  for (const e of w.enemies) {
    if (isPick(e, taunt)) list.push(e);
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
  const taunt = tauntId(w, x, y, range);
  const list: Enemy[] = [];
  const r2 = range * range;
  for (const e of w.enemies) {
    if (!isPick(e, taunt)) continue;
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
  const taunt = tauntId(w, x, y, maxRange);
  let best: Enemy | null = null;
  let bestHp = -1;
  const limit = maxRange * maxRange;
  for (const e of w.enemies) {
    if (!isPick(e, taunt)) continue;
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
