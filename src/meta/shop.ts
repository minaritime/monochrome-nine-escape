import {
  MAX_START_ATTACKS,
  MAX_START_UTILITIES,
  PERM_UPGRADES,
  REROLL_UPGRADE,
  REVIVE_UPGRADE,
  SKIP_UPGRADE,
  START_SKILL_COST,
  STAT_DEFS,
  PASSIVE,
  type StatKey,
} from '../data/balance';
import { isStatRollable } from '../game/stats';
import { getSkillDef } from '../skills/registry';
import type { SkillId } from '../skills/types';
import type { SaveData } from './save';

// ---------------------------------------------------------------------------
// 영구 강화
// ---------------------------------------------------------------------------

export function permLevel(save: SaveData, key: string): number {
  return save.perm[key] ?? 0;
}

/** 스탯이 아닌 특수 강화 목록 */
const SPECIAL_UPGRADES = [REVIVE_UPGRADE, REROLL_UPGRADE, SKIP_UPGRADE] as const;

function costsOf(key: string): readonly number[] | undefined {
  const special = SPECIAL_UPGRADES.find((u) => u.key === key);
  if (special) return special.costs;
  return PERM_UPGRADES.find((u) => u.key === key)?.costs;
}

export function permMaxLevel(key: string): number {
  return costsOf(key)?.length ?? 0;
}

/** 다음 단계 비용. 최대 단계면 null */
export function permNextCost(save: SaveData, key: string): number | null {
  const lv = permLevel(save, key);
  const costs = costsOf(key);
  if (!costs || lv >= costs.length) return null;
  return costs[lv];
}

/**
 * 판에 들어갈 스킬 선택 건너뛰기 횟수.
 * 마지막 단계까지 사면 무제한이라 Infinity 를 돌려줍니다 (`skips--` 를 해도 줄지 않습니다).
 */
export function skipCount(save: SaveData): number {
  const lv = permLevel(save, SKIP_UPGRADE.key);
  return lv >= SKIP_UPGRADE.unlimitedLevel ? Number.POSITIVE_INFINITY : lv;
}

export function isSkipUnlimited(save: SaveData): boolean {
  return permLevel(save, SKIP_UPGRADE.key) >= SKIP_UPGRADE.unlimitedLevel;
}

export function buyPerm(save: SaveData, key: string): boolean {
  const cost = permNextCost(save, key);
  if (cost === null || save.coins < cost) return false;
  save.coins -= cost;
  save.perm[key] = permLevel(save, key) + 1;
  return true;
}

/**
 * 상점에서 살 수 있는 것의 총 개수 (업적 "플렉스" 의 마지막 단계).
 *
 * 저장에 따로 세지 않고 그때그때 계산합니다. 세어두면 상점 항목을 늘렸을 때
 * 예전 저장의 숫자와 어긋나서, 항목을 추가할 때마다 마이그레이션을 해야 합니다.
 */
export function totalPurchasable(): number {
  let n = 0;
  for (const u of PERM_UPGRADES) n += u.costs.length;
  for (const s of SPECIAL_UPGRADES) n += s.costs.length;
  n += passiveKeys().length;
  n += PASSIVE.sealCosts.length;
  n += Object.keys(START_SKILL_COST).length;
  return n;
}

/** 지금까지 산 개수 */
export function purchasedCount(save: SaveData): number {
  let n = 0;
  for (const v of Object.values(save.perm)) n += Math.max(0, Math.floor(v));
  n += save.unlockedPassives.length;
  n += save.sealsOwned;
  n += save.unlockedStartSkills.length;
  return n;
}

// ---------------------------------------------------------------------------
// 성장 패시브 (예전 가중치 상점을 대체합니다. `PASSIVE` 주석 참고)
// ---------------------------------------------------------------------------

/** 패시브로 살 수 있는 스탯. 레벨업 추첨에 안 나오는 스탯은 패시브도 의미가 없습니다 */
export function passiveKeys(): StatKey[] {
  return STAT_DEFS.filter((d) => isStatRollable(d.key)).map((d) => d.key);
}

export function passiveCost(key: StatKey): number {
  const def = STAT_DEFS.find((s) => s.key === key)!;
  return def.major ? PASSIVE.majorCost : PASSIVE.minorCost;
}

export function isPassiveUnlocked(save: SaveData, key: StatKey): boolean {
  return save.unlockedPassives.includes(key);
}

export function buyPassive(save: SaveData, key: StatKey): boolean {
  if (!isStatRollable(key) || isPassiveUnlocked(save, key)) return false;
  const cost = passiveCost(key);
  if (save.coins < cost) return false;
  save.coins -= cost;
  save.unlockedPassives.push(key);
  return true;
}

/** 지금 열려 있는 칸 수. 봉인한 만큼 줄어듭니다 */
export function openSlots(save: SaveData): number {
  return PASSIVE.slots - sealedSlots(save);
}

/** 마지막 한 칸은 절대 못 잠급니다. 전부 잠기면 지정 추첨 자체가 사라집니다 */
export function sealedSlots(save: SaveData): number {
  return Math.min(PASSIVE.slots - 1, Math.max(0, Math.floor(save.sealedSlots || 0)));
}

/**
 * 칸에 끼우거나 뺍니다. 이미 다른 칸에 낀 것을 또 끼우면 그 칸에서 빠져나옵니다.
 * 같은 스탯을 두 칸에 넣어도 이득이 없어서(확률이 그만큼 나뉠 뿐) 막는 편이 낫습니다.
 */
export function togglePassive(save: SaveData, slot: number, key: StatKey): boolean {
  if (slot < 0 || slot >= openSlots(save)) return false;
  if (!isPassiveUnlocked(save, key)) return false;

  if (save.equippedPassives[slot] === key) {
    save.equippedPassives[slot] = null;
    return true;
  }
  for (let i = 0; i < save.equippedPassives.length; i++) {
    if (save.equippedPassives[i] === key) save.equippedPassives[i] = null;
  }
  save.equippedPassives[slot] = key;
  return true;
}

export function nextSealCost(save: SaveData): number | null {
  const owned = Math.min(PASSIVE.sealCosts.length, Math.max(0, Math.floor(save.sealsOwned || 0)));
  return owned >= PASSIVE.sealCosts.length ? null : PASSIVE.sealCosts[owned];
}

export function buySeal(save: SaveData): boolean {
  const cost = nextSealCost(save);
  if (cost === null || save.coins < cost) return false;
  save.coins -= cost;
  save.sealsOwned += 1;
  return true;
}

/**
 * 봉인을 한 칸 켜거나 끕니다. 산 개수까지만 켤 수 있습니다.
 *
 * **봉인하면 그 칸에 끼워둔 것이 빠집니다.** 잠긴 칸에 남겨두면 화면에는 장착으로
 * 보이는데 추첨에는 안 들어가서, 왜 확률이 안 오르는지 알 수 없게 됩니다.
 */
export function setSealed(save: SaveData, count: number): boolean {
  const max = Math.min(PASSIVE.sealCosts.length, PASSIVE.slots - 1, Math.floor(save.sealsOwned || 0));
  const next = Math.min(max, Math.max(0, Math.floor(count)));
  if (next === sealedSlots(save)) return false;
  save.sealedSlots = next;
  for (let i = PASSIVE.slots - next; i < PASSIVE.slots; i++) save.equippedPassives[i] = null;
  return true;
}

// ---------------------------------------------------------------------------
// 시작 스킬
// ---------------------------------------------------------------------------

export function startSkillCost(id: SkillId): number {
  return START_SKILL_COST[id] ?? 100;
}

export function isStartSkillUnlocked(save: SaveData, id: SkillId): boolean {
  return save.unlockedStartSkills.includes(id);
}

export function buyStartSkill(save: SaveData, id: SkillId): boolean {
  if (isStartSkillUnlocked(save, id)) return false;
  const cost = startSkillCost(id);
  if (save.coins < cost) return false;
  save.coins -= cost;
  save.unlockedStartSkills.push(id);
  return true;
}

/** 지금 장착한 시작 스킬 중 그 종류의 개수 */
export function equippedStartCount(save: SaveData, kind: 'attack' | 'utility'): number {
  return save.equippedStartSkills.filter((s) => getSkillDef(s).kind === kind).length;
}

export function maxStartFor(kind: 'attack' | 'utility'): number {
  return kind === 'attack' ? MAX_START_ATTACKS : MAX_START_UTILITIES;
}

/**
 * 장착 토글. **공격과 유틸이 서로 다른 주머니를 씁니다** (`MAX_START_ATTACKS` 주석 참고).
 * 유틸을 끼운다고 공격 칸이 줄지 않습니다.
 */
export function toggleStartSkill(save: SaveData, id: SkillId): boolean {
  if (!isStartSkillUnlocked(save, id)) return false;
  const idx = save.equippedStartSkills.indexOf(id);
  if (idx >= 0) {
    save.equippedStartSkills.splice(idx, 1);
    return true;
  }
  const kind = getSkillDef(id).kind;
  if (equippedStartCount(save, kind) >= maxStartFor(kind)) return false;
  save.equippedStartSkills.push(id);
  return true;
}
