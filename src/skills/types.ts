import type { SkillSlot } from '../game/types';
import type { World } from '../game/world';
import type { BranchMods } from './branches';

export type SkillId =
  | 'shotgun'
  | 'sniper'
  | 'flame'
  | 'laser'
  | 'grenade'
  | 'missile'
  | 'chain'
  | 'ricochet'
  | 'harpoon'
  | 'orbit'
  | 'mine'
  | 'aura'
  | 'dash'
  | 'knockback'
  | 'timeslow'
  | 'medkit';

/**
 * 자동 타겟팅 규칙. 이 게임의 핵심 장치입니다.
 * 전부 "가장 가까운 적"으로 만들면 소환적을 아무도 못 잡고 빌드의 의미가 사라집니다.
 */
export type TargetingRule =
  | 'nearest'
  | 'farthest'
  | 'densestDir'
  | 'densestPoint'
  | 'bestLine'
  | 'lowestHp'
  | 'highestHp'
  | 'none';

/**
 * 공격 스킬의 계열 (2026-08-12).
 *
 * **패시브 스킬이 이 이름을 그대로 부릅니다.** "폭발 피해 +40%" 라고 써 놓고
 * 어떤 스킬이 폭발인지 화면 어디에도 안 적혀 있으면 매번 추측해야 합니다.
 * 그래서 계열은 **스킬 카드에 반드시 보여야 하고**, 스킬 하나는 **계열을 정확히 하나만**
 * 가집니다. 두 계열에 걸치는 스킬이 하나라도 생기면 "폭발 강화가 이것에도 걸리나"를
 * 다시 물어야 해서 태그를 붙인 의미가 사라집니다.
 *
 * 계열은 **눈에 보이는 동작과 일치해야 합니다.** 추적 미사일이 터지는데 폭발 계열이
 * 아니면 화면과 표가 어긋납니다. 새 스킬을 만들 때는 계열부터 정하고 동작을 맞추십시오.
 *
 * - `bullet` **탄환**: 날아가서 맞은 하나에 꽂힙니다 (산탄, 스나이퍼)
 * - `pierce` **관통**: 발동 즉시 여러 대상을 한 번에 훑습니다 (레이저, 체인)
 * - `blast` **폭발**: 반경 안에 있는 것 전부를 한꺼번에 때립니다 (유탄, 지뢰, 추적 미사일)
 * - `overtime` **지속**: 한 번에 조금씩, 시간에 걸쳐 쌓습니다 (화염방사기, 오라, 회전 궤도)
 */
export type SkillFamily = 'bullet' | 'pierce' | 'blast' | 'overtime';

export const SKILL_FAMILY_LABEL: Record<SkillFamily, string> = {
  bullet: '탄환',
  pierce: '관통',
  blast: '폭발',
  overtime: '지속',
};

// 계열 설명(`SKILL_FAMILY_DESC`)은 화면에서 뺐습니다. 뜻은 바로 위 `SkillFamily` 주석에 있습니다.
// 화면에 남는 것은 `SKILL_FAMILY_LABEL` 의 네 글자뿐입니다

/**
 * 스킬 종류. 칸 수와 조작이 종류마다 다릅니다.
 * - attack: 3칸까지. 쿨다운이 돌면 알아서 나갑니다
 * - utility: 1칸만. Q 로 직접 씁니다. 새로 고르면 쓰던 것과 교체됩니다
 *
 * 조준 조작이 없는 게임이라 공격은 손이 갈 이유가 없고, 판단이 필요한 것은
 * "언제 쓰느냐"뿐입니다. 그 판단이 있는 스킬만 손에 맡깁니다.
 */
export type SkillKind = 'attack' | 'utility';

export interface SkillDef {
  id: SkillId;
  kind: SkillKind;
  /**
   * 공격 스킬의 계열. 유틸은 없습니다 (패시브가 유틸을 계열로 부르지 않습니다).
   * 새 공격 스킬을 만들면 반드시 채우십시오. `scripts/smoke.ts` 가 빠진 것을 잡습니다.
   */
  family?: SkillFamily;
  name: string;
  color: string;
  targeting: TargetingRule;
  /** 선택 화면과 도감에 그대로 보여줄 타겟팅 설명 */
  targetingLabel: string;
  desc: string;
  /** 주 상대 (기획.md 5장 표) */
  counters: string;
  /** 지속형 스킬인지 */
  sustained: boolean;
  cooldown: number;
  /** 발동. 대상이 없어 실패하면 false 를 돌려주고 쿨다운을 돌리지 않습니다 */
  activate: (w: World, slot: SkillSlot) => boolean;
  /** 지속형 스킬이 매 프레임 하는 일 */
  sustain?: (w: World, slot: SkillSlot, dt: number) => void;
  /**
   * 레벨별 효과 요약. **갈래를 고른 뒤에는 그 배율이 반영된 값이어야 합니다.**
   * 안 그러면 7레벨 카드가 갈래 전 수치를 보여주면서 거짓말을 합니다.
   *
   * `activate` 와 **똑같은 식**을 쓰십시오. 그래야 표시와 실제가 구조적으로
   * 어긋날 수 없습니다. 갈래가 안 건드리는 스킬은 매개변수를 **아예 받지 마십시오**
   * (`noUnusedParameters` 로 타입 검사가 막힙니다).
   *
   * 전방위·장판처럼 숫자로 안 나오는 것은 여기 넣지 말고 갈래 카드의 `desc` 로
   * 보여주십시오. 이 함수는 "숫자가 얼마가 되는가"만 맡습니다.
   */
  levelText: (level: number, mods?: Readonly<BranchMods>) => string;
}
