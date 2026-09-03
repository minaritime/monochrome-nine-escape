/**
 * 자동 플레이 봇. `survival.ts` 와 `levelcurve.ts` 가 같이 씁니다.
 *
 * **두 스크립트에 따로 두지 마십시오.** 예전에는 각자 복사본을 들고 있었는데,
 * survival 쪽 봇만 고치고 levelcurve 쪽은 그대로 두는 바람에 두 측정이 서로 다른
 * 실력의 봇으로 잰 값이 되어 한참을 헤맸습니다. 봇을 고치면 두 측정이 같이 움직여야 합니다.
 *
 * 봇은 사람보다 약합니다. 남은 격차는 아래 하나입니다.
 * - **대시를 위기에 아껴 쓰지 못합니다.** 쿨이 돌면 그냥 씁니다. 무적 0.36초를
 *   언제 쓰느냐가 대시의 전부인데 그 판단이 없습니다. 흉내 내려면 봇을 크게 고쳐야 하고,
 *   그러다 보면 봇을 만드는 일이 게임을 만드는 일을 밀어냅니다.
 */
import { CANVAS, PASSIVE, PERM_UPGRADES, REVIVE_UPGRADE, SKILLS, type SkillBranchId, type StatKey } from '../src/data/balance';
import { World } from '../src/game/world';
import { branchMods, branchesFor } from '../src/skills/branches';
import { getSkillDef } from '../src/skills/registry';
import { emptySave } from '../src/meta/save';
import { applyBranchChoice } from '../src/progression/skillChoice';
import type { SkillChoice } from '../src/progression/skillChoice';
import type { SkillId } from '../src/skills/types';

/** 봇이 정한 이동 방향을 그대로 돌려주는 입력 */
export class BotInput {
  dir = { x: 0, y: 0 };
  beginStep(): void {}
  isDown(): boolean {
    return false;
  }
  wasPressed(): boolean {
    return false;
  }
  moveVector(): { x: number; y: number } {
    return this.dir;
  }
  clear(): void {}
  clearPresses(): void {}
}

const SAMPLES = 32;
/** 이 시간 뒤의 위치를 보고 판단합니다 (가까운 위협과 포위를 같이 봅니다) */
const LOOKAHEADS = [0.35, 0.9];
const DANGER_RANGE = 300;

/** 후보 지점의 위험도. 낮을수록 안전합니다 */
function dangerAt(w: World, x: number, y: number, lookahead: number): number {
  let score = 0;

  for (const e of w.enemies) {
    if (e.dead) continue;
    // 적도 같이 움직인다고 보고 앞을 내다봅니다
    const ex = e.x + e.vx * lookahead;
    const ey = e.y + e.vy * lookahead;
    const d = Math.hypot(ex - x, ey - y) - e.radius;
    if (d > DANGER_RANGE) continue;
    const near = Math.max(0, (DANGER_RANGE - d) / DANGER_RANGE);
    // 아프고 빠른 적을 더 무서워합니다
    const threat = 1 + e.damage / 20 + e.speed / 200 + (e.boss ? 6 : 0);
    score += near * near * threat * 100;
    if (d < e.radius + 22) score += 4000; // 접촉 직전
  }

  for (const p of w.projectiles) {
    if (p.dead || p.friendly) continue;
    const px = p.x + p.vx * lookahead;
    const py = p.y + p.vy * lookahead;
    const d = Math.hypot(px - x, py - y);
    if (d > 160) continue;
    score += ((160 - d) / 160) ** 2 * 900;
  }

  // 장판은 안에 들어간 뒤에만 세면 발을 들여놓고 나서야 나옵니다. 가장자리부터 꺼립니다
  for (const h of w.hazards) {
    // 내가 깐 장판(화염 지뢰)은 나를 안 때립니다. 여기서 안 걸러내면 봇이 자기 불에서
    // 도망다녀 생존 시간이 밸런스와 무관하게 떨어집니다
    if (h.side !== 'player') continue;
    const d = Math.hypot(h.x - x, h.y - y) - h.radius;
    if (d < 0) score += 700;
    else if (d < 60) score += ((60 - d) / 60) * 260;
  }

  // 곧 터질 자리 (자폭적 시체 폭발, 폭격기). 예고를 보고 비키는 것이 이 게임의 기본인데
  // 예전 봇은 이 목록을 아예 안 봐서 예고 한가운데 서 있다가 그대로 맞았습니다
  for (const b of w.pendingBlasts) {
    if (b.dead) continue;
    const d = Math.hypot(b.x - x, b.y - y) - b.radius;
    if (d > 90) continue;
    // 터질 때가 가까울수록 더 급합니다. 아직 멀면 지나갈 여유가 있습니다
    const urgency = 1 / Math.max(0.35, b.delay);
    score += (d < 0 ? 1 : (90 - d) / 90) * 900 * urgency;
  }

  // 돌진 경로(line)와 곧 터질 원(incoming). spawn·blast 는 피할 것이 아니라 이미 지난 일입니다
  for (const t of w.telegraphs) {
    if (t.dead) continue;
    if (t.kind === 'line') {
      const dx = t.x2 - t.x;
      const dy = t.y2 - t.y;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) continue;
      // 선분 위의 가장 가까운 점까지 거리
      const u = Math.max(0, Math.min(1, ((x - t.x) * dx + (y - t.y) * dy) / len2));
      const d = Math.hypot(t.x + dx * u - x, t.y + dy * u - y) - t.width / 2;
      if (d < 70) score += (d < 0 ? 1 : (70 - d) / 70) * 1400;
    } else if (t.kind === 'incoming') {
      const d = Math.hypot(t.x - x, t.y - y) - t.radius;
      if (d < 70) score += (d < 0 ? 1 : (70 - d) / 70) * 800;
    }
  }

  // 벽에 붙으면 도망갈 방향이 줄어듭니다
  const margin = 90;
  const wall = Math.min(x, y, CANVAS.w - x, CANVAS.h - y);
  if (wall < margin) score += ((margin - wall) / margin) ** 2 * 700;

  return score;
}

function scoreDirection(w: World, dx: number, dy: number): number {
  const p = w.player;
  let total = 0;
  for (const la of LOOKAHEADS) {
    const reach = p.stats.moveSpeed * la;
    const nx = Math.max(0, Math.min(CANVAS.w, p.x + dx * reach));
    const ny = Math.max(0, Math.min(CANVAS.h, p.y + dy * reach));
    total += dangerAt(w, nx, ny, la);
  }
  return total;
}

export function decideMove(w: World): { x: number; y: number } {
  let bestScore = scoreDirection(w, 0, 0) * 1.05; // 제자리는 살짝 불리하게
  let best = { x: 0, y: 0 };

  for (let i = 0; i < SAMPLES; i++) {
    const a = (i / SAMPLES) * Math.PI * 2;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const s = scoreDirection(w, dx, dy);
    if (s < bestScore) {
      bestScore = s;
      best = { x: dx, y: dy };
    }
  }
  return best;
}

/**
 * 유틸 스킬을 지금 써도 되는가.
 *
 * 공격 스킬은 원래 자동이라 쿨이 돌면 그냥 나가지만, **유틸은 손으로 쓰는 스킬**이라
 * 봇도 판단을 흉내 내야 측정이 의미를 갖습니다. 넉백이 최대 체력의 20% 를 태우게 된
 * 뒤로는, 쿨마다 누르는 봇이 다섯 번 만에 스스로 죽어서 생존 시간이 스킬 성능이 아니라
 * "넉백을 뽑았는가"로 정해졌습니다.
 */
function shouldUse(w: World, id: string): boolean {
  const p = w.player;
  if (id === 'knockback') {
    // 대가를 치르고도 살아남을 수 있을 때만 씁니다
    const cost = p.stats.maxHp * SKILLS.knockback.selfDamageRatio;
    return p.hp - cost > p.stats.maxHp * 0.25;
  }
  // 의약품은 가득 차 있으면 스킬 쪽에서 알아서 false 를 돌려줍니다
  return true;
}

/** 쿨이 돌아온 스킬을 씁니다. 공격은 어차피 자동이고 유틸만 판단이 들어갑니다 */
export function useSkills(w: World, slots: (import('../src/game/types').SkillSlot | null)[]): void {
  for (const slot of slots) {
    if (!slot || slot.cooldown > 0 || slot.active > 0) continue;
    if (!shouldUse(w, slot.id)) continue;
    const def = getSkillDef(slot.id);
    // 쿨다운 감소 스탯은 예전처럼 일부러 무시합니다. 여기서 같이 고치면 봇 생존 시간이
    // 통째로 움직여서 CLAUDE.md 의 비교표가 끊깁니다. 갈래 배율만 반영합니다
    if (def.activate(w, slot)) slot.cooldown = def.cooldown * branchMods(slot).cooldownMul;
  }
}

/**
 * 봇이 6레벨 갈래를 고르는 방식.
 * - `none` 갈래를 안 고릅니다 (분기 시스템이 없던 때와 같은 상태 = 대조군)
 * - `enhance` 항상 1번(강화)
 * - `special` 항상 2번(특수)
 *
 * **무작위로 고르지 않습니다.** `w.rng` 를 쓰면 그 판의 이후 난수가 통째로 밀려서
 * 시드 고정과 예전 측정값 비교가 어긋납니다. 그리고 무작위면 시드마다 빌드가
 * 달라져서 갈래의 효과가 아니라 운을 재게 됩니다.
 */
export type BranchMode = 'none' | 'enhance' | 'special';

export const BRANCH_MODE_LABEL: Record<BranchMode, string> = {
  none: '갈래 없음',
  enhance: '강화(1번)',
  special: '특수(2번)',
};

let branchMode: BranchMode = 'enhance';

export function setBranchMode(mode: BranchMode): void {
  branchMode = mode;
}

/**
 * 6레벨 강화 갈래를 고릅니다.
 *
 * **큐는 어느 모드에서든 반드시 비웁니다.** `none` 이라고 그냥 두면 큐가 무한히
 * 쌓이고, 그 측정은 "분기가 없는 게임"이 아니라 "큐가 터진 게임"이 됩니다.
 */
export function drainBranches(w: World): void {
  while (w.pendingBranchChoices.length > 0) {
    const id = w.pendingBranchChoices.shift()!;
    if (branchMode === 'none') continue;
    const list = branchesFor(id);
    if (list.length === 0) continue;
    const pick = branchMode === 'special' && list.length > 1 ? list[1] : list[0];
    applyBranchChoice(w, id, pick.id as SkillBranchId);
  }
}

/**
 * 레벨업 선택지 중 하나를 고릅니다.
 *
 * 예전에는 `choices[0]` 을 그냥 집었는데, 선택지는 위치로 눈치채지 못하게 섞여서 나오므로
 * **사실상 무작위 빌드**였습니다. 스킬 상한이 7 이 되고 선택이 판당 19회로 늘어난 뒤로는
 * 이게 결정적인 차이가 됩니다. 사람은 두 개에 몰아서 만렙을 만드는데 봇은 열아홉 번을
 * 네 스킬에 고르게 흩뿌려서 전부 4~5레벨에 머뭅니다. **상한을 7 로 올린 조정의 이득을
 * 봇만 못 누리는 구조**라, 봇 수치가 실제보다 2~3배 나쁘게 나왔습니다.
 *
 * 사람 흉내는 이 정도면 됩니다. 빈 칸부터 채우고, 다 차면 **이미 가장 높은 것**을 올립니다.
 */
export function pickChoice(w: World, choices: SkillChoice[]): SkillChoice {
  const p = w.player;
  const hasFreeAttack = p.attacks.some((s) => s === null);

  // 유틸이 없으면 하나 잡습니다. 있으면 갈아타지 않습니다 (레벨이 1로 돌아갑니다)
  if (!p.utility) {
    const util = choices.find((c) => getSkillDef(c.id).kind === 'utility');
    if (util) return util;
  }
  const keep = choices.filter((c) => !c.replacesUtility);
  const pool = keep.length > 0 ? keep : choices;

  if (hasFreeAttack) {
    const fresh = pool.find((c) => !c.upgrade && getSkillDef(c.id).kind === 'attack');
    if (fresh) return fresh;
  }

  const levelOf = (id: string) =>
    p.attacks.find((s) => s?.id === id)?.level ?? (p.utility?.id === id ? p.utility.level : 0);
  const upgrades = pool.filter((c) => c.upgrade).sort((a, b) => levelOf(b.id) - levelOf(a.id));
  return upgrades[0] ?? pool[0];
}

/**
 * 상점을 얼마나 샀는가. 세 단계로 나눠 잽니다.
 *
 * - `none` 첫 판. 아무것도 안 산 상태
 * - `half` 각 항목을 절반 단계까지. 어느 정도 모은 계정
 * - `full` 살 수 있는 것을 전부. 상한을 보기 위한 조건
 *
 * 영구 강화가 20단계가 되면서 `none` 과 `full` 의 격차가 너무 벌어져,
 * 둘만 재면 "실제로 사람들이 노는 구간"이 그 사이 어디에도 안 잡힙니다.
 */
export type ShopTier = 'none' | 'half' | 'full';

export const TIER_LABEL: Record<ShopTier, string> = {
  none: '상점 없음',
  half: '절반 구매',
  full: '전부 구매',
};

export function saveFor(tier: ShopTier) {
  const save = emptySave();
  if (tier === 'none') return save;

  const ratio = tier === 'full' ? 1 : 0.5;
  for (const up of PERM_UPGRADES) save.perm[up.key] = Math.round(up.costs.length * ratio);
  save.perm[REVIVE_UPGRADE.key] = Math.round(REVIVE_UPGRADE.costs.length * ratio);

  /**
   * 성장 패시브. 봇은 **공격력 하나에 몰고 나머지 칸을 봉인하는** 빌드를 씁니다.
   *
   * 전부 구매는 2칸 봉인 + 공격력 하나(지정 몫 70% 를 통째로), 절반 구매는 봉인 없이
   * 3칸에 세 개를 끼웁니다. 이렇게 나눈 이유는 봉인이 이 시스템의 핵심 선택이라
   * "산 사람과 안 산 사람"의 차이를 재려면 그 축이 측정에 들어와야 하기 때문입니다.
   */
  const focus: StatKey[] = ['attack', 'maxHp', 'fireRate'];
  save.unlockedPassives = tier === 'full' ? [...focus] : focus.slice(0, 3);
  if (tier === 'full') {
    save.sealsOwned = PASSIVE.sealCosts.length;
    save.sealedSlots = PASSIVE.sealCosts.length;
    save.equippedPassives = ['attack', null, null];
  } else {
    save.equippedPassives = [...focus];
  }
  // 시작 스킬은 절반이면 1개, 전부면 2개 (`MAX_START_ATTACKS`)
  // `satisfies` 라야 오타난 스킬 id 가 이 자리에서 잡힙니다.
  // `as SkillId[]` 로 덮으면 없는 이름을 적어도 그냥 통과합니다
  const skills = (['orbit', 'aura'] satisfies SkillId[]).slice(0, tier === 'full' ? 2 : 1);
  save.unlockedStartSkills = skills;
  save.equippedStartSkills = skills;
  return save;
}

export function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}분 ${String(s).padStart(2, '0')}초`;
}
