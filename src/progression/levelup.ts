import { BASE_WEIGHT, PASSIVE, STAT_DEFS, STAT_GAINS_PER_LEVEL, type StatKey } from '../data/balance';
import { formatGain, isStatMaxed, isStatRollable } from '../game/stats';
import type { World } from '../game/world';
import type { SaveData } from '../meta/save';

export interface StatGainResult {
  key: StatKey;
  amount: number;
  name: string;
  text: string;
}

/**
 * 레벨업 시 서로 다른 스탯 여러 개가 랜덤으로 오릅니다.
 *
 * **첫 칸만 "지정 칸"입니다.** 지정 칸은 `PASSIVE.chance` 확률로 장착한 성장 패시브에서
 * 뽑고, 나머지 칸은 언제나 일반 추첨입니다. 두 칸을 다 지정 칸으로 두면 한 스탯이
 * 전체 획득의 절반을 통째로 먹어서 후반에 그 스탯만 비정상적으로 커집니다.
 *
 * 남은 후보가 부족하면 있는 만큼만 돌려줍니다.
 */
export function rollStatGains(w: World, count = STAT_GAINS_PER_LEVEL): StatGainResult[] {
  const out: StatGainResult[] = [];
  const taken = new Set<StatKey>();

  for (let i = 0; i < count; i++) {
    // 지정 칸이 실패하면(빈 칸 · 상한 도달 · 이미 뽑힘) 그 몫은 일반 추첨으로 넘어갑니다
    const gain = (i === 0 ? rollDesignated(w, taken) : null) ?? rollStatGain(w, taken);
    if (!gain) break;
    taken.add(gain.key);
    out.push(gain);
  }
  return out;
}

/**
 * 지정 칸 추첨. 못 뽑으면 null 을 돌려주고 호출한 쪽이 일반 추첨으로 넘깁니다.
 *
 * **열린 칸 중에서 고르되, 고른 칸이 비어 있으면 그냥 실패입니다.** 이게 봉인의 존재
 * 이유입니다. 3칸이 열려 있는데 하나만 끼면 그 하나는 70% x 1/3 = 23.3% 밖에 안 오고,
 * 나머지 몫은 일반 추첨으로 새어 나갑니다. 안 쓸 칸을 봉인해야 70% 가 온전히 갑니다.
 * "빈 칸이면 그 칸을 건너뛰고 다시 고른다"로 만들면 봉인이 아무 의미가 없어집니다.
 */
function rollDesignated(w: World, exclude: ReadonlySet<StatKey>): StatGainResult | null {
  const openSlots = PASSIVE.slots - clampSealed(w.save.sealedSlots);
  if (openSlots <= 0) return null;
  if (!w.rng.chance(PASSIVE.chance)) return null;

  const key = w.save.equippedPassives[w.rng.int(0, openSlots)] ?? null;
  if (!key) return null;
  if (exclude.has(key) || !isStatRollable(key) || isStatMaxed(w.player.stats, key)) return null;

  const def = STAT_DEFS.find((s) => s.key === key);
  if (!def) return null;
  return { key, amount: def.step, name: def.name, text: formatGain(key, def.step) };
}

function clampSealed(v: number): number {
  return Math.min(PASSIVE.slots - 1, Math.max(0, Math.floor(v || 0)));
}

/**
 * 화면 표시용: 그 스탯이 레벨업 한 번에 뽑힐 확률 (%).
 *
 * 지정 칸(첫 칸)과 일반 칸(나머지)을 나눠서 셉니다. 상점에서 "이 패시브를 끼면
 * 실제로 몇 %인가"를 보여주는 데 씁니다. 예전 가중치 상점이 욕먹은 이유가
 * "산 %p 와 실제 %가 다르다"였으므로, 새 시스템은 실제 값을 그대로 보여줍니다.
 */
export function passiveChancePercent(save: SaveData, key: StatKey): number {
  if (!isStatRollable(key)) return 0;
  const openSlots = PASSIVE.slots - clampSealed(save.sealedSlots);
  if (openSlots <= 0) return 0;

  const hits = save.equippedPassives.slice(0, openSlots).filter((k) => k === key).length;
  return (PASSIVE.chance * hits) / openSlots * 100;
}

/** 스탯 하나를 뽑습니다. exclude 에 든 것과 상한에 닿은 것은 빼고 뽑습니다 */
export function rollStatGain(w: World, exclude?: ReadonlySet<StatKey>): StatGainResult | null {
  const keys: StatKey[] = [];
  const weights: number[] = [];

  for (const def of STAT_DEFS) {
    if (!isStatRollable(def.key)) continue;
    if (exclude?.has(def.key)) continue;
    if (isStatMaxed(w.player.stats, def.key)) continue;
    keys.push(def.key);
    weights.push(statWeight(w, def.key));
  }
  if (keys.length === 0) return null;

  const key = w.rng.weighted(keys, weights);
  const def = STAT_DEFS.find((s) => s.key === key)!;
  return { key, amount: def.step, name: def.name, text: formatGain(key, def.step) };
}

/**
 * 일반 추첨의 가중치. 주요 스탯이 부가 스탯보다 자주 나옵니다.
 * **상점은 더 이상 이 값을 건드리지 않습니다.** 성장 방향은 패시브로만 정합니다.
 */
export function statWeight(_w: World, key: StatKey): number {
  const def = STAT_DEFS.find((s) => s.key === key)!;
  return def.major ? BASE_WEIGHT.major : BASE_WEIGHT.minor;
}
