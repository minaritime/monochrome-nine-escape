import {
  ARMS_UPGRADE,
  MAX_ATTACK_SKILLS,
  MAX_START_ATTACKS,
  MAX_START_UTILITIES,
  PERM_HARD_MAX_LEVEL,
  PERM_MAX_LEVEL,
  PERM_UPGRADES,
  REROLL_UPGRADE,
  REVIVE_UPGRADE,
  SKIP_UPGRADE,
  START_SKILL_COST,
  START_SKILL_LEVEL_UPGRADE,
  STAT_DEFS,
  PASSIVE,
  XP_UPGRADE,
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

/**
 * 하드모드를 켠 뒤에만 열리는 강화 목록 (2026-09-06).
 * 스탯 강화의 21~25단계는 여기 없습니다. 그건 같은 카드가 이어지는 것이라
 * `permMaxLevel` 이 상한을 갈라주는 것으로 끝납니다.
 */
const HARD_UPGRADES = [XP_UPGRADE, START_SKILL_LEVEL_UPGRADE, ARMS_UPGRADE] as const;

function costsOf(key: string): readonly number[] | undefined {
  const special = SPECIAL_UPGRADES.find((u) => u.key === key);
  if (special) return special.costs;
  const hard = HARD_UPGRADES.find((u) => u.key === key);
  if (hard) return hard.costs;
  return PERM_UPGRADES.find((u) => u.key === key)?.costs;
}

/** 하드모드를 켠 적이 있어야만 살 수 있는 항목인가 */
export function isHardOnlyKey(key: string): boolean {
  return HARD_UPGRADES.some((u) => u.key === key);
}

/**
 * 그 항목을 몇 단계까지 살 수 있는가.
 *
 * **스탯 강화만 하드 여부로 갈립니다** (20 → 25). `PERM_UPGRADES.costs` 는 25개를
 * 전부 들고 있으므로, 잘라주지 않으면 하드를 연 적 없는 사람이 21단계를 삽니다.
 */
export function permMaxLevel(save: SaveData, key: string): number {
  const stat = PERM_UPGRADES.find((u) => u.key === key);
  if (stat) return save.hardUnlocked ? PERM_HARD_MAX_LEVEL : PERM_MAX_LEVEL;
  return costsOf(key)?.length ?? 0;
}

/** 다음 단계 비용. 최대 단계면 null */
export function permNextCost(save: SaveData, key: string): number | null {
  if (isHardOnlyKey(key) && !save.hardUnlocked) return null;
  const lv = permLevel(save, key);
  const costs = costsOf(key);
  if (!costs || lv >= permMaxLevel(save, key)) return null;
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
  // 스탯은 costs.length(25)가 아니라 일반 상한(20)으로 셉니다. 하드 구간이 섞이면
  // 하드를 안 연 사람은 이 업적을 영영 못 깹니다
  n += PERM_UPGRADES.length * PERM_MAX_LEVEL;
  for (const s of SPECIAL_UPGRADES) n += s.costs.length;
  n += nonPermTotal();
  return n;
}

/** 스탯·특수 강화를 뺀 나머지 (패시브 해금 · 봉인 · 시작 스킬) */
function nonPermTotal(): number {
  return passiveKeys().length + PASSIVE.sealCosts.length + Object.keys(START_SKILL_COST).length;
}

/**
 * 하드 구간까지 포함한 총 개수 (히든 업적 "공급부족").
 * `totalPurchasable` 과 갈라두는 이유는 위 주석과 같습니다.
 */
export function totalPurchasableAll(): number {
  let n = totalPurchasable();
  n += PERM_UPGRADES.length * (PERM_HARD_MAX_LEVEL - PERM_MAX_LEVEL);
  for (const u of HARD_UPGRADES) n += u.costs.length;
  return n;
}

/**
 * 지금까지 산 개수. **하드 구간은 빠집니다** (업적 "플렉스" 용).
 *
 * 스탯을 20 으로 자르고 하드 전용 항목을 빼지 않으면, 하드 스탯 몇 칸을 사는 것만으로
 * 일반 156 이 채워집니다. 세는 쪽과 목표치가 짝을 이뤄야 합니다.
 */
export function purchasedCount(save: SaveData): number {
  let n = 0;
  for (const [key, v] of Object.entries(save.perm)) {
    if (isHardOnlyKey(key)) continue;
    const lv = Math.max(0, Math.floor(v));
    n += PERM_UPGRADES.some((u) => u.key === key) ? Math.min(lv, PERM_MAX_LEVEL) : lv;
  }
  return n + ownedNonPerm(save);
}

/** 하드 구간까지 포함해 산 개수 (히든 업적 "공급부족") */
export function purchasedCountAll(save: SaveData): number {
  let n = 0;
  for (const v of Object.values(save.perm)) n += Math.max(0, Math.floor(v));
  return n + ownedNonPerm(save);
}

function ownedNonPerm(save: SaveData): number {
  return save.unlockedPassives.length + save.sealsOwned + save.unlockedStartSkills.length;
}

// ---------------------------------------------------------------------------
// 하드모드 강화가 실제로 먹는 자리
// ---------------------------------------------------------------------------

/**
 * 경험치 획득 배율. **일반모드에도 적용됩니다.**
 * 곱하는 곳은 `World.gainXp` 한 곳뿐입니다. 출처마다 곱하면 반드시 하나를 빠뜨립니다.
 */
export function xpMultiplier(save: SaveData): number {
  return 1 + permLevel(save, XP_UPGRADE.key) * XP_UPGRADE.perLevel;
}

/** 시작 스킬이 들어갈 때의 레벨. 안 사면 1 (기획.md 8장의 기본값) */
export function startSkillLevel(save: SaveData): number {
  return 1 + permLevel(save, START_SKILL_LEVEL_UPGRADE.key);
}

function armsLevel(save: SaveData): number {
  const lv = Math.max(0, Math.floor(permLevel(save, ARMS_UPGRADE.key)));
  return Math.min(lv, ARMS_UPGRADE.costs.length);
}

/**
 * 판에 실제로 들어가는 공격 슬롯 수.
 *
 * **`MAX_ATTACK_SKILLS` 를 직접 읽지 마십시오.** 하드에서는 이 값이 4가 될 수 있는데,
 * 한 곳이라도 상수를 그대로 쓰면 그쪽에서만 3으로 세어져서 네 번째 칸이 화면에만
 * 없거나 반대로 그림만 있고 안 채워집니다.
 *
 * **`hardMode`(지금 하드인가)로 갈립니다.** `hardUnlocked` 가 아닙니다. 무장 확장은
 * 하드 전용이라 일반 판에서는 사 두었어도 3칸입니다.
 */
export function attackSlotCount(save: SaveData): number {
  if (!save.hardMode) return MAX_ATTACK_SKILLS;
  return ARMS_UPGRADE.slots[armsLevel(save)];
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

/**
 * 시작 장착 칸 수.
 *
 * **하드에서는 공격 칸이 1개로 깎인 채 시작하고** 무장 확장으로 4까지 넓힙니다
 * (`ARMS_UPGRADE`). 이건 난이도 표의 한 칸이 아니라 하드모드 공통 규칙입니다.
 * 난이도 표는 누적이라 0 칸이 없어서 거기에는 적을 자리가 없습니다.
 *
 * 유틸은 하드에서도 1칸 그대로입니다. 손으로 쓰는 키가 Q 하나뿐이라 늘릴 수 없습니다.
 */
export function maxStartFor(save: SaveData, kind: 'attack' | 'utility'): number {
  if (kind === 'utility') return MAX_START_UTILITIES;
  if (!save.hardMode) return MAX_START_ATTACKS;
  return ARMS_UPGRADE.startAttacks[armsLevel(save)];
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
  if (equippedStartCount(save, kind) >= maxStartFor(save, kind)) return false;
  save.equippedStartSkills.push(id);
  return true;
}
