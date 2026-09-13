import { SKILL_MAX_LEVEL } from '../data/balance';
import { ownedSlots } from '../game/player';
import type { World } from '../game/world';
import type { SkillId } from '../skills/types';
import type { SaveData, SkillDexEntry } from './save';

/**
 * 스킬 도감 (2026-09-13).
 *
 * 스킬마다 **가 본 레벨까지의 효과**와 **고른 적 있는 갈래의 효과**만 보입니다.
 * 추적 미사일을 4레벨까지 써 봤으면 1~4레벨이 보이고 5레벨부터는 가려집니다.
 *
 * **클리어한 판만 기록합니다.** 죽거나 나간 판은 안 남습니다. 클리어가 곧 "그 빌드로
 * 끝까지 가 봤다"는 증거라, 초반에 레벨만 찍고 죽는 판으로 도감을 채우지 않게 합니다.
 * 클리어한 뒤에 죽는 것은 클리어입니다 (`World.cleared` 규칙 그대로).
 *
 * **개발자 모드의 "도감 전체 보기"는 여기도 엽니다.** 적 도감과 같은 스위치이고 같은
 * 규칙입니다. 저장은 안 건드립니다.
 */

function devAll(save: SaveData): boolean {
  return save.devMode && save.devBestiary;
}

export function skillDexEntry(save: SaveData, id: SkillId): SkillDexEntry {
  return save.skillDex[id] ?? { level: 0, branches: [] };
}

/** 보이는 최고 레벨. 0 이면 그 스킬 자체가 잠겨 있습니다 */
export function skillDexLevel(save: SaveData, id: SkillId): number {
  if (devAll(save)) return SKILL_MAX_LEVEL;
  return skillDexEntry(save, id).level;
}

/** 그 갈래를 고른 적이 있는가 */
export function knowsBranch(save: SaveData, id: SkillId, branchId: string): boolean {
  if (devAll(save)) return true;
  return skillDexEntry(save, id).branches.includes(branchId);
}

/**
 * 판이 끝날 때 부릅니다 (`commitRun`). 클리어 못 한 판이면 아무것도 안 하고 false 입니다.
 *
 * **기록은 줄지 않습니다.** 레벨은 최고값, 갈래는 합집합입니다. 판 끝의 슬롯도 한 번 더
 * 적어 두는데, 레벨을 올리는 길 중 하나가 `noteSkill` 을 빠뜨려도 여기서 메워집니다.
 */
export function recordSkillDex(save: SaveData, w: World): boolean {
  if (!w.cleared) return false;
  for (const s of ownedSlots(w.player)) w.noteSkill(s);
  for (const [id, log] of w.skillLog) {
    const prev = skillDexEntry(save, id);
    save.skillDex[id] = {
      level: Math.max(prev.level, Math.min(SKILL_MAX_LEVEL, log.level)),
      branches: [...new Set([...prev.branches, ...log.branches])],
    };
  }
  return true;
}
