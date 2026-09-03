import { SKILL_BRANCHES } from '../data/balance';
import type { SkillBranchDef, SkillBranchId } from '../data/balance';
import type { SkillSlot } from '../game/types';
import type { SkillId } from './types';

/**
 * 6레벨 강화 갈래를 읽는 곳입니다.
 *
 * **이 파일에는 숫자가 없습니다.** 중립값 1 과 null 뿐입니다. 갈래의 모든 수치는
 * `data/balance.ts` 의 `SKILL_BRANCHES` 한 곳에 있습니다 (CLAUDE.md 규칙 1).
 *
 * 설계의 중심은 하나입니다. **분기는 "if" 가 아니라 "곱하는 값"입니다.**
 * 24갈래를 `if (slot.branch === 'mineGiant')` 로 표현하면 registry 12곳이 조건문
 * 덤불이 되어 손을 못 댑니다. 그래서 분기 상태를 읽는 함수는 `branchMods` 하나뿐이고,
 * 그것은 **분기가 없어도 완전히 채워진 묶음**(전부 중립값)을 돌려줍니다.
 * 그래서 부르는 쪽은 갈래가 있는지 없는지 물어볼 일이 없습니다.
 */

/** 명중한 적에게 붙일 화상. `dps` 는 **공격력 배수**입니다 */
export interface BranchBurn {
  dps: number;
  time: number;
}

/**
 * 완전히 채워진 갈래 효과. `*Mul` 은 곱하고 나머지는 덮어씁니다.
 *
 * 덮어쓰기 항목이 `null` 이면 "이 갈래는 그것을 안 건드린다"는 뜻이라,
 * 부르는 쪽은 `b.spread ?? 원래값` 한 줄이면 됩니다.
 */
export interface BranchMods {
  cooldownMul: number;
  damageMul: number;
  countMul: number;
  sizeMul: number;
  rangeMul: number;
  durationMul: number;
  cadenceMul: number;
  jumpsMul: number;
  pierceMul: number;
  pullMul: number;
  hpBonusMul: number;
  speedMul: number;
  knockbackMul: number;
  stunMul: number;
  spreadMul: number;
  turnRateMul: number;

  spread: number | null;
  falloff: number | null;
  slow: number | null;
  stunOnHit: number | null;
  burn: BranchBurn | null;
  blastHazard: SkillBranchDef['blastHazard'] | null;
  execute: SkillBranchDef['execute'] | null;
  cluster: SkillBranchDef['cluster'] | null;
  splitOnHit: SkillBranchDef['splitOnHit'] | null;
  orbFragment: SkillBranchDef['orbFragment'] | null;
  endBlast: SkillBranchDef['endBlast'] | null;
}

/** 갈래가 없을 때. 곱해도 더해도 아무 일이 없는 값들입니다 */
export const NEUTRAL_MODS: Readonly<BranchMods> = Object.freeze({
  cooldownMul: 1,
  damageMul: 1,
  countMul: 1,
  sizeMul: 1,
  rangeMul: 1,
  durationMul: 1,
  cadenceMul: 1,
  jumpsMul: 1,
  pierceMul: 1,
  pullMul: 1,
  hpBonusMul: 1,
  speedMul: 1,
  knockbackMul: 1,
  stunMul: 1,
  spreadMul: 1,
  turnRateMul: 1,

  spread: null,
  falloff: null,
  slow: null,
  stunOnHit: null,
  burn: null,
  blastHazard: null,
  execute: null,
  cluster: null,
  splitOnHit: null,
  orbFragment: null,
  endBlast: null,
});

/**
 * 표의 갈래를 중립값 위에 덮어 완성해 둡니다. 모듈이 처음 읽힐 때 한 번만 돕니다.
 * 매 발동마다 만들면 초당 수백 번 객체가 생깁니다.
 */
function resolve(): Record<string, Readonly<BranchMods>> {
  const out: Record<string, Readonly<BranchMods>> = {};
  for (const list of Object.values(SKILL_BRANCHES)) {
    for (const def of list as readonly SkillBranchDef[]) {
      const mods: BranchMods = { ...NEUTRAL_MODS };
      for (const [key, value] of Object.entries(def)) {
        // id·name·desc 는 효과가 아닙니다
        if (key === 'id' || key === 'name' || key === 'desc') continue;
        (mods as unknown as Record<string, unknown>)[key] = value;
      }
      out[def.id] = Object.freeze(mods);
    }
  }
  return out;
}

const RESOLVED = resolve();

/**
 * **분기 상태를 읽는 유일한 함수입니다.** 항상 완전히 채워진 것을 돌려줍니다.
 * 갈래가 없으면 중립 상수를 그대로 주므로 새 객체가 안 생깁니다.
 */
export function branchMods(slot: SkillSlot | null | undefined): Readonly<BranchMods> {
  if (!slot || !slot.branch) return NEUTRAL_MODS;
  return RESOLVED[slot.branch] ?? NEUTRAL_MODS;
}

/** 갈래 id 로 효과 묶음을 바로 얻습니다 (선택 카드가 "고르면 어떻게 되는지" 보여줄 때) */
export function modsOf(id: SkillBranchId): Readonly<BranchMods> {
  return RESOLVED[id] ?? NEUTRAL_MODS;
}

/** 이 스킬의 갈래 둘. 갈래가 없는 스킬(유틸)은 빈 배열입니다 */
export function branchesFor(id: SkillId): readonly SkillBranchDef[] {
  return (SKILL_BRANCHES as Record<string, readonly SkillBranchDef[]>)[id] ?? [];
}

/** 갈래 하나의 정의 (이름·설명을 화면에 쓸 때) */
export function branchDef(id: SkillBranchId | null): SkillBranchDef | null {
  if (!id) return null;
  for (const list of Object.values(SKILL_BRANCHES)) {
    for (const def of list as readonly SkillBranchDef[]) if (def.id === id) return def;
  }
  return null;
}

/** 이 스킬에 갈래가 있는가 */
export function hasBranches(id: SkillId): boolean {
  return branchesFor(id).length > 0;
}
