import {
  LEVEL,
  LEVEL_NOTICE,
  MAX_UPGRADE_CHOICES_PER_ROLL,
  MAX_UTILITY_CHOICES_PER_ROLL,
  SKILL_BRANCH_LEVEL,
  SKILL_MAX_LEVEL,
} from '../data/balance';
import type { SkillBranchId } from '../data/balance';
import { branchDef, hasBranches } from '../skills/branches';
import { ATTACK_SKILL_IDS, UTILITY_SKILL_IDS, getSkillDef, makeSlot } from '../skills/registry';
import type { SkillId } from '../skills/types';
import type { World } from '../game/world';

export interface SkillChoice {
  id: SkillId;
  /** 이미 가진 스킬의 레벨업 선택지인지 */
  upgrade: boolean;
  /** 선택 후의 레벨 */
  level: number;
  /**
   * 쓰던 유틸을 버리고 갈아타는 선택지인지.
   *
   * **레벨은 그대로 이어받습니다.** 1 로 되돌리면 판 중반 이후의 유틸 교체가
   * 사실상 금지됩니다. 5레벨 대시를 1레벨 시간 감속으로 바꾸는 사람은 없으므로,
   * 유틸이 하나뿐이라는 제약이 "처음에 뽑은 것을 판 끝까지 쓴다"로 굳어집니다.
   * 이어받으면 교체가 손해가 아니라 **갈아타기**가 됩니다.
   */
  replacesUtility: boolean;
}

/**
 * 선택지를 만듭니다. 장수는 난이도가 정합니다 (기본 3장, 난이도 8 이상은 2장).
 *
 * 공격 스킬은 3칸이 상한이라 다 차면 새 공격은 더 나오지 않고 가진 것의 레벨업만 나옵니다.
 * 유틸 스킬은 칸이 하나뿐이지만 새 유틸이 계속 나오고, 고르면 쓰던 것과 교체됩니다.
 * 유틸은 어차피 하나만 들 수 있어서 한 번에 한 장까지만 섞습니다.
 */
export function generateSkillChoices(w: World, count = Math.max(1, w.diff.skillChoices)): SkillChoice[] {
  const p = w.player;
  const ownedAttacks = new Map<SkillId, number>();
  for (const slot of p.attacks) {
    if (slot) ownedAttacks.set(slot.id, slot.level);
  }
  const hasFreeAttackSlot = p.attacks.some((s) => s === null);

  const newPool: SkillChoice[] = [];
  const upgradePool: SkillChoice[] = [];

  if (hasFreeAttackSlot) {
    for (const id of ATTACK_SKILL_IDS) {
      if (!ownedAttacks.has(id)) newPool.push({ id, upgrade: false, level: 1, replacesUtility: false });
    }
  }
  for (const [id, level] of ownedAttacks) {
    if (level < SKILL_MAX_LEVEL) upgradePool.push({ id, upgrade: true, level: level + 1, replacesUtility: false });
  }

  for (const id of UTILITY_SKILL_IDS) {
    if (p.utility?.id === id) continue;
    // 교체는 쓰던 유틸의 레벨을 그대로 이어받습니다 (`SkillChoice.replacesUtility` 주석 참고)
    newPool.push({ id, upgrade: false, level: p.utility?.level ?? 1, replacesUtility: p.utility !== null });
  }
  if (p.utility && p.utility.level < SKILL_MAX_LEVEL) {
    upgradePool.push({ id: p.utility.id, upgrade: true, level: p.utility.level + 1, replacesUtility: false });
  }

  const out: SkillChoice[] = [];
  const used = new Set<SkillId>();
  let utilityCount = 0;

  const take = (pool: SkillChoice[]): SkillChoice | null => {
    const available = pool.filter(
      (c) =>
        !used.has(c.id) &&
        (getSkillDef(c.id).kind === 'attack' || utilityCount < MAX_UTILITY_CHOICES_PER_ROLL),
    );
    if (available.length === 0) return null;
    const picked = w.rng.pick(available);
    used.add(picked.id);
    if (getSkillDef(picked.id).kind === 'utility') utilityCount++;
    return picked;
  };

  // 업그레이드는 판마다 한 번만 굴립니다. 카드마다 굴리면 0.35 를 걸어놔도
  // 3장 중 한 장이라도 뜰 확률이 72% 가 되어 사실상 확정으로 보입니다
  let upgradeQuota =
    upgradePool.length > 0 && w.rng.chance(LEVEL.upgradeOfferChance) ? MAX_UPGRADE_CHOICES_PER_ROLL : 0;

  while (out.length < count) {
    const wantUpgrade = upgradeQuota > 0;
    // 한쪽이 비면 반대쪽에서 채웁니다 (새 스킬이 동나면 상한을 넘겨서라도 3장을 채웁니다)
    const picked = take(wantUpgrade ? upgradePool : newPool) ?? take(wantUpgrade ? newPool : upgradePool);
    if (!picked) break;
    if (picked.upgrade) upgradeQuota--;
    out.push(picked);
  }

  // 업그레이드가 항상 첫 칸에 오면 위치만 보고도 무엇인지 알게 됩니다
  for (let i = out.length - 1; i > 0; i--) {
    const j = w.rng.int(0, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }

  return out;
}

/** 선택을 적용합니다 */
export function applySkillChoice(w: World, choice: SkillChoice): void {
  const p = w.player;
  const def = getSkillDef(choice.id);

  if (choice.upgrade) {
    const slot = def.kind === 'utility' ? p.utility : p.attacks.find((s) => s?.id === choice.id) ?? null;
    if (slot) {
      slot.level = Math.min(SKILL_MAX_LEVEL, slot.level + 1);
      announce(w, `${def.name} Lv.${slot.level}`);
      // 6레벨에 딱 한 번 강화 갈래를 고릅니다.
      // ⚠ `kind === 'attack'` 검사가 없으면 유틸이 6레벨일 때 카드 0장짜리 화면이 뜨고,
      //    키를 아무리 눌러도 안 닫혀서 판이 영구 정지합니다
      if (
        def.kind === 'attack'
        && slot.level === SKILL_BRANCH_LEVEL
        && slot.branch === null
        && hasBranches(choice.id)
      ) {
        w.pendingBranchChoices.push(choice.id);
      }
    }
    return;
  }

  if (def.kind === 'utility') {
    // 쓰던 유틸이 있으면 **레벨을 그대로 물려주고** 갈아탑니다.
    // 상한을 다시 씌우는 이유는 `SKILL_MAX_LEVEL` 을 낮췄을 때 옛 슬롯이 넘칠 수 있어서입니다
    const level = Math.min(SKILL_MAX_LEVEL, Math.max(1, choice.level));
    p.utility = makeSlot(choice.id, level);
    w.skillsTaken++;
    announce(w, level > 1 ? `${def.name} Lv.${level}` : `${def.name} 획득`);
    return;
  }

  const empty = p.attacks.indexOf(null);
  if (empty < 0) return; // 3칸이 차면 새 공격 스킬은 애초에 선택지에 나오지 않습니다
  p.attacks[empty] = makeSlot(choice.id, 1);

  // 해금 조건에 쓰이는 "획득한 스킬 수"
  w.skillsTaken++;
  announce(w, `${def.name} 획득`);
}

/**
 * 강화 갈래를 적용합니다. **한 번 고르면 판이 끝날 때까지 못 바꿉니다.**
 * 되돌릴 수 있으면 6레벨의 선택이 결정이 아니라 잠깐의 설정이 됩니다.
 */
export function applyBranchChoice(w: World, id: SkillId, branchId: SkillBranchId): void {
  const slot = w.player.attacks.find((s) => s?.id === id) ?? null;
  if (!slot || slot.branch !== null) return;
  slot.branch = branchId;
  const def = getSkillDef(id);
  const branch = branchDef(branchId);
  announce(w, `${def.name} · ${branch?.name ?? branchId}`);
}

/**
 * 선택 결과는 오른 스탯 뒤에 이어서 띄웁니다.
 * 같이 뜨면 두 정보가 겹쳐서 결국 둘 다 못 읽습니다.
 */
function announce(w: World, text: string): void {
  w.queueNotice(text, '#ffcc4d', 18, w.noticeTail() + LEVEL_NOTICE.skillGap, -60);
}
