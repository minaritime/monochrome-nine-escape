import { BASE_STATS, PERM_UPGRADES, STAT_DEFS, type StatKey } from '../data/balance';
import type { StatBlock } from './types';

export function statDef(key: StatKey) {
  const def = STAT_DEFS.find((s) => s.key === key);
  if (!def) throw new Error(`알 수 없는 스탯: ${key}`);
  return def;
}

/** 상점에서 산 영구 강화를 반영한 시작 스탯 */
export function createStats(permLevels: Record<string, number>): StatBlock {
  const stats: StatBlock = { ...BASE_STATS };
  for (const up of PERM_UPGRADES) {
    const lv = permLevels[up.key] ?? 0;
    if (lv > 0) stats[up.stat] += up.step * lv;
  }
  return stats;
}

export function addStat(stats: StatBlock, key: StatKey, amount: number): void {
  const def = statDef(key);
  const next = stats[key] + amount;
  stats[key] = def.cap !== undefined ? Math.min(next, def.cap) : next;
}

/** 이미 상한에 닿은 스탯은 레벨업 추첨에서 제외합니다 */
export function isStatMaxed(stats: StatBlock, key: StatKey): boolean {
  const def = statDef(key);
  return def.cap !== undefined && stats[key] >= def.cap - 1e-9;
}

/**
 * 레벨업 추첨에 넣는 스탯인지.
 * 체감이 없는 스탯(투사체 속도, 피격 무적 시간, 코인 획득 범위)은 여기서 걸러집니다.
 * 상점 영구 강화로는 여전히 올릴 수 있습니다.
 */
export function isStatRollable(key: StatKey): boolean {
  return statDef(key).rollable !== false;
}

export function formatStat(key: StatKey, value: number): string {
  const def = statDef(key);
  switch (def.format) {
    case 'int':
      return String(Math.round(value));
    case 'dec1':
      return value.toFixed(1);
    case 'dec2':
      return value.toFixed(2);
    case 'percent':
      return `${Math.round(value * 100)}%`;
  }
}

export function formatGain(key: StatKey, amount: number): string {
  const def = statDef(key);
  if (def.format === 'percent') return `+${Math.round(amount * 100)}%`;
  if (def.format === 'int') return `+${Math.round(amount)}`;
  return `+${amount.toFixed(2)}`;
}

/** 스킬 쿨다운 감소를 적용한 실제 대기 시간 */
export function cooldownFor(stats: StatBlock, base: number): number {
  return base * (1 - Math.min(stats.cooldownReduction, 0.85));
}
