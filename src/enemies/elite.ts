import { DIFFICULTY, ELITE, ELITE_TRAITS, SPAWN, type EnemyId } from '../data/balance';
import { progress } from '../core/math';
import type { Enemy } from '../game/types';
import type { World } from '../game/world';

/**
 * 그 적의 정예 고유 강화 배율. 정예가 아니거나 해당 항목이 없으면 1 입니다.
 *
 * 조준 시간이나 예고 시간처럼 "그 적을 그 적답게 만드는" 값을 읽을 때는 반드시 이 함수를 거치십시오.
 * 그리기 쪽에서도 같은 값을 써야 화면에 보이는 예고와 실제 발동 시점이 어긋나지 않습니다.
 */
export function eliteMul(
  e: Enemy,
  key:
    | 'aimTimeMul'
    | 'telegraphMul'
    | 'triggerRangeMul'
    | 'dashSpeedMul'
    | 'corpseDelayMul'
    | 'blastRadiusMul'
    | 'hazardRadiusMul'
    | 'revealRangeMul'
    | 'reviveDelayMul',
): number {
  if (!e.elite) return 1;
  const trait = ELITE_TRAITS[e.defId as EnemyId];
  return trait?.[key] ?? 1;
}

/**
 * 정예의 체력 · 속도 배율. 정예가 아니면 1 입니다.
 *
 * 종류별 값(`ELITE_TRAITS`)이 있으면 공통 값(`ELITE`)을 **대체**합니다. 곱하지 않습니다.
 * 탱커 정예는 체력 5배이지 5 x 1.5 = 7.5배가 아닙니다. 종류별로 "이 적의 정예는 이런 것"을
 * 통째로 다시 정하는 자리이므로, 공통값에 얹으면 의도한 수치가 나오지 않습니다.
 */
export function eliteStatMul(
  id: string,
  elite: boolean,
  key: 'hpMul' | 'speedMul' | 'damageMul' | 'sizeMul',
): number {
  if (!elite) return 1;
  return ELITE_TRAITS[id as EnemyId]?.[key] ?? ELITE[key];
}

/** 켜고 끄는 정예 능력 (분열 재분열, 소환 정예 행동 등) */
export function eliteHas(e: Enemy, _w: World, key: 'splitAgain' | 'summonElite' | 'foolElite'): boolean {
  if (!e.elite) return false;
  // 예전에는 전원 정예인 난이도(9 이상)에서 재분열을 껐습니다. 화면이 분열체로만
  // 덮이는 것을 걱정했는데, 그러면 난이도가 올랐는데 그 적만 약해지는 셈이라
  // 되돌렸습니다 (2026-08-11, 사용자 결정). 9 이상에서도 1 → 3 → 9 로 나뉩니다
  return ELITE_TRAITS[e.defId as EnemyId]?.[key] === true;
}

/** 값 자체를 대체하는 정예 수치. 없으면 fallback 을 그대로 씁니다 */
export function eliteValue(
  e: Enemy,
  key: 'hazardSlow' | 'hazardDamageMul' | 'shieldRatio' | 'shieldedDamageTaken' | 'brokenDamageTaken',
  fallback: number,
): number {
  if (!e.elite) return fallback;
  return ELITE_TRAITS[e.defId as EnemyId]?.[key] ?? fallback;
}

/** 초당 되찾는 최대 체력의 비율. 재생이 없으면 0 입니다 (지금은 정예 탱커만 5%) */
export function eliteRegenRatio(e: Enemy): number {
  if (!e.elite) return 0;
  return ELITE_TRAITS[e.defId as EnemyId]?.hpRegenRatio ?? 0;
}

/**
 * 정예 변형.
 * 화면 고정 맵에서는 후반 난도 상승이 대부분 정예 비율로 표현됩니다.
 * 수량이 상한에 걸린 뒤로는 스폰 압력이 질로 전환됩니다 (기획.md 7장).
 */
export function eliteRatio(time: number, mul = 1): number {
  const base = progress(time, SPAWN.eliteStartTime, SPAWN.eliteRampTime) * SPAWN.eliteMaxRatio;
  return Math.min(base * mul, DIFFICULTY.eliteRatioCap);
}

export function rollElite(w: World): boolean {
  // 난이도 9 이상은 예외 없이 전원 정예입니다 (표식은 render 쪽에서 감춥니다)
  if (w.diff.allElite) return true;
  return w.rng.chance(eliteRatio(w.time, w.diff.eliteRatioMul));
}
