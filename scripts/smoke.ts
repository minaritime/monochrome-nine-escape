/**
 * 브라우저 없이 게임 로직만 돌려보는 점검 스크립트입니다.
 * 렌더링을 제외한 전 구간(적 14종 + 보스 + 스킬 14종 + 성장 + 스폰)을 실행해
 * 예외나 NaN 이 나오는지 봅니다.
 *
 *   npx esbuild scripts/smoke.ts --bundle --format=esm --platform=node --outfile=.smoke.mjs
 *   node .smoke.mjs
 */
import { readFileSync } from 'node:fs';
import {
  ALL_BOSS_IDS,
  BASE_STATS,
  BASE_WEIGHT,
  BOSS,
  CLEAR_BONUS,
  BOSS_PREDATOR,
  BOSS_PREDATOR_HARD,
  BOSS_BOMBARD,
  BOSS_BOMBARD_HARD,
  SETTINGS,
  SKIP_UPGRADE,
  BOSS_SWARM,
  CANVAS,
  DIFFICULTY,
  ELITE,
  ELITE_TRAITS,
  LEVEL,
  ENEMY_BASE,
  ENEMY_BULLET,
  ENEMY_PARAMS,
  ENEMY_TABLE,
  HARD_DIFFICULTY_STEPS,
  FIXED_DT,
  MAX_UTILITY_CHOICES_PER_ROLL,
  SKILLS,
  SKILL_BRANCHES,
  SKILL_BRANCH_LEVEL,
  SKILL_MAX_LEVEL,
  ARMS_UPGRADE,
  PASSIVE,
  PERM_HARD_MAX_LEVEL,
  PERM_MAX_LEVEL,
  PERM_UPGRADES,
  START_SKILL_LEVEL_UPGRADE,
  STAT_DEFS,
  STAT_GAINS_PER_LEVEL,
  STATUS,
  OVERTIME,
  SPAWN,
  TIME_SCALING,
  VIEW,
  XP_UPGRADE,
  type EnemyId,
  type SkillBranchDef,
  type SkillBranchId,
  type StatKey,
} from '../src/data/balance';
import { dist } from '../src/core/math';
import { bomberIgnite, cowardEnraged, rangedAimTime, rangedAttackRange, sealerSealTime } from '../src/enemies/behaviors/special';
import { chargerTelegraphTime } from '../src/enemies/behaviors/advanced';
import { bossIdForSpawn } from '../src/enemies/boss';
import { eliteMul, rollElite } from '../src/enemies/elite';
import { killerOf } from '../src/game/killer';
import { Input } from '../src/core/input';
import { World, isSkillLevel } from '../src/game/world';
import { createPlayer, ownedSlots } from '../src/game/player';
import { rollStatGains } from '../src/progression/levelup';
import { addStat, createStats } from '../src/game/stats';
import { openSlots, setSealed, togglePassive } from '../src/meta/shop';
import { clampDifficulty, clearedAllFrom, difficultyEffects, difficultyKey, difficultyMods, hasCleared, unlockTimeFor } from '../src/meta/difficulty';
import { commitRun } from '../src/meta/bestiary';
import { emptySave, fromJSON, type SaveData } from '../src/meta/save';
import {
  attackSlotCount,
  buyPerm,
  isSkipUnlimited,
  maxStartFor,
  permNextCost,
  permMaxLevel,
  purchasedCount,
  purchasedCountAll,
  startSkillLevel,
  totalPurchasable,
  totalPurchasableAll,
  xpMultiplier,
} from '../src/meta/shop';
import { ACHIEVEMENTS, fastestEnemySpeed, tierName } from '../src/data/achievements';
import {
  achieveProgress,
  checkAchievements,
  commitAchieveStats,
  resetAchievements,
  unlockDirect,
  visibleAchievements,
} from '../src/meta/achievements';
import { ALL_ENEMY_IDS, getEnemyDef } from '../src/enemies/registry';
import { HARD_LASER } from '../src/data/balance';
import { LATEST_PATCH, PATCH_NOTES, visiblePatchNotes } from '../src/data/patchnotes';
import { ALL_SKILL_IDS, getSkillDef, lv, makeSlot, slotCooldown } from '../src/skills/registry';
import { ATTACK_SKILL_IDS, UTILITY_SKILL_IDS } from '../src/skills/registry';
import { SKILL_FAMILY_LABEL, type SkillFamily } from '../src/skills/types';
import { priestRadius } from '../src/enemies/behaviors/advanced';
import { canTarget } from '../src/skills/targeting';
import { generateSkillChoices, applySkillChoice, applyBranchChoice } from '../src/progression/skillChoice';
import { NEUTRAL_MODS, branchesFor, modsOf } from '../src/skills/branches';
import { PANEL_BG, PANEL_BG_HARD, drawIdleBackground, drawWorld } from '../src/render/scene';
import { drawHud } from '../src/ui/hud';
import { isMobileLayout, isTouchDevice } from '../src/ui/touch';
import type { Renderer, TextOptions } from '../src/render/renderer';

/**
 * 그린 글자만 받아 적는 렌더러.
 *
 * HUD 배치는 눈으로 볼 수밖에 없다고 미루기 쉽지만, "무엇이 어디에 그려졌는가"는
 * 좌표라 잴 수 있습니다. 실제로 `난이도 N` 이 체력바 위에 겹쳐 있던 것을 아무도
 * 못 잡고 있었습니다.
 *
 * **`begin` 의 offset 은 무시합니다.** HUD 는 경기장 기준 좌표로 그리고,
 * 여기서 재려는 것도 경기장 안에서의 자리입니다.
 */
function recordingRenderer(out: { s: string; x: number; y: number }[]): Renderer {
  const noop = () => {};
  return {
    width: VIEW.w,
    height: VIEW.h,
    begin: noop,
    end: noop,
    clear: noop,
    circle: noop,
    ring: noop,
    poly: noop,
    polyOutline: noop,
    line: noop,
    rect: noop,
    rectOutline: noop,
    arc: noop,
    cone: noop,
    fullscreenTint: noop,
    text: (str: string, x: number, y: number, _opts?: TextOptions) => {
      out.push({ s: str, x, y });
    },
  };
}

class FakeInput {
  private dir = { x: 1, y: 0 };
  private t = 0;
  beginStep(): void {
    this.t += FIXED_DT;
    const a = Math.sin(this.t * 0.7) * Math.PI;
    this.dir = { x: Math.cos(a), y: Math.sin(a) };
  }
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
}

const input = new FakeInput() as unknown as Input;

/**
 * 아무 키도 누르지 않는 입력.
 * FakeInput 은 플레이어를 계속 휘젓고 다니므로, 적 하나의 행동만 재려면
 * 플레이어가 제자리에 있어야 합니다. 그 판에는 이쪽을 넘겨 World 를 만듭니다.
 */
class StillInput {
  beginStep(): void {}
  isDown(): boolean {
    return false;
  }
  wasPressed(): boolean {
    return false;
  }
  moveVector(): { x: number; y: number } {
    return { x: 0, y: 0 };
  }
  clear(): void {}
}

const stillInput = new StillInput() as unknown as Input;

/** 기본공격에 죽지 않게 합니다. 행동만 재고 싶을 때 씁니다 */
function makeUnkillable(e: { hp: number; maxHp: number }): void {
  e.maxHp = 1e9;
  e.hp = e.maxHp;
}
/** 일반 추첨(패시브 없음)에서 공격력이 뽑힐 확률 %. 기대값 검산의 기준선입니다 */
function statChanceOfAttack(): number {
  const rollable = STAT_DEFS.filter((d) => d.rollable !== false);
  const wOf = (d: (typeof STAT_DEFS)[number]) => (d.major ? BASE_WEIGHT.major : BASE_WEIGHT.minor);
  const total = rollable.reduce((sum, d) => sum + wOf(d), 0);
  return (wOf(rollable.find((d) => d.key === 'attack')!) / total) * 100;
}

let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) {
    failures++;
    console.error(`  실패: ${label} ${detail}`);
  }
}

function finite(...values: number[]): boolean {
  return values.every((v) => Number.isFinite(v));
}

/**
 * @param afterStep 매 프레임 뒤에 부르는 훅. 시험 조건을 계속 유지해야 할 때 씁니다
 *   (예: "보스를 못 잡는 상황"은 등장하는 보스마다 매번 다시 걸어줘야 합니다)
 */
function step(
  w: World,
  seconds: number,
  godMode = true,
  useSkills = false,
  afterStep?: (w: World) => void,
): void {
  const steps = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < steps; i++) {
    input.beginStep();
    // 체력까지 되돌려야 진짜 무적입니다. 무적 시간만 켜면 넉백 폭발의 자해(`spendHp`)를
    // 못 막아서, 그 스킬을 뽑은 판만 도중에 죽어 시험이 통째로 짧아집니다
    if (godMode) {
      w.player.invuln = 1;
      w.player.hp = w.player.stats.maxHp;
    }

    // 실제 플레이처럼 쿨다운이 돌면 바로 씁니다
    if (useSkills) {
      for (const slot of ownedSlots(w.player)) {
        if (!slot || slot.cooldown > 0 || slot.active > 0) continue;
        const def = getSkillDef(slot.id);
        if (def.activate(w, slot)) slot.cooldown = def.cooldown;
      }
    }

    w.update(FIXED_DT);
    while (w.pendingSkillChoices > 0) {
      w.pendingSkillChoices--;
      const choices = generateSkillChoices(w);
      if (choices.length === 0) break;
      const c = choices[0];
      applySkillChoice(w, c);
    }
    // 갈래 큐를 안 비우면 무한히 쌓입니다. 오류가 안 나서 눈치채기 어렵습니다
    while (w.pendingBranchChoices.length > 0) {
      const id = w.pendingBranchChoices.shift()!;
      const list = branchesFor(id);
      if (list.length > 0) applyBranchChoice(w, id, list[0].id as SkillBranchId);
    }
    afterStep?.(w);
    if (w.gameOver) return;
  }
}

// ---------------------------------------------------------------------------
console.log('1) 14분 자동 플레이 (무적 · 스킬 자동 사용)');
{
  const w = new World(emptySave(), input, 12345);
  const marks = [60, 180, 300, 480, 660, 840];
  let last = 0;
  for (const m of marks) {
    step(w, m - last, true, true);
    last = m;
    const p = w.player;
    console.log(
      `   ${String(Math.round(w.time)).padStart(3)}초 · 적 ${String(w.enemies.length).padStart(2)} · ` +
        `Lv.${p.level} · 처치 ${w.stats.kills} · 코인 ${w.stats.coins} · 투사체 ${w.projectiles.length}`,
    );
    check('플레이어 좌표 유효', finite(p.x, p.y, p.hp));
    check('적 수 상한', w.enemies.length <= 90, `${w.enemies.length}`);
  }
  // 보스는 하나가 살아 있는 동안 다음이 나오지 않습니다. 못 잡으면 그 뒤로 보스가 끊깁니다
  const boss = w.enemies.find((e) => e.boss && !e.dead);
  const left = boss ? `${((boss.hp / boss.maxHp) * 100).toFixed(0)}%` : '없음';
  // **하드 전용 적은 여기서 세지 않습니다.** 일반 판에는 몇 분이 지나도 안 나오는 것이
  // 정상이라, 그것까지 세면 이 시험이 영영 안 통과합니다
  const normalIds = ALL_ENEMY_IDS.filter((id) => !ENEMY_TABLE[id].hardOnly);
  const missing = normalIds.filter((id) => !w.encountered.has(id));
  console.log(`   만난 종류 ${w.encountered.size} · 보스 등장 ${w.bossesSpawned}회 · 남은 보스 체력 ${left}`);
  if (missing.length) console.log(`   못 만난 종류 ${missing.join(', ')}`);
  check('보스가 등장했다', w.bossesSpawned >= 1, `${w.bossesSpawned}회`);
  check('14분 안에 전 종류를 만났다', missing.length === 0, `못 만남 ${missing.join(',')}`);
  check('하드 전용 적은 일반 판에 안 나온다', !w.encountered.has('priest'));
}

// ---------------------------------------------------------------------------
// 적 수는 표에서 셉니다. 손으로 적으면 적을 추가할 때마다 여기만 옛 숫자로 남습니다
console.log(`2) 적 ${ALL_ENEMY_IDS.length}종 단독 동작`);
for (const id of ALL_ENEMY_IDS) {
  const w = new World(emptySave(), input, 777);
  w.spawner.enabled = false;
  for (let i = 0; i < 4; i++) w.spawner.spawnNow(w, id, i === 0);
  step(w, 12);
  const bad = w.enemies.filter((e) => !finite(e.x, e.y, e.hp, e.vx, e.vy));
  check(`${id} 좌표 유효`, bad.length === 0);
  const outside = w.enemies.filter((e) => e.x < -5 || e.y < -5 || e.x > 1285 || e.y > 725);
  check(`${id} 화면 안`, outside.length === 0, `${outside.length}마리 이탈`);
  console.log(`   ${id.padEnd(9)} 생존 ${String(w.enemies.length).padStart(2)} · 처치 ${w.stats.kills}`);
}

// ---------------------------------------------------------------------------
console.log(`3) 스킬 ${ALL_SKILL_IDS.length}종 발동 (Lv.5)`);
for (const id of ALL_SKILL_IDS) {
  const w = new World(emptySave(), input, 999);
  w.spawner.enabled = false;
  for (let i = 0; i < 12; i++) w.spawner.spawnNow(w, 'basic');
  step(w, 0.2);

  const slot = makeSlot(id, 5);
  const def = getSkillDef(id);
  if (def.kind === 'utility') w.player.utility = slot;
  else w.player.attacks[0] = slot;
  let fired = 0;
  for (let i = 0; i < 6; i++) {
    // 긴급 의약품은 체력이 가득 차 있으면 일부러 발동하지 않습니다(20초 쿨을 헛되이
    // 태우지 않으려고). 회복할 것이 있는 상태를 만들어줘야 실제 동작을 봅니다
    if (id === 'medkit') w.player.hp = w.player.stats.maxHp * 0.4;
    // 넉백은 쓸 때마다 최대 체력의 20% 를 태웁니다. 다섯 번이면 스스로 죽어서
    // 뒤쪽 발동이 통째로 묻히므로, 여기서는 매번 체력을 되돌려 둡니다
    if (id === 'knockback') w.player.hp = w.player.stats.maxHp;
    if (def.activate(w, slot)) fired++;
    step(w, 1.2);
  }
  // 회전 궤도는 쿨다운이 없고 "개수가 맞으면 아무것도 안 한다"라서 항상 false 를 돌려줍니다.
  // 발동 여부 대신 구체가 실제로 돌고 있는지로 봅니다
  if (id === 'orbit') {
    check(`${id} 발동`, w.projectiles.some((p) => p.kind === 'orbit' && !p.dead), '구체가 돌지 않습니다');
  } else {
    check(`${id} 발동`, fired > 0, '한 번도 발동하지 못했습니다');
  }
  check(`${id} 좌표 유효`, finite(w.player.x, w.player.y));
  console.log(`   ${id.padEnd(10)} 발동 ${fired}회 · 처치 ${w.stats.kills}`);
}

// ---------------------------------------------------------------------------
console.log('3-0b) 도탄과 작살 (2026-08-12 추가)');
{
  // --- 도탄: 벽 튕김은 명중 횟수를 안 씁니다 ---
  {
    const w = new World(emptySave(), input, 8181);
    w.spawner.enabled = false;
    // 적을 딱 하나만 두고, 탄이 벽을 여러 번 오가게 둡니다
    const e = w.spawnEnemy('tank', 1200, 360, {});
    e.hp = 1e9;
    e.maxHp = 1e9;
    w.player.x = 100;
    w.player.y = 360;

    const slot = makeSlot('ricochet', 1);
    getSkillDef('ricochet').activate(w, slot);
    const shot = w.projectiles.find((p) => p.kind === 'ricochet')!;
    const before = shot.pierce;
    check('도탄이 나갔다', !!shot && before === SKILLS.ricochet.bounces, `${before}`);

    // 적을 화면 밖으로 치워 벽만 튕기게 합니다
    e.x = -9999;
    step(w, 3);
    const alive = w.projectiles.find((p) => p.kind === 'ricochet' && !p.dead);
    check('벽만 튕기면 명중 횟수가 안 줄어든다', !!alive && alive.pierce === before, alive ? `${alive.pierce}/${before}` : '탄이 사라졌습니다');
  }

  // --- 도탄: 맞히면 횟수가 줄고 다 쓰면 사라집니다 ---
  {
    const w = new World(emptySave(), input, 8282);
    w.spawner.enabled = false;
    w.player.x = CANVAS.w / 2;
    w.player.y = CANVAS.h / 2;
    for (let i = 0; i < 12; i++) {
      const t = w.spawnEnemy('tank', CANVAS.w / 2 + 60 + i * 30, CANVAS.h / 2, {});
      t.hp = 1e9;
      t.maxHp = 1e9;
    }
    const slot = makeSlot('ricochet', 1);
    getSkillDef('ricochet').activate(w, slot);
    step(w, 5);
    const left = w.projectiles.filter((p) => p.kind === 'ricochet' && !p.dead).length;
    check('명중 횟수를 다 쓰면 사라진다', left === 0, `${left}개 남음`);
  }

  // --- 작살: 앞쪽 적만 끌어당깁니다 ---
  {
    const w = new World(emptySave(), input, 8383);
    w.spawner.enabled = false;
    w.player.x = 200;
    w.player.y = 360;
    // 앞(오른쪽)에 하나, 뒤(왼쪽)에 하나. 작살은 가장 먼 적을 노리므로 오른쪽으로 던집니다
    const front = w.spawnEnemy('tank', 900, 360, {});
    const back = w.spawnEnemy('tank', 120, 360, {});
    front.hp = 1e9;
    front.maxHp = 1e9;
    back.hp = 1e9;
    back.maxHp = 1e9;
    const frontX = front.x;
    const backHp = back.hp;

    getSkillDef('harpoon').activate(w, makeSlot('harpoon', 1));
    // **밟기 전에 봅니다.** 작살은 즉발이라 발동 그 자리에서 판정이 끝나는데,
    // 한 프레임이라도 돌리면 기본공격이 바로 옆의 뒤쪽 적을 때려서 누구 피해인지 섞입니다
    check('뒤쪽 적은 안 맞는다', back.hp === backHp, `${backHp.toFixed(0)} → ${back.hp.toFixed(0)}`);
    check('앞쪽 적이 당기는 힘을 받는다', front.knockVx < 0, `${front.knockVx.toFixed(0)}`);

    w.player.attackTimer = 99;
    step(w, 0.5);
    check('앞쪽 적이 실제로 끌려온다', front.x < frontX - 20, `${frontX.toFixed(0)} → ${front.x.toFixed(0)}`);
  }

  // --- 작살은 "가장 먼 적"을 노립니다 (소환적을 잡을 유일한 수단) ---
  {
    const ids = ALL_SKILL_IDS.filter((id) => getSkillDef(id).targeting === 'farthest');
    console.log(`   "가장 먼 적" 타겟팅: ${ids.map((id) => getSkillDef(id).name).join(', ') || '없음'}`);
    check('"가장 먼 적"을 노리는 스킬이 있다', ids.length >= 1, '소환적을 잡을 수단이 사라집니다');
  }
}

console.log('3-0) 공격 스킬 계열이 빠짐없이 붙어 있는가');
{
  // 패시브 스킬이 계열 이름을 그대로 부릅니다 (`SkillFamily` 주석 참고).
  // 계열이 없는 공격 스킬이 하나라도 있으면 그 스킬만 모든 패시브에서 빠집니다
  const byFamily = new Map<string, string[]>();
  for (const id of ATTACK_SKILL_IDS) {
    const def = getSkillDef(id);
    check(`${def.name} 에 계열이 있다`, !!def.family, '공격 스킬은 계열이 필수입니다');
    if (!def.family) continue;
    const list = byFamily.get(def.family) ?? [];
    list.push(def.name);
    byFamily.set(def.family, list);
  }

  // 유틸에는 계열을 안 붙입니다. 붙이면 "폭발 강화가 넉백에도 걸리나"를 묻게 됩니다
  for (const id of UTILITY_SKILL_IDS) {
    check(`${getSkillDef(id).name} 에는 계열이 없다`, !getSkillDef(id).family);
  }

  for (const [fam, names] of byFamily) {
    console.log(`   ${SKILL_FAMILY_LABEL[fam as SkillFamily].padEnd(3)} ${names.join(', ')}`);
  }
  check('계열 네 가지가 다 쓰인다', byFamily.size === Object.keys(SKILL_FAMILY_LABEL).length, `${byFamily.size}종`);

  // 한 계열에 스킬이 하나뿐이면 그 계열 패시브는 사실상 그 스킬 전용이 됩니다.
  // 반대로 절반을 넘게 차지하면 그 계열 패시브가 무조건 정답이 됩니다
  for (const [fam, names] of byFamily) {
    const label = SKILL_FAMILY_LABEL[fam as SkillFamily];
    check(`${label} 계열이 2종 이상이다`, names.length >= 2, `${names.length}종`);
    check(`${label} 계열이 절반을 안 넘는다`, names.length <= ATTACK_SKILL_IDS.length / 2, `${names.length}/${ATTACK_SKILL_IDS.length}`);
  }
}

console.log('3-0c) 6레벨 강화 갈래');
{
  const table = SKILL_BRANCHES as unknown as Record<string, readonly SkillBranchDef[]>;
  const MUL_KEYS = [
    'cooldownMul', 'damageMul', 'countMul', 'sizeMul', 'rangeMul', 'durationMul',
    'cadenceMul', 'jumpsMul', 'pierceMul', 'pullMul', 'hpBonusMul', 'speedMul',
    'knockbackMul', 'stunMul', 'spreadMul', 'turnRateMul',
  ] as const;
  // 덮어쓰기 항목 = "없던 동작". 2번 갈래에만 있어야 합니다
  const SET_KEYS = [
    'spread', 'falloff', 'slow', 'stunOnHit', 'burn', 'blastHazard', 'execute',
    'cluster', 'splitOnHit', 'straight', 'orbFragment', 'endBlast',
  ] as const;

  check('갈래 레벨이 상한보다 낮다', SKILL_BRANCH_LEVEL < SKILL_MAX_LEVEL, `${SKILL_BRANCH_LEVEL}/${SKILL_MAX_LEVEL}`);
  check('유틸에는 갈래가 없다', UTILITY_SKILL_IDS.every((id) => !table[id]));

  const seen = new Set<string>();
  const done: string[] = [];
  for (const id of ATTACK_SKILL_IDS) {
    const list = table[id];
    if (!list) continue; // 아직 안 채운 스킬. 아래 진행도에서 셉니다
    done.push(getSkillDef(id).name);
    const name = getSkillDef(id).name;
    check(`${name} 갈래가 정확히 2개`, list.length === 2, `${list.length}개`);

    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      check(`${name} 갈래 id 가 유일하다`, !seen.has(b.id), b.id);
      seen.add(b.id);
      check(`${b.id} 에 이름과 설명이 있다`, !!b.name && !!b.desc);
      check(`${b.id} 는 계열을 안 바꾼다`, !('family' in b), '계열이 바뀌면 패시브 표가 통째로 어긋납니다');

      const muls = MUL_KEYS.map((k) => b[k]).filter((v): v is number => typeof v === 'number');
      check(`${b.id} 의 수치가 전부 유한하다`, muls.every((v) => Number.isFinite(v) && v > 0));

      // 보너스와 대가를 둘 다 가져야 합니다. 순수 상향이면 반대편이 죽은 선택지가 됩니다.
      // **쿨다운과 타격 간격은 방향이 반대입니다.** 값이 커지면 느려지는 것이라 대가입니다
      const INVERTED = ['cooldownMul', 'cadenceMul'];
      const gains: string[] = [];
      const costs: string[] = [];
      for (const k of MUL_KEYS) {
        const v = b[k];
        if (typeof v !== 'number' || v === 1) continue;
        const isGain = INVERTED.includes(k) ? v < 1 : v > 1;
        (isGain ? gains : costs).push(`${k} x${v}`);
      }
      check(`${b.id} 에 대가가 있다`, costs.length > 0, gains.join(', '));

      const sets = SET_KEYS.filter((k) => b[k] !== undefined);
      if (i === 0) {
        // 1번은 강화. 수치만 바뀌고 새 동작이 붙으면 안 됩니다
        check(`${b.id} 는 강화 갈래다 (새 동작 없음)`, sets.length === 0, sets.join(', '));
        check(`${b.id} 에 보너스가 있다`, gains.length > 0, costs.join(', '));
      } else {
        // 2번은 특수. 없던 동작이 반드시 하나는 붙어야 합니다
        check(`${b.id} 는 특수 갈래다 (새 동작 있음)`, sets.length > 0, '수치만 바뀌면 1번과 구분이 안 됩니다');
      }
    }
    check(`${name} 두 갈래의 이름이 다르다`, list[0].name !== list[1].name);
  }

  console.log(`   갈래를 채운 스킬 ${done.length}/${ATTACK_SKILL_IDS.length}: ${done.join(', ')}`);

  // --- 갈래가 실제로 일하는가 (선언만 하고 registry 가 안 읽는 배율을 잡습니다) ---
  for (const id of ATTACK_SKILL_IDS) {
    const list = table[id];
    if (!list) continue;
    const base = observe(id, null);
    for (const b of list) {
      const got = observe(id, b.id as SkillBranchId);
      check(
        `${b.id} 가 실제로 무언가를 바꾼다`,
        got !== base,
        `${base} → ${got} (registry 가 이 배율을 안 읽고 있습니다)`,
      );
    }
  }

  /** 그 갈래로 6레벨 한 번 발동했을 때의 관측값을 한 줄 문자열로 만듭니다 */
  function observe(id: string, branch: SkillBranchId | null): string {
    const w = new World(emptySave(), input, 4321);
    w.spawner.enabled = false;
    w.player.x = CANVAS.w / 2;
    w.player.y = CANVAS.h / 2;
    w.player.stats.critChance = 0;
    const e = w.spawnEnemy('basic', w.player.x + 120, w.player.y, {});
    e.maxHp = 1e9;
    e.hp = 1e9;
    const slot = makeSlot(id as never, SKILL_BRANCH_LEVEL, branch);
    w.player.attacks[0] = slot;
    const def = getSkillDef(id as never);
    def.activate(w, slot);
    // 지속형은 몇 틱 돌려야 차이가 드러납니다
    for (let i = 0; i < 30; i++) def.sustain?.(w, slot, FIXED_DT);
    const cd = slotCooldown(w.player.stats, slot).toFixed(3);
    const projectiles = w.projectiles.length;
    const hazards = w.hazards.length;
    const dealt = Math.round(1e9 - e.hp);
    const text = def.levelText(SKILL_BRANCH_LEVEL, branch ? modsOf(branch) : NEUTRAL_MODS);
    return `${cd}|${projectiles}|${hazards}|${dealt}|${text}`;
  }

  // --- levelText 가 갈래를 반영하면서도 깨지지 않는가 ---
  for (const id of ATTACK_SKILL_IDS) {
    const def = getSkillDef(id);
    const variants: (SkillBranchId | null)[] = [null, ...(table[id] ?? []).map((b) => b.id as SkillBranchId)];
    let ok = true;
    for (const v of variants) {
      for (let l = 1; l <= SKILL_MAX_LEVEL; l++) {
        const t = def.levelText(l, v ? modsOf(v) : NEUTRAL_MODS);
        if (!t || t.includes('NaN') || t.includes('undefined') || t.includes('Infinity')) ok = false;
      }
    }
    check(`${def.name} 의 레벨 문구가 갈래를 넣어도 멀쩡하다`, ok);
  }

  // --- 갈래가 기존 규칙을 깨지 않는가 ---
  {
    // 화염방사기의 `화상 지속 >= 쿨다운` 은 갈래 쿨다운으로 다시 재야 합니다.
    // 3-4번은 정적 쿨다운만 봅니다. 갈래가 쿨을 늘리면 매 주기 불이 꺼져서
    // "재생을 멈춘다"는 정체성이 무너지는데, 표를 보고는 그 연결이 안 보입니다
    const w = new World(emptySave(), input, 1);
    for (const b of table.flame ?? []) {
      const cd = slotCooldown(w.player.stats, makeSlot('flame', SKILL_BRANCH_LEVEL, b.id as SkillBranchId));
      check(`${b.id} 도 화상 지속 >= 쿨다운`, SKILLS.flame.burnTime >= cd, `${SKILLS.flame.burnTime}초 vs ${cd.toFixed(2)}초`);
    }

    // 거대 지뢰는 총합을 안 바꾸고 형태만 바꾸는 갈래입니다.
    // 이 곱이 1 을 벗어나면 "형태를 바꾸는 갈래"가 슬그머니 "세지는 갈래"가 된 것입니다
    const giant = (table.mine ?? []).find((b) => b.id === 'mineGiant');
    if (giant) {
      const total = (giant.countMul ?? 1) * (giant.damageMul ?? 1);
      check('거대 지뢰는 총합을 안 바꾼다', Math.abs(total - 1) < 1e-6, `x${total.toFixed(3)}`);
    }

    // 방패에 막히는 셋은 방패적이 존재할 이유 그 자체입니다.
    // 갈래로 그 약점을 지우면 6레벨 이후에는 방패적이 없는 게임이 됩니다
    for (const id of ['shotgun', 'flame', 'missile']) {
      for (const b of table[id] ?? []) {
        check(`${b.id} 는 방패 무시를 안 켠다`, !('ignoreShield' in b));
      }
    }

    // 공전 반경을 건드리면 타격 간격(`0.32 x 70/반경`)도 같이 맞춰야 합니다.
    // 안 맞추면 조용히 36% 하향이 됩니다. 지금은 건드리는 갈래가 없어야 합니다
    for (const b of table.orbit ?? []) {
      check(`${b.id} 는 공전 반경을 안 건드린다`, !('orbitRadiusMul' in b));
    }

    // 오라는 지속이 쿨을 넘으면 가동률 100% 가 되어 지속시간도 쿨다운도 뜻을 잃습니다.
    // 갈래가 지속을 늘리거나 쿨을 줄이면 그 경계에 닿을 수 있습니다
    for (const b of [null, ...(table.aura ?? [])]) {
      const m = b ? modsOf(b.id as SkillBranchId) : NEUTRAL_MODS;
      const dur = lv(SKILLS.aura.duration, SKILLS.aura.durationPerLevel, SKILL_MAX_LEVEL) * m.durationMul;
      const cd = SKILLS.aura.cooldown * m.cooldownMul;
      check(`오라 가동률이 100% 미만이다 (${b?.id ?? '갈래 없음'})`, dur < cd, `${(dur / cd * 100).toFixed(0)}%`);
    }

    // 계열마다 화상 수단이 최소 하나 있어야 합니다. 하나뿐이면 "화상 빌드"가
    // 사실상 "그 스킬을 뽑았는가"가 되고, 정예 탱커의 재생을 멈출 방법이 운에 좌우됩니다
    const burnBy = new Map<string, string[]>();
    for (const id of ATTACK_SKILL_IDS) {
      const def = getSkillDef(id);
      if (!def.family) continue;
      const list = burnBy.get(def.family) ?? [];
      // 스킬 자체가 붙이는 것(화염방사기)과 갈래가 붙이는 것을 같이 셉니다
      if (id === 'flame') list.push(def.name);
      for (const b of table[id] ?? []) if (b.burn || b.blastHazard?.burnTime) list.push(b.name);
      if (list.length > 0) burnBy.set(def.family, list);
    }
    for (const fam of Object.keys(SKILL_FAMILY_LABEL) as SkillFamily[]) {
      const names = burnBy.get(fam) ?? [];
      check(`${SKILL_FAMILY_LABEL[fam]} 계열에 화상 수단이 있다`, names.length >= 1, names.join(', ') || '없음');
    }
    for (const [fam, names] of burnBy) console.log(`   화상 ${SKILL_FAMILY_LABEL[fam as SkillFamily]}: ${names.join(', ')}`);
  }

  // --- 흐름: 6레벨에 딱 한 번, 재선택 불가, 판마다 초기화 ---
  {
    const w = new World(emptySave(), input, 99);
    w.spawner.enabled = false;
    check('새 판은 갈래가 비어 있다', w.player.attacks.every((s) => !s || s.branch === null));

    w.player.attacks[0] = makeSlot('mine', 1);
    let pushes = 0;
    for (let l = 1; l < SKILL_MAX_LEVEL; l++) {
      applySkillChoice(w, { id: 'mine', upgrade: true, level: l + 1, replacesUtility: false });
      pushes += w.pendingBranchChoices.length;
      while (w.pendingBranchChoices.length > 0) {
        applyBranchChoice(w, w.pendingBranchChoices.shift()!, 'mineGiant');
      }
    }
    check('갈래 창은 판당 스킬마다 한 번만 뜬다', pushes === 1, `${pushes}회`);
    check('고른 갈래가 남아 있다', w.player.attacks[0]?.branch === 'mineGiant');

    // 재선택 불가. 되돌릴 수 있으면 6레벨의 선택이 결정이 아니라 잠깐의 설정이 됩니다
    applyBranchChoice(w, 'mine', 'mineFire');
    check('갈래는 다시 못 고른다', w.player.attacks[0]?.branch === 'mineGiant');

    // 유틸은 6레벨이 돼도 안 뜹니다. 뜨면 카드 0장짜리 화면에서 판이 영구 정지합니다
    const u = new World(emptySave(), input, 98);
    u.player.utility = makeSlot('dash', 1);
    for (let l = 1; l < SKILL_MAX_LEVEL; l++) {
      applySkillChoice(u, { id: 'dash', upgrade: true, level: l + 1, replacesUtility: false });
    }
    check('유틸은 갈래 창이 안 뜬다', u.pendingBranchChoices.length === 0, `${u.pendingBranchChoices.length}회`);
  }

  // --- 장판 편 구분 ---
  {
    // 내 화염 지뢰가 나를 태우면 지뢰가 자해 스킬이 됩니다
    const w = new World(emptySave(), input, 7777);
    w.spawner.enabled = false;
    w.player.x = CANVAS.w / 2;
    w.player.y = CANVAS.h / 2;
    w.player.stats.range = 0;
    w.player.stats.regen = 0;
    const slot = makeSlot('mine', SKILL_BRANCH_LEVEL, 'mineFire');
    w.player.attacks[0] = slot;
    getSkillDef('mine').activate(w, slot);

    // 지뢰를 억지로 터뜨립니다 (수명 만료 경로)
    for (const p of w.projectiles) if (p.kind === 'mine') p.life = 0.001;
    const e = w.spawnEnemy('tank', w.player.x, w.player.y, {});
    e.maxHp = 1e7;
    e.hp = 1e7;
    e.speed = 0;
    const hpBefore = w.player.hp;
    step(w, 2.5);

    check('화염 지뢰가 장판을 남긴다', w.hazards.some((h) => h.side === 'enemy'), `${w.hazards.length}개`);
    check('내 장판은 나를 안 때린다', w.player.hp >= hpBefore - 1e-6, `${hpBefore} → ${w.player.hp}`);
    check('내 장판이 적을 태운다', e.hp < 1e7, `${Math.round(1e7 - e.hp)} 피해`);
    check('밟은 적에게 화상이 붙는다', e.burnTime > 0 || e.burnDps > 0, `${e.burnTime.toFixed(2)}초`);
  }

  // 적이 깐 장판은 적을 안 때립니다. 장판적끼리 서로 녹으면 안 됩니다
  {
    const w = new World(emptySave(), input, 7778);
    w.spawner.enabled = false;
    w.player.x = 100;
    w.player.y = 100;
    const e = w.spawnEnemy('tank', 900, 400, {});
    e.maxHp = 1e7;
    e.hp = 1e7;
    e.speed = 0;
    w.addHazard({ x: e.x, y: e.y, radius: 120, duration: 3, slow: 0.5, color: '#f00', tickDamage: 500 });
    step(w, 2.5);
    check('적 장판은 적을 안 때린다', e.hp >= 1e7 - 1e-6, `${Math.round(1e7 - e.hp)} 피해`);
  }

  // 난이도 배율이 내 장판에 걸리면 난이도가 오를수록 내 스킬이 세집니다
  {
    const life = (difficulty: number, side: 'player' | 'enemy') => {
      const w = new World(emptySave(), input, 5, difficulty);
      w.spawner.enabled = false;
      w.addHazard({ x: 600, y: 300, radius: 80, duration: 3, slow: 1, color: '#f00', side });
      return w.hazards[w.hazards.length - 1].life;
    };
    check('난이도가 내 장판을 안 늘린다', Math.abs(life(0, 'enemy') - life(15, 'enemy')) < 1e-6);
    check('난이도가 적 장판은 늘린다', life(15, 'player') > life(0, 'player'));
  }

  // --- 화상은 겹쳐도 합해지지 않습니다 ---
  {
    const w = new World(emptySave(), input, 4242);
    w.spawner.enabled = false;
    const e = w.spawnEnemy('tank', 600, 300, {});
    e.burnDps = 10;
    e.burnTime = 3;
    // 더 약한 화상을 덧씌워도 센 쪽이 남아야 합니다
    e.burnDps = Math.max(e.burnDps, 4);
    e.burnTime = Math.max(e.burnTime, 1);
    check('화상은 더 센 것 하나만 남는다', e.burnDps === 10 && e.burnTime === 3, `${e.burnDps}/${e.burnTime}`);
  }
}

console.log('3-0d) 분열 갈래가 반대편 갈래를 압도하지 않는가');
{
  const L = SKILL_MAX_LEVEL;
  const at = (b: number, p: number) => b + p * (L - 1);
  const table = SKILL_BRANCHES as unknown as Record<string, readonly SkillBranchDef[]>;

  /** 한 발이 결국 몇 발이 되는가. count^0 + ... + count^generations */
  const fanOut = (count: number, generations: number) => {
    let n = 0;
    for (let g = 0; g <= generations; g++) n += count ** g;
    return n;
  };

  // 분열은 **탄 수가 곱해지는** 갈래라, 카드에 적힌 `damageMul` 만 보면 약해 보이는데
  // 실제로는 그 배수에 갈라진 발수가 통째로 곱해집니다. 미사일이 `max: 24` 하나로
  // 한 발이 40발이 되어 반대편 갈래의 11.4배이던 것을 못 잡고 있던 자리입니다.
  // **부등호를 재는 시험이 없으면 이 종류의 과잉은 화면에 안 드러납니다.**
  const missile = table.missile;
  const mHeavy = missile[0];
  const mSplit = missile[1];
  check('분열 미사일이 한 번만 갈라진다', mSplit.splitOnHit?.generations === 1, `${mSplit.splitOnHit?.generations}세대`);
  check('분열 미사일의 갈래 수가 3이다', mSplit.splitOnHit?.count === 3, `${mSplit.splitOnHit?.count}갈래`);

  const mCount = (b: SkillBranchDef) => Math.max(1, Math.round(at(SKILLS.missile.count, SKILLS.missile.countPerLevel) * (b.countMul ?? 1)));
  const mDmg = (b: SkillBranchDef) => at(SKILLS.missile.damage, SKILLS.missile.damagePerLevel) * (b.damageMul ?? 1);
  const heavyTotal = mCount(mHeavy) * mDmg(mHeavy);
  const splitFan = fanOut(mSplit.splitOnHit!.count, mSplit.splitOnHit!.generations);
  const splitTotal = mCount(mSplit) * mDmg(mSplit) * splitFan;
  const ratio = splitTotal / heavyTotal;
  check(
    '분열 미사일 총합이 증폭 탄두의 1.5배 이내',
    ratio <= 1.5,
    `분열 ${splitTotal.toFixed(1)} (${mCount(mSplit)}발 x ${splitFan}) vs 증폭 ${heavyTotal.toFixed(1)} = x${ratio.toFixed(2)}`,
  );
  console.log(`   미사일 만렙 총합: 증폭 ${heavyTotal.toFixed(1)} · 분열 ${splitTotal.toFixed(1)} (한 발이 ${splitFan}발) = x${ratio.toFixed(2)}`);

  // 도탄의 2번은 이제 분열이 아니라 관통입니다 (2026-09-10).
  // **미사일도 분열이라 갈래 24개 중 둘이 같은 말을 하고 있었습니다.**
  const rHeavy = table.ricochet[0];
  const rPierce = table.ricochet[1];
  check('관통 도탄은 안 튼다', rPierce.straight === true, `${rPierce.straight}`);
  check('관통 도탄은 분열하지 않는다', rPierce.splitOnHit === undefined);
  check('분열은 미사일 하나뿐이다', !rPierce.splitOnHit && !!mSplit.splitOnHit);
  // 1번이 이미 `pierceMul 1.4` 라, 2번도 명중 횟수를 만지면 두 갈래가 같은 말을 합니다
  check('관통 도탄은 명중 횟수를 안 건드린다', rPierce.pierceMul === undefined, `${rPierce.pierceMul}`);

  const rHits = (b: SkillBranchDef) => Math.max(1, Math.round(at(SKILLS.ricochet.bounces, SKILLS.ricochet.bouncesPerLevel) * (b.pierceMul ?? 1)));
  const rDmg = (b: SkillBranchDef) => at(SKILLS.ricochet.damage, SKILLS.ricochet.damagePerLevel) * (b.damageMul ?? 1);
  const rCool = (b: SkillBranchDef) => SKILLS.ricochet.cooldown * (b.cooldownMul ?? 1);
  const dpsOf = (b: SkillBranchDef) => (rHits(b) * rDmg(b)) / rCool(b);
  const rBase = (rHits({} as SkillBranchDef) * rDmg({} as SkillBranchDef)) / SKILLS.ricochet.cooldown;

  // **쿨다운이 다르면 총합만으로는 세기를 못 견줍니다.** 강화 도탄은 쿨이 1.4배라
  // 총합이 커도 초당으로는 줄어듭니다
  const rHeavyDps = dpsOf(rHeavy);
  const rPierceDps = dpsOf(rPierce);
  check('관통 도탄이 강화 도탄의 1.5배 이내', rPierceDps / rHeavyDps <= 1.5, `x${(rPierceDps / rHeavyDps).toFixed(2)}`);
  // **아래쪽도 봅니다.** 분열이던 시절 한 세대로 줄이면서 기본보다도 약해진 적이
  // 있었습니다. 위쪽만 재면 그런 식으로 반대로 기우는 것을 못 잡습니다
  check('관통 도탄이 갈래 없는 도탄의 0.6배 밑으로 안 내려간다', rPierceDps / rBase >= 0.6, `x${(rPierceDps / rBase).toFixed(2)}`);

  // --- 관통이 실제로 안 트는가 (표가 아니라 판으로 잽니다) ---
  //
  // 표만 보면 `straight: true` 가 들어갔는지만 알 수 있습니다. 그 값이 실제로
  // `updateRicochet` 까지 닿는지는 쏴봐야 압니다
  {
    const fire = (branch: SkillBranchId | null) => {
      const ww = new World(emptySave(), input, 4321);
      ww.spawner.enabled = false;
      ww.player.x = 200;
      ww.player.y = 360;
      ww.player.stats.critChance = 0;
      // 정면에 하나, 옆으로 크게 벗어난 자리에 하나.
      // 기본 도탄은 맞은 뒤 옆의 적 쪽으로 틀고, 관통 도탄은 가던 방향 그대로 갑니다
      const front = ww.spawnEnemy('tank', 500, 360, {});
      front.maxHp = 1e9;
      front.hp = 1e9;
      const side = ww.spawnEnemy('tank', 560, 120, {});
      side.maxHp = 1e9;
      side.hp = 1e9;

      const slot = makeSlot('ricochet', SKILL_BRANCH_LEVEL, branch);
      getSkillDef('ricochet').activate(ww, slot);
      const shot = ww.projectiles[0];
      const before = Math.atan2(shot.vy, shot.vx);
      // **명중은 `pierce` 가 줄었는지로 봅니다.** 적 체력으로 보면 플레이어의
      // 기본공격이 같은 적을 때려서 첫 프레임에 이미 줄어 있습니다.
      // 그리고 **판을 통째로 돌려야 합니다.** 충돌은 `w.grid` 를 쓰는데 그 격자는
      // `world.update` 가 채우므로, 투사체만 갱신하면 아무것도 안 맞습니다
      const p0 = shot.pierce;
      for (let i = 0; i < 200 && !shot.dead && shot.pierce === p0; i++) step(ww, FIXED_DT);
      const hit = shot.pierce < p0;
      for (let i = 0; i < 3 && !shot.dead; i++) step(ww, FIXED_DT);
      return { before, after: Math.atan2(shot.vy, shot.vx), hit, speed: Math.hypot(shot.vx, shot.vy) };
    };

    const plain = fire(null);
    const pierced = fire('ricochetPierce');
    check('기본 도탄이 정면의 적을 맞힌다', plain.hit);
    check('관통 도탄도 정면의 적을 맞힌다', pierced.hit);
    check(
      '기본 도탄은 맞은 뒤 옆의 적 쪽으로 튼다',
      Math.abs(plain.after - plain.before) > 0.2,
      `${plain.before.toFixed(2)} → ${plain.after.toFixed(2)}`,
    );
    check(
      '관통 도탄은 맞아도 안 튼다',
      Math.abs(pierced.after - pierced.before) < 1e-6,
      `${pierced.before.toFixed(2)} → ${pierced.after.toFixed(2)}`,
    );
    check(
      '관통 도탄이 훨씬 빠르다',
      pierced.speed > SKILLS.ricochet.speed * 2,
      `${pierced.speed.toFixed(0)} vs ${SKILLS.ricochet.speed}`,
    );
  }

  console.log(
    `   도탄 만렙 초당: 갈래 없음 ${rBase.toFixed(1)} · 강화 ${rHeavyDps.toFixed(1)} (x${(rHeavyDps / rBase).toFixed(2)}) · 관통 ${rPierceDps.toFixed(1)} (x${(rPierceDps / rBase).toFixed(2)}) · 관통/강화 x${(rPierceDps / rHeavyDps).toFixed(2)}`,
  );
}

console.log(`3-1) 만렙(Lv.${SKILL_MAX_LEVEL}) 위력이 정해둔 자리에 있는가`);
{
  const L = SKILL_MAX_LEVEL;
  const at = (b: number, p: number) => b + p * (L - 1);
  const S = SKILLS;

  // 한 번 발동에 나가는 공격력 배수 총합. 아래 값은 2026-08-12 에 플레이로 잡은 자리입니다.
  // **상한 레벨을 바꿀 때 perLevel 을 같이 안 고치면 여기가 통째로 어긋납니다.**
  // 실제로 상한을 7 → 10 으로 올릴 때 유탄 위력 한 줄을 빠뜨려 32% 가 튀었고
  // 이 표가 없었으면 못 잡았습니다
  const pellets = Math.round(at(S.shotgun.pellets, S.shotgun.pelletsPerLevel));
  const shotgun = pellets * at(S.shotgun.damage, S.shotgun.damagePerLevel);
  const missiles = Math.round(at(S.missile.count, S.missile.countPerLevel));
  const missile = missiles * at(S.missile.damage, S.missile.damagePerLevel);
  const jumps = Math.round(at(S.chain.jumps, S.chain.jumpsPerLevel));
  const chain = (at(S.chain.damage, S.chain.damagePerLevel) * (1 - S.chain.falloff ** jumps)) / (1 - S.chain.falloff);
  const mine = Math.min(S.mine.countMax, Math.round(at(S.mine.count, S.mine.countPerLevel))) * at(S.mine.damage, S.mine.damagePerLevel);
  const orbit = Math.round(at(S.orbit.count, S.orbit.countPerLevel)) * at(S.orbit.damage, S.orbit.damagePerLevel);

  const near = (label: string, got: number, want: number) =>
    check(`${label} 만렙 총합 ${want}`, Math.abs(got - want) / want < 0.03, `${got.toFixed(1)}`);

  near('산탄', shotgun, 37.4);
  near('미사일', missile, 21.1);
  near('체인', chain, 31.8);
  near('지뢰', mine, 26.0);
  near('궤도', orbit, 12.5);
  near('스나이퍼', at(S.sniper.damage, S.sniper.damagePerLevel), 26.8);
  near('유탄', at(S.grenade.damage, S.grenade.damagePerLevel), 5.7);
  near('레이저', at(S.laser.damage, S.laser.damagePerLevel), 5.61);

  console.log(`   산탄 ${shotgun.toFixed(1)}(${pellets}발) · 체인 ${chain.toFixed(1)}(${jumps}연쇄) · 지뢰 ${mine.toFixed(1)} · 미사일 ${missile.toFixed(1)}(${missiles}발) · 궤도 ${orbit.toFixed(1)}`);

  // 여기부터는 수치가 아니라 **결정**입니다. 어긋나면 그 결정이 깨진 것입니다
  const others = [chain, mine, missile];
  check('산탄이 2위의 두 배를 넘지 않는다', shotgun < Math.max(...others) * 2, `${shotgun.toFixed(1)} vs ${Math.max(...others).toFixed(1)}`);

  const auraUptime = at(S.aura.duration, S.aura.durationPerLevel) / S.aura.cooldown;
  check('오라 가동률이 100% 미만이다', auraUptime < 1, `${(auraUptime * 100).toFixed(0)}%`);

  const blastWidth = at(S.grenade.blast, S.grenade.blastPerLevel) * 2;
  check('유탄 지름이 경기장 가로의 30% 미만이다', blastWidth < CANVAS.w * 0.3, `${(blastWidth / CANVAS.w * 100).toFixed(1)}%`);

  check('지뢰 개수가 상한에서 멈춘다', Math.min(S.mine.countMax, Math.round(at(S.mine.count, S.mine.countPerLevel))) === S.mine.countMax);
  console.log(`   오라 가동 ${(auraUptime * 100).toFixed(0)}% · 유탄 지름 가로의 ${(blastWidth / CANVAS.w * 100).toFixed(1)}%`);
}

console.log('3-2) 지뢰: 개수 상한 없음 · 2개째부터 코인 범위(1레벨) 안에 흩뿌림');
{
  const w = new World(emptySave(), input, 4242);
  w.spawner.enabled = false;
  // 벽에 붙어 있으면 경기장 밖으로 나가는 것을 잘라내느라 반경 검사가 흐려집니다
  w.player.x = CANVAS.w / 2;
  w.player.y = CANVAS.h / 2;

  const def = getSkillDef('mine');
  const slot = makeSlot('mine', 5);
  w.player.attacks[0] = slot;

  // 예전에는 8개에서 막혀서 레벨 5 는 두 번째 설치부터 아무 일도 안 일어났습니다
  let fired = 0;
  for (let i = 0; i < 5; i++) if (def.activate(w, slot)) fired++;
  const mines = w.projectiles.filter((p) => p.kind === 'mine' && !p.dead);
  check('상한에 막히지 않는다', fired === 5, `${fired}회`);
  check('레벨 5 는 한 번에 5개', mines.length === 25, `${mines.length}개`);

  const atFoot = mines.filter((m) => Math.abs(m.x - w.player.x) < 1e-6 && Math.abs(m.y - w.player.y) < 1e-6);
  check('설치할 때마다 한 개는 발밑', atFoot.length === fired, `${atFoot.length}개`);
  check(
    '나머지는 코인 범위 안에 들어간다',
    mines.every((m) => dist(m.x, m.y, w.player.x, w.player.y) <= SKILLS.mine.spread + 1e-6),
  );
  check('흩어지는 반경은 코인 범위 기본값', SKILLS.mine.spread === BASE_STATS.pickupRange, `${SKILLS.mine.spread}`);

  // 코인 자석을 아무리 사도 지뢰가 퍼지면 안 됩니다
  w.player.stats.pickupRange = 500;
  const before = w.projectiles.length;
  def.activate(w, slot);
  const fresh = w.projectiles.slice(before);
  check(
    '코인 범위를 올려도 안 퍼진다',
    fresh.length === 5 && fresh.every((m) => dist(m.x, m.y, w.player.x, w.player.y) <= SKILLS.mine.spread + 1e-6),
    `${fresh.length}개`,
  );
}

console.log('3-3) 스나이퍼: 대상 최대 체력 비례 추가 피해');
{
  // 단단한 적일수록 더 아파야 합니다. 이것이 이 스킬을 고를 이유의 전부라,
  // 규칙이 깨지면 스나이퍼는 다시 "그냥 한 발 세게 때리는 스킬"로 돌아갑니다
  const ratio = (l: number) => lv(SKILLS.sniper.hpRatio, SKILLS.sniper.hpRatioPerLevel, l);
  check('1레벨 10%', Math.abs(ratio(1) - 0.10) < 1e-9, `${(ratio(1) * 100).toFixed(1)}%`);
  check('만렙 30%', Math.abs(ratio(SKILL_MAX_LEVEL) - 0.30) < 1e-9, `${(ratio(SKILL_MAX_LEVEL) * 100).toFixed(1)}%`);

  /** 최대 체력만 다른 적을 하나 세워두고 한 발 쏴서 실제로 들어간 피해를 잽니다 */
  const shoot = (maxHp: number, level: number): number => {
    const w = new World(emptySave(), input, 777);
    w.spawner.enabled = false;
    w.player.x = 300;
    w.player.y = 360;
    // 치명타가 섞이면 값이 흔들려서 비례항만 떼어낼 수 없습니다
    w.player.stats.critChance = 0;
    // 기본공격이 같이 때리면 스나이퍼 한 발의 값이 안 나옵니다. 사거리를 0 으로 막습니다
    w.player.stats.range = 0;
    const e = w.spawnEnemy('basic', 700, 360, {});
    e.maxHp = maxHp;
    e.hp = maxHp;
    const slot = makeSlot('sniper', level);
    getSkillDef('sniper').activate(w, slot);
    step(w, 1.5);
    return maxHp - Math.max(0, e.hp);
  };

  const atk = new World(emptySave(), input, 777).player.stats.attack;
  const flat = atk * lv(SKILLS.sniper.damage, SKILLS.sniper.damagePerLevel, 1);

  const soft = shoot(400, 1);
  const hard = shoot(2400, 1);
  check('물렁한 적 피해 = 기본 + 최대체력 10%', Math.abs(soft - (flat + 400 * 0.1)) < 1, `${soft.toFixed(0)}`);
  check('단단한 적 피해 = 기본 + 최대체력 10%', Math.abs(hard - (flat + 2400 * 0.1)) < 1, `${hard.toFixed(0)}`);
  check('체력이 6배면 추가분도 6배', Math.abs((hard - flat) - (soft - flat) * 6) < 1, `${(hard - flat).toFixed(0)} vs ${(soft - flat).toFixed(0)}`);

  // 만렙은 같은 적에게 더 아파야 합니다 (배수와 비례항이 둘 다 오릅니다)
  const maxed = shoot(2400, SKILL_MAX_LEVEL);
  check('만렙이 1레벨보다 아프다', maxed > hard, `${maxed.toFixed(0)} vs ${hard.toFixed(0)}`);

  // **치명타는 비례항에 안 걸립니다.** 걸리면 치명타 배율 상한 4.0 에서
  // 대상 최대 체력의 120% 가 한 발에 들어가 무엇이든 크리 한 방에 지워집니다
  {
    const w = new World(emptySave(), input, 778);
    w.spawner.enabled = false;
    w.player.x = 300;
    w.player.y = 360;
    w.player.stats.critChance = 1;
    w.player.stats.critMult = 4;
    w.player.stats.range = 0;
    const e = w.spawnEnemy('basic', 700, 360, {});
    e.maxHp = 2400;
    e.hp = 2400;
    const slot = makeSlot('sniper', SKILL_MAX_LEVEL);
    getSkillDef('sniper').activate(w, slot);
    step(w, 1.5);
    const dealt = 2400 - Math.max(0, e.hp);
    const want = atk * lv(SKILLS.sniper.damage, SKILLS.sniper.damagePerLevel, SKILL_MAX_LEVEL) * 4 + 2400 * 0.3;
    check('치명타는 비례항에 안 곱해진다', Math.abs(dealt - want) < 1, `${dealt.toFixed(0)} (기대 ${want.toFixed(0)})`);
  }
}

console.log('3-4) 화염방사기: 화상이 다음 분사까지 안 꺼지는가');
{
  // 이 부등호가 깨지면 매 주기마다 불이 잠깐 꺼지고, 그 틈에 정예 탱커가 재생을
  // 되찾습니다. "재생을 멈춘다"가 이 스킬의 정체성이라 규칙으로 박아 둡니다
  check(
    '화상 지속 >= 재사용 대기',
    SKILLS.flame.burnTime >= SKILLS.flame.cooldown,
    `${SKILLS.flame.burnTime}초 vs ${SKILLS.flame.cooldown}초`,
  );

  const w = new World(emptySave(), input, 3131);
  w.spawner.enabled = false;
  w.player.x = 300;
  w.player.y = 360;
  w.player.stats.range = 0; // 기본공격이 끼어들면 적이 먼저 죽습니다
  const e = w.spawnEnemy('tank', 460, 360, {});
  e.maxHp = 1e6;
  e.hp = 1e6;
  e.speed = 0; // 부채꼴 밖으로 걸어 나가면 시험이 무의미해집니다

  const slot = makeSlot('flame', 1);
  w.player.attacks[0] = slot;
  const def = getSkillDef('flame');
  def.activate(w, slot);

  // 분사가 끝난 뒤부터 쿨이 도는 순간까지 화상이 한 번이라도 끊기는지 봅니다
  let lapsed = 0;
  const steps = Math.round(SKILLS.flame.cooldown / FIXED_DT);
  for (let i = 0; i < steps; i++) {
    if (slot.active > 0) {
      def.sustain?.(w, slot, FIXED_DT);
      slot.active -= FIXED_DT;
    } else if (e.burnTime <= 0) {
      lapsed++;
    }
    if (e.burnTime > 0) e.burnTime -= FIXED_DT;
  }
  check('한 주기 내내 불이 안 꺼진다', lapsed === 0, `${(lapsed * FIXED_DT).toFixed(2)}초 꺼짐`);
}

console.log('3-5) 감속은 곱하지 않고 더하는가');
{
  /** 같은 조건에서 적이 1초 동안 실제로 움직인 거리를 잽니다 */
  const travel = (setup: (e: ReturnType<World['spawnEnemy']>) => void): number => {
    const w = new World(emptySave(), input, 5555);
    w.spawner.enabled = false;
    w.player.x = 200;
    w.player.y = 360;
    w.player.stats.range = 0; // 기본공격이 밀거나 죽이면 거리가 흔들립니다
    w.player.attacks.length = 0;
    const e = w.spawnEnemy('basic', 900, 360, {});
    e.maxHp = 1e9;
    e.hp = 1e9;
    setup(e);
    const x0 = e.x;
    const steps = Math.round(1 / FIXED_DT);
    for (let i = 0; i < steps; i++) {
      // 지속시간이 도중에 끝나면 뒤쪽 프레임이 맨몸 속도로 걸어서 값이 오염됩니다
      e.slowTime = 100;
      if (e.burnTime > 0) e.burnTime = 100;
      input.beginStep();
      w.player.invuln = 1;
      w.update(FIXED_DT);
    }
    return Math.abs(e.x - x0);
  };

  const plain = travel(() => {});
  const slowed = travel((e) => {
    e.slow = 1 - 0.45;
    e.slowTime = 100;
  });
  const both = travel((e) => {
    e.slow = 1 - 0.45;
    e.slowTime = 100;
    e.burnDps = 0; // 피해가 아니라 감속만 봅니다
    e.burnTime = 100;
  });

  const ratioSlow = slowed / plain;
  const ratioBoth = both / plain;
  const burn = SKILLS.flame.burnSlow;
  check('감속 45% 하나면 x0.55', Math.abs(ratioSlow - 0.55) < 0.02, ratioSlow.toFixed(3));
  check(
    `감속 45% + 화상 ${burn * 100}% 는 합해서 x${(1 - 0.45 - burn).toFixed(2)}`,
    Math.abs(ratioBoth - (1 - 0.45 - burn)) < 0.02,
    ratioBoth.toFixed(3),
  );
  // 곱연산이면 0.55 x 0.9 = 0.495 가 나옵니다. 그 값이면 규칙이 되돌아간 것입니다
  check('곱연산(0.495)이 아니다', Math.abs(ratioBoth - 0.495) > 0.02, ratioBoth.toFixed(3));
  check('감속 상한이 완전 정지를 막는다', STATUS.slowCap < 1, `${STATUS.slowCap}`);
}

console.log('3-7) 넉백 폭발: 자기 체력으로는 절대 안 죽는가');
{
  const K = SKILLS.knockback;
  const L = SKILL_MAX_LEVEL;
  const top = K.damage + K.damagePerLevel * (L - 1);
  console.log(
    `   넉백 · Lv.1 ${Math.round(K.damage * 100)}% → 만렙 ${Math.round(top * 100)}% · 쿨 ${K.cooldown}초 (초당 ${(top / K.cooldown).toFixed(2)}배) · 대가 최대 체력 ${Math.round(K.selfDamageRatio * 100)}%`,
  );

  /** 체력을 지정한 비율로 맞춰놓고 Q 한 번을 누릅니다 */
  const press = (hpRatio: number) => {
    const w = new World(emptySave(), input, 7401);
    w.spawner.enabled = false;
    w.player.attacks.length = 0;
    w.player.utility = makeSlot('knockback', 1);
    w.player.x = 640;
    w.player.y = 360;
    const victim = w.spawnEnemy('basic', 700, 360, {});
    victim.maxHp = 1e9;
    victim.hp = 1e9;
    w.player.hp = w.player.stats.maxHp * hpRatio;
    const hp0 = w.player.hp;
    const vhp0 = victim.hp;
    const fired = getSkillDef('knockback').activate(w, w.player.utility);
    return { fired, hp0, hp: w.player.hp, alive: w.player.alive, hurt: vhp0 - victim.hp };
  };

  // 대가(20%)와 정확히 같은 체력이면 쓰는 순간 0 이 됩니다. 거기까지 막습니다
  const atLimit = press(K.selfDamageRatio);
  console.log(`   체력 ${Math.round(K.selfDamageRatio * 100)}% 에서 · 발동 ${atLimit.fired} · 체력 ${atLimit.hp0.toFixed(0)} → ${atLimit.hp.toFixed(0)}`);
  check('대가와 같은 체력에서는 안 나간다', !atLimit.fired);
  check('안 나갔으면 체력도 안 깎인다', atLimit.hp === atLimit.hp0, `${atLimit.hp0} → ${atLimit.hp}`);
  check('안 나갔으면 적도 안 맞는다', atLimit.hurt === 0, `${atLimit.hurt}`);

  const below = press(0.05);
  check('그보다 낮아도 안 나간다', !below.fired && below.alive);

  // 바로 위에서는 나가고, 나가도 죽지 않습니다
  const above = press(K.selfDamageRatio + 0.05);
  console.log(`   체력 ${Math.round((K.selfDamageRatio + 0.05) * 100)}% 에서 · 발동 ${above.fired} · 체력 ${above.hp0.toFixed(0)} → ${above.hp.toFixed(0)} · 적 피해 ${above.hurt.toFixed(0)}`);
  check('대가보다 많으면 나간다', above.fired);
  check('나가면 대가를 치른다', above.hp < above.hp0, `${above.hp0.toFixed(0)} → ${above.hp.toFixed(0)}`);
  check('그래도 살아 있다', above.alive && above.hp > 0, `${above.hp.toFixed(1)}`);
  check('적이 실제로 맞는다', above.hurt > 0, `${above.hurt.toFixed(0)}`);

  // 하한과 대가는 같은 상수여야 합니다. 갈라지면 "쓸 수는 있는데 쓰면 죽는" 구간이 생깁니다
  const full = press(1);
  check('가득 찬 체력에서는 당연히 나간다', full.fired);
  check(
    '대가는 최대 체력 기준이다',
    Math.abs(full.hp0 - full.hp - full.hp0 * K.selfDamageRatio) < 0.01,
    `${(full.hp0 - full.hp).toFixed(1)}`,
  );
}

console.log('3-6) 오래 남는 투사체: 미사일 수명과 자폭 · 도탄은 명중 횟수로만 끝나는가');
{
  // --- 수명이 쿨보다 넉넉해야 합니다 ---
  {
    const M = SKILLS.missile;
    console.log(`   미사일 쿨 ${M.cooldown}초 · 수명 ${M.life}초 (쿨의 ${(M.life / M.cooldown).toFixed(2)}배) · 사거리 ${(M.speed * M.life).toFixed(0)}px`);
    // 겨눈 적이 죽으면 새 대상을 찾아 도는데, 그 사이에 다음 발사가 오고도
    // 남을 만큼은 살아 있어야 "유도한다"는 성질이 벌이 되지 않습니다
    check('미사일 수명이 쿨의 두 배는 된다', M.life >= M.cooldown * 2, `${M.life} vs ${M.cooldown}`);
    check('미사일은 수명 안에 경기장을 가로지른다', M.speed * M.life > CANVAS.w, `${(M.speed * M.life).toFixed(0)}px`);
  }

  // --- 수명이 다한 미사일은 그 자리에서 터집니다 ---
  {
    const w = new World(emptySave(), input, 7301);
    w.spawner.enabled = false;
    w.player.attacks.length = 0;
    w.player.x = 100;
    w.player.y = 360;

    // 발사할 대상 하나를 두고 쏜 뒤, 그 대상을 지워서 미사일을 미아로 만듭니다
    const bait = w.spawnEnemy('basic', 300, 360, {});
    getSkillDef('missile').activate(w, makeSlot('missile', 1));
    const shots = w.projectiles.filter((q) => !q.dead && q.kind === 'homing');
    check('미사일이 나갔다', shots.length > 0, `${shots.length}발`);
    bait.dead = true;

    // 미아가 된 미사일을 경기장 구석으로 옮기고, 그 옆에 희생양을 둡니다.
    // 유도가 데려가지 않도록 수명을 거의 끝까지 당겨 놓습니다
    const victim = w.spawnEnemy('tank', 1100, 200, {});
    victim.maxHp = 1e9;
    victim.hp = 1e9;
    const before = victim.hp;
    for (const q of shots) {
      q.x = victim.x;
      q.y = victim.y;
      q.vx = 0;
      q.vy = 0;
      q.life = FIXED_DT * 0.5;
    }
    step(w, FIXED_DT * 2, true, false);
    console.log(`   수명이 다한 미사일 ${shots.length}발 · 옆에 있던 적 체력 ${before} → ${victim.hp.toFixed(0)}`);
    check('수명이 다하면 그 자리에서 터진다', victim.hp < before, `${(before - victim.hp).toFixed(1)} 피해`);
    check('미사일은 사라진다', shots.every((q) => q.dead));
  }

  // --- 그 폭발도 방패는 존중합니다 ---
  {
    // 미사일이 방패에 막힌다는 약점을, 수명이 다할 때까지 기다리는 것으로
    // 우회할 수 있으면 안 됩니다
    const w = new World(emptySave(), input, 7302);
    w.spawner.enabled = false;
    w.player.attacks.length = 0;
    // 방패는 **움직이는 방향**을 봅니다 (faceMove). 그 방향은 곧 플레이어 쪽이므로,
    // 정면 판정을 재려면 플레이어를 폭발과 같은 쪽에 두어야 합니다.
    // `facing` 을 손으로 넣어봐야 다음 프레임에 이동이 덮어씁니다
    w.player.x = 1200;
    w.player.y = 400;
    const bait = w.spawnEnemy('basic', 1150, 400, {});
    getSkillDef('missile').activate(w, makeSlot('missile', 1));
    const shots = w.projectiles.filter((q) => !q.dead && q.kind === 'homing');
    check('미사일은 방패를 안 무시한다', shots.every((q) => !q.ignoreShield));
    bait.dead = true;

    // 방패적을 정면으로 세우고 그 앞에서 터뜨립니다
    const sh = w.spawnEnemy('shield', 1000, 400, {});
    sh.maxHp = 1e9;
    sh.hp = 1e9;
    sh.shieldMax = 1e9;
    sh.shieldHp = 1e9;
    const hp0 = sh.hp;
    const shield0 = sh.shieldHp;
    for (const q of shots) {
      q.x = sh.x + 20;
      q.y = sh.y;
      q.vx = 0;
      q.vy = 0;
      q.life = FIXED_DT * 0.5;
    }
    step(w, FIXED_DT * 2, true, false);
    console.log(`   방패적 · 본체 ${hp0} → ${sh.hp.toFixed(0)} · 방패 ${shield0} → ${sh.shieldHp.toFixed(0)}`);
    check('정면이면 본체가 아니라 방패가 받는다', sh.hp === hp0 && sh.shieldHp < shield0, `본체 ${(hp0 - sh.hp).toFixed(1)} · 방패 ${(shield0 - sh.shieldHp).toFixed(1)}`);
  }

  // --- 도탄은 수명으로 안 사라집니다 ---
  {
    const w = new World(emptySave(), input, 7303);
    w.spawner.enabled = false;
    w.player.attacks.length = 0;
    w.player.x = 640;
    w.player.y = 360;
    const bait = w.spawnEnemy('basic', 800, 360, {});
    getSkillDef('ricochet').activate(w, makeSlot('ricochet', 1));
    const shot = w.projectiles.find((q) => !q.dead && q.kind === 'ricochet');
    check('도탄이 나갔다', !!shot);
    if (shot) {
      check('도탄은 수명이 무한이다', shot.life === Infinity, `${shot.life}`);
      // 터지는 것이 아니라 그냥 남습니다. 폭발 반경이 있으면 자폭 갈래를 타게 됩니다
      check('도탄에는 폭발이 없다', shot.blast === 0, `${shot.blast}`);

      // 적을 전부 치우고 오래 돌려도 살아 있어야 합니다
      bait.dead = true;
      const bounces = shot.pierce;
      step(w, 20, true, false);
      console.log(`   도탄 · 적 없이 20초 뒤 살아 있음 ${!shot.dead} · 남은 명중 ${shot.pierce}/${bounces}`);
      check('적이 없어도 수명으로 안 사라진다', !shot.dead);
      check('명중 횟수도 안 줄었다', shot.pierce === bounces, `${shot.pierce}/${bounces}`);

      // 끝나는 길은 명중 횟수 하나뿐입니다
      shot.pierce = 1;
      shot.targetId = 0;
      const prey = w.spawnEnemy('basic', shot.x + 10, shot.y, {});
      void prey;
      step(w, 0.4, true, false);
      check('명중 횟수를 다 쓰면 사라진다', shot.dead, `남은 ${shot.pierce}`);
    }
  }
}

// ---------------------------------------------------------------------------
console.log('4) 방패적: 정면 기본공격만으로 방패를 깨고 잡을 수 있는가');
{
  const w = new World(emptySave(), input, 5150);
  w.spawner.enabled = false;
  const shield = w.spawnEnemy('shield', 640, 360, {});
  const shieldMax = shield.shieldMax;
  check('방패 내구도가 체력의 50%다', Math.abs(shieldMax - shield.maxHp * 0.5) < 0.01, `${shieldMax.toFixed(1)}/${shield.maxHp.toFixed(1)}`);

  const baseSpeed = shield.speed;
  let brokenSpeed = 0;
  const steps = Math.round(30 / FIXED_DT);
  for (let i = 0; i < steps && !shield.dead; i++) {
    input.beginStep();
    w.player.invuln = 1;
    // 정면에서만 때립니다 (제자리 유지, 적이 다가옴)
    w.player.x = 300;
    w.player.y = 360;
    w.update(FIXED_DT);
    if (brokenSpeed === 0 && shield.shieldHp <= 0) brokenSpeed = shield.speed;
  }
  console.log(
    `   ${shield.dead ? '처치 성공' : '처치 실패'} · 방패 파괴 후 속도 ${baseSpeed.toFixed(0)} → ${brokenSpeed.toFixed(0)}`,
  );
  check('정면 공격만으로 방패를 깨고 처치했다', shield.dead);
  check('방패가 깨지면 빨라진다', brokenSpeed > baseSpeed, `${brokenSpeed.toFixed(0)} vs ${baseSpeed.toFixed(0)}`);
}

console.log('4-2) 방패적: 관통 계열 스킬은 방패를 무시하는가');
for (const id of ['sniper', 'laser', 'chain', 'grenade'] as const) {
  const w = new World(emptySave(), input, 4242);
  w.spawner.enabled = false;
  const shield = w.spawnEnemy('shield', 700, 360, {});
  w.player.x = 300;
  w.player.y = 360;
  const hpBefore = shield.hp;
  const slot = makeSlot(id, 1);
  const def = getSkillDef(id);
  def.activate(w, slot);
  step(w, 1.5);
  const bypassed = shield.dead || shield.hp < hpBefore;
  check(`${id} 는 방패를 무시한다`, bypassed, `체력 ${hpBefore.toFixed(0)} → ${Math.max(0, shield.hp).toFixed(0)}`);
}

console.log('4-2b) 방패적: 폭발도 방패 판정을 따르는가 (추적 미사일)');
{
  const w = new World(emptySave(), input, 909);
  w.spawner.enabled = false;
  const e = w.spawnEnemy('shield', 700, 360, {});
  w.player.x = 300;
  w.player.y = 360;
  step(w, 0.6); // 플레이어 쪽을 보게 합니다
  // 방패와 체력을 부풀립니다. 세 번을 연달아 터뜨려야 하는데 도중에 죽으면
  // 뒤쪽 검사가 "체력이 안 줄었다"로 통과해버려 시험이 무의미해집니다
  e.shieldHp = 1e6;
  e.shieldMax = 1e6;
  e.maxHp = 1e6;
  e.hp = 1e6;

  // 정면(플레이어 쪽)에서 터지는 폭발
  const hp0 = e.hp;
  w.explode(e.x - e.radius - 4, e.y, 26, 100, true, '#ff8ab5', null, false);
  check('방패를 존중하는 폭발은 정면에서 막힌다', e.hp >= hp0 - 1e-6, `체력 ${hp0.toFixed(0)} → ${e.hp.toFixed(0)}`);
  check('막힌 폭발이 방패를 깎기는 한다', e.shieldHp < e.shieldMax, `${e.shieldHp.toFixed(0)}`);

  // 등 뒤에서 터지면 들어갑니다. 방패는 원래 정면만 막습니다
  const hp1 = e.hp;
  w.explode(e.x + e.radius + 4, e.y, 26, 100, true, '#ff8ab5', null, false);
  check('등 뒤에서는 들어간다', e.hp < hp1, `체력 ${hp1.toFixed(0)} → ${e.hp.toFixed(0)}`);

  // 유탄·지뢰·시체 폭발은 예전처럼 방패를 통째로 무시합니다
  const hp2 = e.hp;
  w.explode(e.x - e.radius - 4, e.y, 26, 100, true, '#8fe36b');
  check('방패를 무시하는 폭발은 정면에서도 들어간다', e.hp < hp2, `체력 ${hp2.toFixed(0)} → ${e.hp.toFixed(0)}`);
}

console.log('4-2c) 방패적: 산탄·화염은 방패에 막히는가');
for (const id of ['shotgun', 'flame'] as const) {
  const w = new World(emptySave(), input, 4242);
  w.spawner.enabled = false;
  // 방패적만 두어야 합니다. 다른 적이 있으면 미사일이 그쪽으로 갈 수 있습니다
  const shield = w.spawnEnemy('shield', 620, 360, {});
  // 방패를 안 깨지게 부풀립니다. 그냥 두면 1레벨 산탄 한 방에 내구도가 날아가고,
  // **깨진 뒤에 들어간 피해**를 "방패를 뚫었다"로 잘못 읽게 됩니다.
  // 보려는 것은 "방패가 살아 있는 동안 체력이 줄었는가" 하나뿐입니다
  shield.shieldHp = 1e6;
  shield.shieldMax = 1e6;
  // 적을 세워둡니다. 넉백에 밀려 돌아서면 뒤통수를 맞는데, 그건 방패 규칙이 아니라
  // 탄 궤적 운이라 시험이 매번 다른 답을 냅니다
  shield.speed = 0;
  w.player.x = 480;
  w.player.y = 360;
  // 기본공격을 재웁니다. 스킬만 보려는 시험인데 기본공격이 섞이면 누구 피해인지 모릅니다
  w.player.attackTimer = 99;
  const hpBefore = shield.hp;
  const slot = makeSlot(id, 1);
  const def = getSkillDef(id);
  // **칸에 실제로 끼워야 합니다.** 화염방사기는 지속형이라 피해가 `sustain` 에서 나오는데,
  // 그건 칸에 꽂혀 있을 때만 돕니다. 예전에는 안 꽂고 재서 화염의 피해가 0 이었고,
  // 그 자리를 기본공격이 대신 채우는 바람에 시험이 엉뚱한 이유로 통과하고 있었습니다
  w.player.attacks[0] = slot;
  def.activate(w, slot);
  step(w, 0.6);

  check(`${id} 가 방패를 깎는다`, shield.shieldHp < shield.shieldMax, `${shield.shieldHp.toFixed(0)}/${shield.shieldMax.toFixed(0)}`);

  if (id === 'shotgun') {
    // 산탄은 순수한 탄이라 방패가 살아 있는 동안 체력이 한 톨도 줄면 안 됩니다
    check(
      '산탄은 방패를 못 뚫는다',
      shield.hp >= hpBefore - 1e-6,
      `체력 ${hpBefore.toFixed(0)} → ${shield.hp.toFixed(0)}`,
    );
  } else {
    // **화염방사기는 직접 분사만 막힙니다. 화상은 방패를 무시합니다.**
    // 이미 몸에 붙은 불이라 정면 방패로 가릴 수가 없고, 그래서 화상 피해는
    // `fromX/fromY` 없이 들어가 방패 판정을 아예 안 탑니다. 통합 실행으로는
    // 이 둘이 섞여 분리가 안 되므로, 직접 분사 쪽은 규칙 자체를 확인합니다
    const before = shield.hp;
    const dealt = w.damageEnemy(shield, 999, { fromX: w.player.x, fromY: w.player.y });
    check('화염의 직접 피해는 정면에서 막힌다', dealt === 0 && shield.hp === before, `${dealt.toFixed(0)} 피해`);
    check('화상은 방패를 무시한다', w.damageEnemy(shield, 5) > 0, '화상은 fromX 없이 들어갑니다');
  }
}

console.log('4-3) 원거리적: 조준이 플레이어를 따라가는가');
{
  const w = new World(emptySave(), input, 606);
  w.spawner.enabled = false;
  const e = w.spawnEnemy('ranged', 700, 360, {});

  let fired: { angle: number; expected: number } | null = null;
  const steps = Math.round(12 / FIXED_DT);
  for (let i = 0; i < steps && !fired; i++) {
    input.beginStep();
    w.player.invuln = 1;
    // 조준하는 동안 플레이어가 계속 움직입니다
    w.player.x = 300;
    w.player.y = 200 + Math.sin(i * FIXED_DT * 2) * 150;
    const before = w.projectiles.filter((p) => p.kind === 'enemy').length;
    w.update(FIXED_DT);
    const bullets = w.projectiles.filter((p) => p.kind === 'enemy');
    if (bullets.length > before) {
      const b = bullets[bullets.length - 1];
      fired = {
        angle: Math.atan2(b.vy, b.vx),
        expected: Math.atan2(w.player.y - e.y, w.player.x - e.x),
      };
    }
  }

  check('사거리가 플레이어보다 길다', rangedAttackRange(w) > w.player.stats.range, `${rangedAttackRange(w).toFixed(0)} vs ${w.player.stats.range}`);
  check('조준을 마칠 때까지 살아있다 (자동공격 사거리 밖)', !e.dead);

  if (!fired) {
    check('원거리적이 발사했다', false);
  } else {
    const diff = Math.abs(((fired.angle - fired.expected + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    console.log(`   발사각 오차 ${((diff * 180) / Math.PI).toFixed(2)}도`);
    check('발사각이 발사 순간의 플레이어 위치를 향한다', diff < 0.06, `${((diff * 180) / Math.PI).toFixed(2)}도`);
  }
}

console.log('4-4) 겁쟁이적: 돌진이 플레이어급으로 빠른가');
{
  const w = new World(emptySave(), input, 707);
  w.spawner.enabled = false;
  const e = w.spawnEnemy('coward', 640, 360, {});
  const wanderSpeed = e.speed;

  let maxSpeed = 0;
  let dashed = false;
  let stopStreak = 0;
  let maxStopStreak = 0;
  const steps = Math.round(10 / FIXED_DT);
  for (let i = 0; i < steps && !e.dead; i++) {
    input.beginStep();
    w.player.invuln = 1;
    w.player.x = 640;
    w.player.y = 480; // 사거리 안에 계속 서 있습니다
    w.update(FIXED_DT);
    const s = Math.hypot(e.vx, e.vy);
    if (s > maxSpeed) maxSpeed = s;
    if (e.state.phase === 2) dashed = true;
    // 돌진을 한 번이라도 한 뒤부터 "멈춰 있는 시간"을 잽니다
    if (dashed) {
      stopStreak = s < 1 ? stopStreak + 1 : 0;
      if (stopStreak > maxStopStreak) maxStopStreak = stopStreak;
    }
  }

  const playerSpeed = w.player.stats.moveSpeed;
  const stopSeconds = maxStopStreak * FIXED_DT;
  console.log(
    `   배회 ${wanderSpeed.toFixed(0)} → 돌진 ${maxSpeed.toFixed(0)} (플레이어 ${playerSpeed}) · 최대 정지 ${stopSeconds.toFixed(2)}초`,
  );
  check('돌진했다', dashed);
  check('돌진 속도가 플레이어보다 빠르다', maxSpeed > playerSpeed, `${maxSpeed.toFixed(0)} vs ${playerSpeed}`);
  check('돌진 뒤 멈추지 않는다 (준비 동작 0.18초 외에 정지 없음)', stopSeconds <= 0.25, `${stopSeconds.toFixed(2)}초`);
}

console.log('4-5) 화염방사기: 불티가 닿는 곳까지가 실제 유효 범위인가');
{
  const w = new World(emptySave(), input, 808);
  w.spawner.enabled = false;
  w.player.x = 200;
  w.player.y = 360;

  const R = SKILLS.flame.range;
  // 사거리 안쪽 / 바깥쪽에 한 마리씩 정면으로 세웁니다
  const inside = w.spawnEnemy('tank', 200 + R * 0.95, 360, {});
  const outside = w.spawnEnemy('tank', 200 + R * 1.35, 360, {});
  inside.maxHp = outside.maxHp = 1e6;
  inside.hp = outside.hp = 1e6;
  inside.speed = outside.speed = 0;

  const slot = makeSlot('flame', 1);
  w.player.attacks[0] = slot;
  getSkillDef('flame').activate(w, slot);

  // 플레이어를 제자리에 고정합니다. 움직이면 사거리 밖 적이 범위 안으로 들어옵니다
  const flameSteps = Math.round(2.2 / FIXED_DT);
  for (let i = 0; i < flameSteps; i++) {
    input.beginStep();
    w.player.invuln = 1;
    w.player.x = 200;
    w.player.y = 360;
    w.update(FIXED_DT);
  }

  console.log(`   사거리 ${R} · 안쪽(${(R * 0.95).toFixed(0)}) 피해 ${(1e6 - inside.hp).toFixed(0)} · 바깥(${(R * 1.35).toFixed(0)}) 피해 ${(1e6 - outside.hp).toFixed(0)}`);
  check('사거리 안의 적은 맞는다', inside.hp < 1e6);
  check('사거리 밖의 적은 안 맞는다', outside.hp >= 1e6 - 0.001);
}

console.log('4-6) 코인: 공전하지 않고 곧바로 빨려 들어오는가');
{
  const w = new World(emptySave(), input, 909);
  w.spawner.enabled = false;
  w.player.x = 640;
  w.player.y = 360;

  // 획득 범위 경계에 떨어뜨리고, 플레이어는 계속 움직입니다 (가장 공전하기 쉬운 조건)
  const range = w.player.stats.pickupRange;
  w.dropCoin(640 + range - 2, 360);
  const coin = w.coins[0];

  let steps = 0;
  let prevDist = Infinity;
  let increases = 0;
  const limit = Math.round(2 / FIXED_DT);
  for (; steps < limit && !coin.dead; steps++) {
    input.beginStep();
    w.player.invuln = 1;
    w.player.x = 640 + Math.sin(steps * FIXED_DT * 6) * 90;
    w.player.y = 360 + Math.cos(steps * FIXED_DT * 6) * 90;
    w.update(FIXED_DT);
    const d = Math.hypot(coin.x - w.player.x, coin.y - w.player.y);
    if (coin.magnet && d > prevDist + 0.5) increases++;
    prevDist = d;
  }

  const seconds = steps * FIXED_DT;
  console.log(`   획득까지 ${seconds.toFixed(2)}초 · 멀어진 프레임 ${increases}회`);
  check('코인을 먹었다', coin.dead);
  check('0.4초 안에 들어온다', seconds <= 0.4, `${seconds.toFixed(2)}초`);
  check('한 번도 멀어지지 않는다 (공전 없음)', increases === 0, `${increases}회`);
}

console.log('4-7) 정예는 절반 확률로 코인을 떨어뜨리는가');
{
  // **2026-09-12 부터 확정이 아니라 확률입니다.** 확정 드랍이면 정예 한 마리가
  // 일반 적 14마리 몫이라 판 전체 코인의 60~70% 가 여기서 나왔습니다.
  // 확률이므로 한 마리로는 못 재고, 많이 잡아서 비율로 봅니다
  const w = new World(emptySave(), input, 1212);
  w.spawner.enabled = false;
  const count = 400;
  for (let i = 0; i < count; i++) w.spawner.spawnNow(w, 'basic', true);
  const elites = w.enemies.filter((e) => e.elite).length;
  for (const e of [...w.enemies]) w.killEnemy(e);
  const rate = w.coins.length / elites;
  console.log(`   정예 ${elites}마리 처치 → 코인 ${w.coins.length}개 (${(rate * 100).toFixed(0)}%)`);
  check('일반 적보다는 훨씬 잘 나온다', rate > ENEMY_BASE.coinChance * 3, `${(rate * 100).toFixed(0)}%`);
  check('확정은 아니다', rate < 1, `${(rate * 100).toFixed(0)}%`);
  check(
    '표에 적힌 확률 근처다',
    Math.abs(rate - ELITE.coinChance) < 0.12,
    `${(rate * 100).toFixed(0)}% (표 ${ELITE.coinChance * 100}%)`,
  );
}

console.log('4-8) 공격 스킬은 자동, 유틸 스킬은 수동인가');
{
  // 사거리 안에 직접 세웁니다. 가장자리 스폰에 맡기면 그날의 난수에 따라
  // 사거리 밖에 뜨는 판이 생겨서, 자동 발동과 무관한 이유로 실패합니다
  const w = new World(emptySave(), stillInput, 1313);
  w.spawner.enabled = false;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    w.spawnEnemy('basic', w.player.x + Math.cos(a) * 120, w.player.y + Math.sin(a) * 120, {});
  }

  w.player.attacks[0] = makeSlot('shotgun', 1); // 자동
  w.player.utility = makeSlot('dash', 1); // 수동
  step(w, 1.5);

  const shotgun = w.player.attacks[0]!;
  const dashSlot = w.player.utility!;
  console.log(`   산탄 쿨 ${shotgun.cooldown.toFixed(2)} · 대시 쿨 ${dashSlot.cooldown.toFixed(2)}`);
  check('공격 스킬은 키 없이 발동한다', shotgun.cooldown > 0);
  check('유틸 스킬은 키 없이 발동하지 않는다', dashSlot.cooldown === 0 && w.player.dashTime === 0);
  check(
    '스킬 종류가 의도대로다',
    getSkillDef('shotgun').kind === 'attack' && getSkillDef('dash').kind === 'utility',
  );
}

console.log('4-8b) 공격 3칸 상한과 유틸 1칸 교체가 지켜지는가');
{
  const w = new World(emptySave(), input, 2727);
  w.spawner.enabled = false;

  // 공격 3칸을 채웁니다
  for (const id of ['shotgun', 'sniper', 'laser'] as const) {
    applySkillChoice(w, { id, upgrade: false, level: 1, replacesUtility: false });
  }
  check('공격 3칸이 채워진다', w.player.attacks.every((s) => s !== null));

  // 꽉 찬 뒤에는 새 공격 스킬이 선택지에 나오지 않아야 합니다
  let newAttackOffers = 0;
  let utilityOffers = 0;
  for (let i = 0; i < 200; i++) {
    for (const c of generateSkillChoices(w)) {
      const def = getSkillDef(c.id);
      if (def.kind === 'attack' && !c.upgrade) newAttackOffers++;
      if (def.kind === 'utility') utilityOffers++;
    }
  }
  check('꽉 차면 새 공격 스킬은 안 나온다', newAttackOffers === 0, `${newAttackOffers}회 나왔습니다`);
  check('꽉 차도 유틸은 나온다', utilityOffers > 0);

  // 유틸을 하나 얻어 레벨을 올린 뒤 다른 유틸로 갈아탑니다
  applySkillChoice(w, { id: 'dash', upgrade: false, level: 1, replacesUtility: false });
  applySkillChoice(w, { id: 'dash', upgrade: true, level: 2, replacesUtility: false });
  applySkillChoice(w, { id: 'dash', upgrade: true, level: 3, replacesUtility: false });
  check('유틸 레벨업이 먹는다', w.player.utility?.id === 'dash' && w.player.utility.level === 3);

  // 교체 선택지가 **실제로** 쓰던 레벨을 달고 나와야 합니다.
  // 여기가 1 이면 카드에 적힌 수치와 고른 뒤의 성능이 갈립니다
  let swapLevel = 0;
  for (let i = 0; i < 300 && swapLevel === 0; i++) {
    const offer = generateSkillChoices(w).find((c) => c.replacesUtility);
    if (offer) swapLevel = offer.level;
  }
  check('유틸 교체 선택지가 쓰던 레벨을 달고 나온다', swapLevel === 3, `Lv.${swapLevel}`);

  applySkillChoice(w, { id: 'timeslow', upgrade: false, level: 3, replacesUtility: true });
  check(
    '유틸을 갈아타도 레벨이 유지된다',
    w.player.utility?.id === 'timeslow' && w.player.utility.level === 3,
    `${w.player.utility?.id} Lv.${w.player.utility?.level}`,
  );
  check('유틸은 여전히 한 개뿐이다', ownedSlots(w.player).filter((s) => getSkillDef(s.id).kind === 'utility').length === 1);

  // 한 번의 선택지에 유틸이 두 장 이상 섞이지 않아야 합니다
  let maxUtilityInOneRoll = 0;
  for (let i = 0; i < 200; i++) {
    const n = generateSkillChoices(w).filter((c) => getSkillDef(c.id).kind === 'utility').length;
    maxUtilityInOneRoll = Math.max(maxUtilityInOneRoll, n);
  }
  check('한 번에 유틸은 최대 1장', maxUtilityInOneRoll <= MAX_UTILITY_CHOICES_PER_ROLL, `${maxUtilityInOneRoll}장 나왔습니다`);
}

console.log('4-9) 리롤 구매가 판에 반영되는가');
{
  const save = emptySave();
  save.coins = 5000;
  const bought = [buyPerm(save, 'reroll'), buyPerm(save, 'reroll'), buyPerm(save, 'reroll')];
  const over = buyPerm(save, 'reroll');
  const w = new World(save, input, 1414);
  console.log(`   구매 ${bought.filter(Boolean).length}회 · 4회차 ${over ? '성공' : '차단'} · 판 시작 리롤 ${w.player.rerolls}회`);
  check('리롤은 3회까지만 산다', bought.every(Boolean) && !over);
  check('산 만큼 판에서 쓸 수 있다', w.player.rerolls === 3, `${w.player.rerolls}`);
}

console.log('5) 시간 강화가 처음부터 끝까지 같은 기울기인가 (분당 +0.2)');
{
  const w = new World(emptySave(), input, 31337);
  w.spawner.enabled = false;
  const at = (minutes: number) => {
    w.time = minutes * 60;
    const e = w.spawnEnemy('basic', 100, 100, {});
    e.dead = true;
    return { hp: e.maxHp, dmg: e.damage, speed: e.speed, grow: w.timeMultiplier(), lateSpeed: w.lateSpeedMultiplier() };
  };

  const base = at(0);
  console.log(`   0분 기준 · 체력 ${base.hp.toFixed(0)} · 공격력 ${base.dmg.toFixed(1)} · 속도 ${base.speed.toFixed(1)}`);
  for (const m of [5, 10, 15, 20, 30, 60]) {
    const r = at(m);
    const expected = 1 + m * TIME_SCALING.hpPerMinute;
    const expectedSpeed = 1 + Math.max(0, m - TIME_SCALING.speedStartMinute) * TIME_SCALING.speedPerMinute;
    console.log(
      `   ${String(m).padStart(2)}분 · 강화 x${r.grow.toFixed(2)} · 체력 ${r.hp.toFixed(0)} (x${(r.hp / base.hp).toFixed(2)})` +
        ` · 공격력 ${r.dmg.toFixed(1)} · 속도 ${r.speed.toFixed(1)} (x${(r.speed / base.speed).toFixed(3)})`,
    );
    check(`${m}분 강화 배율 x${expected.toFixed(2)}`, Math.abs(r.grow - expected) < 1e-9, r.grow.toFixed(3));
    check(`${m}분 체력이 배율만큼 오른다`, Math.abs(r.hp / base.hp - expected) < 1e-6);
    check(`${m}분 속도가 15분 이후 분당 +0.01배로 오른다`, Math.abs(r.speed / base.speed - expectedSpeed) < 1e-6, `${(r.speed / base.speed).toFixed(4)} vs ${expectedSpeed}`);
  }

  // **꺾이는 지점이 없어야 합니다.** 예전에는 15분에서 `LATE_SCALING` 이 이미 쌓인 x4 에
  // 다시 곱하는 바람에 기울기가 정확히 2배로 꺾였고, 하필 같은 시점에 플레이어 성장이
  // 감속해서 "후반이 갑자기 가팔라진다"가 됐습니다. 어느 두 구간을 재도 기울기가 같아야 합니다
  const slope = (a: number, b: number) => (at(b).hp - at(a).hp) / (b - a);
  const early = slope(0, 15);
  const late = slope(15, 30);
  check('앞 15분과 뒤 15분의 체력 기울기가 같다', Math.abs(early - late) < 1e-6, `${early.toFixed(3)} vs ${late.toFixed(3)}`);
  console.log(`   체력 기울기 · 0~15분 ${early.toFixed(2)}/분 · 15~30분 ${late.toFixed(2)}/분`);

  check('상한이 없다', at(120).grow > 20, `${at(120).grow.toFixed(1)}`);
  check('15분 이전에는 속도가 안 오른다', at(10).lateSpeed === 1);
  check('후반에도 기본적이 플레이어보다 느리다', at(60).speed < w.player.stats.moveSpeed, `${at(60).speed.toFixed(0)} vs ${w.player.stats.moveSpeed}`);
}

console.log('6) 성능: 적 200마리');
{
  const w = new World(emptySave(), input, 42);
  w.spawner.enabled = false;
  for (let i = 0; i < 200; i++) w.spawner.spawnNow(w, 'basic');
  const t0 = Date.now();
  step(w, 3);
  const ms = Date.now() - t0;
  const perStep = ms / Math.round(3 / FIXED_DT);
  console.log(`   180 스텝 ${ms}ms · 스텝당 ${perStep.toFixed(2)}ms (16.7ms 예산)`);
  check('스텝당 예산 안', perStep < 16.7, `${perStep.toFixed(2)}ms`);
}

// ---------------------------------------------------------------------------
console.log('7) 레벨업: 서로 다른 스탯이 정해진 개수만큼 오르는가');
{
  const w = new World(emptySave(), input, 20260804);
  w.spawner.enabled = false;

  const excluded: StatKey[] = ['projSpeed', 'invulnTime', 'pickupRange'];
  const before = { ...w.player.stats };
  const seen = new Set<StatKey>();
  let bad = 0;

  for (let i = 0; i < 200; i++) {
    const gains = rollStatGains(w);
    if (gains.length !== STAT_GAINS_PER_LEVEL) bad++;
    if (new Set(gains.map((g) => g.key)).size !== gains.length) bad++;
    for (const g of gains) seen.add(g.key);
  }

  console.log(`   200회 추첨에서 나온 스탯 ${seen.size}종 · 개수 위반 ${bad}건`);
  check(`한 번에 ${STAT_GAINS_PER_LEVEL}개가 서로 다르게 나온다`, bad === 0, `${bad}건`);
  check('빠진 스탯은 절대 안 나온다', excluded.every((k) => !seen.has(k)), [...seen].join(','));
  check('추첨만으로는 스탯이 안 변한다', excluded.every((k) => w.player.stats[k] === before[k]));

  // 실제 레벨업 경로로도 두 개가 오르는지 봅니다
  const w2 = new World(emptySave(), input, 5678);
  w2.spawner.enabled = false;
  const snapshot = { ...w2.player.stats };
  w2.gainXp(w2.player.xpToNext);
  const changed = (Object.keys(snapshot) as StatKey[]).filter((k) => w2.player.stats[k] !== snapshot[k]);
  check('레벨업 한 번에 스탯 2종이 바뀐다', changed.length === STAT_GAINS_PER_LEVEL, changed.join(','));
}

console.log('7-3) 성장 패시브: 지정 칸이 규칙대로 도는가');
{
  const trials = 30000;
  // 장착 상태를 만들어 레벨업 추첨을 반복하고, 그 스탯이 첫 칸에 뽑힌 비율을 잽니다.
  // 상수를 읽지 않고 **실제로 추첨을 돌려서** 재야 규칙이 바뀌었을 때 잡힙니다
  const measure = (equip: (StatKey | null)[], sealed: number) => {
    const save = emptySave();
    save.unlockedPassives = equip.filter((k): k is StatKey => k !== null);
    save.equippedPassives = [...equip];
    save.sealsOwned = sealed;
    save.sealedSlots = sealed;
    const w = new World(save, input, 4321);
    w.spawner.enabled = false;
    let hit = 0;
    for (let i = 0; i < trials; i++) {
      const g = rollStatGains(w, 1);
      if (g[0]?.key === 'attack') hit++;
      // 상한에 닿으면 추첨에서 빠져 비율이 흐려지므로 매번 되돌립니다
      w.player.stats = createStats({});
    }
    return (hit / trials) * 100;
  };

  const expect = (label: string, got: number, want: number) =>
    check(`${label} · 기대 ${want.toFixed(1)}%`, Math.abs(got - want) < 1.5, `${got.toFixed(1)}%`);

  const share = PASSIVE.chance * 100;
  const base = 100 - share; // 지정 칸이 실패했을 때 일반 추첨으로 넘어가는 몫
  const gen = statChanceOfAttack(); // 일반 추첨에서 공격력이 뽑힐 확률

  // 3칸 열림 · 1개만 장착 → 몫이 1/3 만 오고 나머지는 새어나갑니다
  expect('3칸 · 1개 장착', measure(['attack', null, null], 0), share / 3 + ((base + (share * 2) / 3) * gen) / 100);
  // 3칸 열림 · 3개 장착
  expect('3칸 · 3개 장착', measure(['attack', 'maxHp', 'regen'], 0), share / 3 + (base * gen) / 100);
  // 2칸 봉인 · 1개 장착 → 몫이 통째로 옵니다. 봉인의 존재 이유입니다
  expect('2칸 봉인 · 1개 장착', measure(['attack', null, null], 2), share + (base * gen) / 100);
  // 아무것도 안 끼면 지금까지와 똑같아야 합니다
  expect('빈 칸만 · 장착 없음', measure([null, null, null], 0), gen);

  console.log(
    `   3칸1개 ${measure(['attack', null, null], 0).toFixed(1)}% · 3칸3개 ${measure(['attack', 'maxHp', 'regen'], 0).toFixed(1)}%` +
      ` · 2칸봉인1개 ${measure(['attack', null, null], 2).toFixed(1)}% · 미장착 ${measure([null, null, null], 0).toFixed(1)}%`,
  );

  // 봉인하면 잠긴 칸의 장착이 빠져야 합니다. 안 그러면 화면에는 끼워져 있는데
  // 추첨에는 안 들어가서 왜 확률이 안 오르는지 알 수 없게 됩니다
  {
    const save = emptySave();
    save.unlockedPassives = ['attack', 'maxHp', 'regen'];
    save.equippedPassives = ['attack', 'maxHp', 'regen'];
    save.sealsOwned = 2;
    setSealed(save, 2);
    check('봉인하면 잠긴 칸이 비워진다', save.equippedPassives[1] === null && save.equippedPassives[2] === null);
    check('열린 칸은 그대로 남는다', save.equippedPassives[0] === 'attack');
  }

  // 같은 스탯을 두 칸에 못 넣습니다 (확률만 나뉘고 이득이 없습니다)
  {
    const save = emptySave();
    save.unlockedPassives = ['attack'];
    togglePassive(save, 0, 'attack');
    togglePassive(save, 1, 'attack');
    check('같은 패시브는 한 칸에만 들어간다', save.equippedPassives.filter((k) => k === 'attack').length === 1);
  }

  // 마지막 한 칸은 못 잠급니다
  {
    const save = emptySave();
    save.sealsOwned = 99;
    setSealed(save, 99);
    check('마지막 한 칸은 봉인되지 않는다', openSlots(save) >= 1, `열린 칸 ${openSlots(save)}`);
  }

  // 옛 가중치에 쓴 코인은 환불됩니다
  {
    const old = { coins: 100, weights: { attack: 15, critChance: 14 } };
    const migrated = JSON.parse(JSON.stringify(old));
    const loaded = fromJSON(migrated);
    // 공격력 15%p = 15회 x 30 = 450, 치명타 14%p = 7회 x 16 = 112
    check('옛 가중치 코인이 환불된다', loaded.coins === 100 + 450 + 112, `${loaded.coins}`);
  }
}

console.log('7-2) 스탯 상한: 닿으면 그 자리를 다른 스탯이 가져가는가');
{
  const w = new World(emptySave(), input, 5150);
  w.spawner.enabled = false;
  const capped = STAT_DEFS.filter((d) => d.cap !== undefined && d.rollable !== false);
  console.log(`   상한 있는 추첨 스탯 ${capped.length}종 · ${capped.map((d) => `${d.name} ${d.cap}`).join(' · ')}`);

  // 상한 있는 스탯을 전부 상한까지 밀어놓고 추첨을 돌립니다.
  // 상한에 닿은 것이 계속 뽑히면 레벨업이 통째로 헛돌게 됩니다
  for (const d of capped) w.player.stats[d.key] = d.cap!;
  let leaked = 0;
  for (let i = 0; i < 400; i++) {
    for (const g of rollStatGains(w)) if (capped.some((d) => d.key === g.key)) leaked++;
  }
  check('상한에 닿은 스탯은 더 안 뽑힌다', leaked === 0, `${leaked}회 새어나옴`);

  // 상한을 넘겨서 올리려 해도 넘지 않아야 합니다
  const r = w.player.stats;
  addStat(r, 'regen', 999);
  check('상한을 넘겨 올릴 수 없다', r.regen === STAT_DEFS.find((d) => d.key === 'regen')!.cap);

  // 영구 강화만으로 상한에 닿아버리면 그 스탯은 레벨업으로 한 번도 못 오릅니다.
  // 이동속도가 실제로 그랬습니다 (영구 20단계 = 365, 상한 370 이라 여유가 0.6회)
  const maxed = createStats(Object.fromEntries(PERM_UPGRADES.map((u) => [u.key, u.costs.length])));
  for (const d of STAT_DEFS) {
    if (d.cap === undefined || d.rollable === false) continue;
    const room = (d.cap - maxed[d.key]) / d.step;
    check(`${d.name} 은 영구 강화 뒤에도 올릴 여지가 있다`, room >= 3, `${room.toFixed(1)}회분`);
  }
}

console.log('8) 난이도: 단계가 오르면 적이 실제로 강해지는가');
{
  const near = (a: number, b: number) => Math.abs(a - b) < 0.0001;
  const base = new World(emptySave(), input, 4321, 0);
  const hard = new World(emptySave(), input, 4321, 5);
  base.spawner.enabled = false;
  hard.spawner.enabled = false;

  const b = base.spawnEnemy('basic', 640, 360, {});
  const h = hard.spawnEnemy('basic', 640, 360, {});

  console.log(`   난이도 5 · 체력 ${b.maxHp.toFixed(1)} → ${h.maxHp.toFixed(1)} · 공격력 ${b.damage.toFixed(1)} → ${h.damage.toFixed(1)}`);
  check('난이도 0 은 기존과 같다', difficultyMods(0).hpMul === 1 && difficultyMods(0).spawnRateMul === 1);
  check('체력이 오른다', h.maxHp > b.maxHp);
  check('공격력이 오른다', h.damage > b.damage);
  check('속도가 오른다', h.speed > b.speed);
  check('스폰율이 오른다', hard.spawner.currentRate(hard) > base.spawner.currentRate(base));
  // 7단계가 체력, 8단계가 공격력을 다시 올립니다. 각각 그 앞 단계보다 커야 누적입니다
  check('체력 효과가 누적된다', difficultyMods(7).hpMul > difficultyMods(6).hpMul);
  check('공격력 효과가 누적된다', difficultyMods(8).damageMul > difficultyMods(7).damageMul);
  check('난이도가 높을수록 코인 보상이 크다', difficultyMods(5).coinMul > difficultyMods(1).coinMul);

  // 배율은 곱이 아니라 합입니다. 표에 적힌 퍼센트를 그냥 다 더한 값이 최종이어야 합니다
  console.log(
    `   합산 확인 · 체력 15단계 x${difficultyMods(15).hpMul.toFixed(2)} (20+10+30+15+10+25 = 110%)` +
      ` · 공격력 x${difficultyMods(15).damageMul.toFixed(2)} (20+10+10+10+20 = 70%)`,
  );
  check('체력은 합으로 쌓인다', near(difficultyMods(15).hpMul, 2.1), `${difficultyMods(15).hpMul}`);
  check('공격력은 합으로 쌓인다', near(difficultyMods(15).damageMul, 1.7), `${difficultyMods(15).damageMul}`);
  check('속도는 합으로 쌓인다', near(difficultyMods(15).speedMul, 1.2), `${difficultyMods(15).speedMul}`);
  check('스폰율은 합으로 쌓인다', near(difficultyMods(15).spawnRateMul, 1.5), `${difficultyMods(15).spawnRateMul}`);
  // 같은 값이 두 단계에 걸쳐 붙었을 때 곱이 아닌지 못박아 둡니다 (25% + 25% 는 56% 가 아니라 50%)
  check('두 번 붙어도 곱이 아니다', !near(difficultyMods(15).spawnRateMul, 1.25 * 1.25));

  // 표는 15 에서 끝납니다. 그 위를 넣어도 15 로 잘려야 합니다
  check('16 이상은 15 로 잘린다', difficultyMods(30).level === DIFFICULTY.max && DIFFICULTY.max === 15);
  check('아래로도 -1 에서 멈춘다', difficultyMods(-9).level === DIFFICULTY.min && DIFFICULTY.min === -1);

  // 난이도 -1 은 0 보다 순해야 합니다
  const easy = new World(emptySave(), input, 4321, -1);
  easy.spawner.enabled = false;
  const eBasic = easy.spawnEnemy('basic', 640, 360, {});
  console.log(`   난이도 -1 · 체력 ${b.maxHp.toFixed(1)} → ${eBasic.maxHp.toFixed(1)} · 코인 x${difficultyMods(-1).coinMul}`);
  check('-1 은 체력이 낮다', eBasic.maxHp < b.maxHp);
  check('-1 은 공격력이 낮다', eBasic.damage < b.damage);
  check('-1 은 스폰이 느리다', easy.spawner.currentRate(easy) < base.spawner.currentRate(base));
  check('-1 은 코인이 줄어든다', difficultyMods(-1).coinMul < 1);

  // 보스 코인은 난이도 3당 +20%p. 이것도 곱이 아니라 합입니다
  console.log(`   보스 코인 · 3단계 x${difficultyMods(3).bossCoinMul.toFixed(2)} · 15단계 x${difficultyMods(15).bossCoinMul.toFixed(2)}`);
  check('보스 코인은 3단계마다 오른다', difficultyMods(3).bossCoinMul > difficultyMods(2).bossCoinMul);
  check('보스 코인은 같은 구간에서 그대로', difficultyMods(4).bossCoinMul === difficultyMods(3).bossCoinMul);
  check('보스 코인도 합으로 쌓인다', near(difficultyMods(15).bossCoinMul, 2.0), `${difficultyMods(15).bossCoinMul}`);

  // 난이도가 걸린 판이 실제로 굴러가는지 (예외·NaN 확인). 15 까지 전부 밟습니다
  for (let lv = DIFFICULTY.min; lv <= DIFFICULTY.max; lv++) {
    const run = new World(emptySave(), input, 8888, lv);
    step(run, 60, true, true);
    check(`난이도 ${lv} 로 판이 굴러간다`, finite(run.player.hp, run.time), `lv ${lv}`);
  }
}

console.log('8-2) 난이도 단계별 새 장치가 실제로 걸리는가');
{
  // 스킬 선택지 감소 (8단계)
  const w8 = new World(emptySave(), input, 77, 8);
  const w7 = new World(emptySave(), input, 77, 7);
  console.log(`   선택지 난이도 7 · ${generateSkillChoices(w7).length}장 → 난이도 8 · ${generateSkillChoices(w8).length}장`);
  check('8단계는 선택지가 한 장 줄어든다', generateSkillChoices(w8).length === generateSkillChoices(w7).length - 1);

  // 전원 정예화 (9단계)
  const w9 = new World(emptySave(), input, 77, 9);
  w9.spawner.enabled = false;
  let allElite = true;
  for (let i = 0; i < 20; i++) if (!rollElite(w9)) allElite = false;
  check('9단계는 전원 정예', allElite && w9.diff.allElite);
  check('9단계는 정예 확정 코인이 꺼진다', w9.diff.allElite);

  // 적탄 속도 (5단계)
  const w5 = new World(emptySave(), input, 77, 5);
  const w4 = new World(emptySave(), input, 77, 4);
  const fast = w5.addProjectile({ x: 0, y: 0, vx: 100, vy: 0, friendly: false });
  const slow = w4.addProjectile({ x: 0, y: 0, vx: 100, vy: 0, friendly: false });
  const mine = w5.addProjectile({ x: 0, y: 0, vx: 100, vy: 0, friendly: true });
  console.log(`   적탄 속도 난이도 4 · ${slow.vx} → 난이도 5 · ${fast.vx} (내 탄 ${mine.vx})`);
  check('5단계는 적탄이 빨라진다', fast.vx > slow.vx);
  check('내 탄은 그대로', mine.vx === 100);

  // 자폭병 전용 조정 (12단계)
  const w12 = new World(emptySave(), input, 77, 12);
  w12.spawner.enabled = false;
  const w11 = new World(emptySave(), input, 77, 11);
  w11.spawner.enabled = false;
  const b12 = w12.spawnEnemy('bomber', 640, 360, {});
  const b11 = w11.spawnEnemy('bomber', 640, 360, {});
  const n12 = w12.spawnEnemy('basic', 640, 360, {});
  const n11 = w11.spawnEnemy('basic', 640, 360, {});
  console.log(`   자폭병 속도 ${b11.speed.toFixed(1)} → ${b12.speed.toFixed(1)} · 기본적 ${n11.speed.toFixed(1)} → ${n12.speed.toFixed(1)}`);
  check('12단계는 자폭병이 느려진다', b12.speed < b11.speed);
  check('12단계는 자폭병이 아프다', b12.damage / b11.damage > 1.1);
  check('자폭병 조정이 다른 적에 새지 않는다', Math.abs(n12.speed - n11.speed) < 0.001);

  // 무적 바보적 (15단계). 판 시작에 딱 한 마리
  const w15 = new World(emptySave(), input, 77, 15);
  w15.spawner.enabled = false;
  const immortals = w15.enemies.filter((e) => e.immortal);
  console.log(`   무적 바보적 ${immortals.length}마리 · 종류 ${immortals[0]?.defId}`);
  check('15단계는 무적 바보적이 딱 한 마리', immortals.length === 1 && immortals[0].defId === 'fool');
  const before = immortals[0].hp;
  w15.damageEnemy(immortals[0], 99999);
  check('무적 바보적은 피해를 안 받는다', immortals[0].hp === before && !immortals[0].dead);
  check('14단계에는 무적 바보적이 없다', new World(emptySave(), input, 77, 14).enemies.every((e) => !e.immortal));

  // 무적 바보적의 세 가지는 한 묶음입니다 (2026-08-12).
  // 하나만 빠져도 "화력을 통째로 빨아먹는 적" 이거나 "무시하고 지나칠 수 있는 적"이 됩니다
  {
    const boss = immortals[0];
    check('무적 바보적은 타겟이 안 된다', !canTarget(boss), `targetable ${boss.targetable}`);

    // 같은 판의 일반 바보적과 견줍니다. 난이도 배율이 양쪽에 똑같이 걸려야 비교가 됩니다
    const plain = w15.spawnEnemy('fool', 300, 300, {});
    check('일반 바보적은 타겟이 된다', canTarget(plain), '무적만 빠져야 합니다');
    check(
      '무적 바보적이 1.5배 빠르다',
      Math.abs(boss.speed / plain.speed - ENEMY_PARAMS.fool.immortalSpeedMul) < 0.01,
      `x${(boss.speed / plain.speed).toFixed(2)}`,
    );

    // 실제로 쏘게 해서 잽니다. 상수를 읽으면 나중에 갈래 규칙이 바뀌어도 시험이 통과합니다
    const shots = (e: typeof boss) => {
      w15.projectiles.length = 0;
      // 벽에 딱 붙여놓고 벽 쪽으로 밀면 다음 한 스텝에 바로 튕깁니다.
      // 멀리 두면 벽까지 걸어가는 동안 스텝이 모자라 한 발도 안 나옵니다
      e.x = e.radius + 0.5;
      e.y = 360;
      e.state.flag = true;
      e.state.angle = Math.PI;
      for (let i = 0; i < 5 && w15.projectiles.length === 0; i++) e.def.behavior(e, w15, FIXED_DT);
      return w15.projectiles.filter((p) => !p.friendly);
    };

    const mine = shots(boss);
    const theirs = shots(plain);
    const spd = (ps: typeof mine) => Math.hypot(ps[0].vx, ps[0].vy);
    console.log(`   무적 ${mine.length}갈래 · 탄속 ${spd(mine).toFixed(0)} / 일반(15단계) ${theirs.length}갈래 · 탄속 ${spd(theirs).toFixed(0)}`);

    check('무적 바보적은 5갈래로 쏜다', mine.length === ENEMY_PARAMS.fool.immortalBulletCount, `${mine.length}갈래`);
    check('일반 바보적은 15단계 전방위 그대로', theirs.length === (w15.diff.foolShotDirs ?? 0), `${theirs.length}갈래`);
    check('무적 바보적 탄이 절반 속도다', Math.abs(spd(mine) / spd(theirs) - ENEMY_PARAMS.fool.immortalBulletSpeedMul) < 0.02, `x${(spd(mine) / spd(theirs)).toFixed(2)}`);

    // 부채꼴이 플레이어를 향하는가. 전방위면 이 검사가 실패합니다
    const toPlayer = Math.atan2(w15.player.y - boss.y, w15.player.x - boss.x);
    const worst = Math.max(...mine.map((p) => Math.abs(((Math.atan2(p.vy, p.vx) - toPlayer + Math.PI * 3) % (Math.PI * 2)) - Math.PI)));
    check('5갈래가 전부 플레이어 쪽 부채꼴 안이다', worst < Math.PI / 2, `최대 ${(worst * 180 / Math.PI).toFixed(0)}도`);
    plain.dead = true;
  }

  // 장판 지속 (15단계)
  const w15b = new World(emptySave(), input, 77, 15);
  const w14 = new World(emptySave(), input, 77, 14);
  w15b.addHazard({ x: 0, y: 0, radius: 10, duration: 10, slow: 1, color: '#fff' });
  w14.addHazard({ x: 0, y: 0, radius: 10, duration: 10, slow: 1, color: '#fff' });
  check('15단계는 장판이 오래 남는다', w15b.hazards[0].maxLife > w14.hazards[0].maxLife);
}

console.log('8-3) 스폰 웨이브가 실제로 쏟아지는가');
{
  // 난이도 6: 1분마다 5마리. 웨이브가 없는 5단계와 비교합니다
  const withWave = new World(emptySave(), input, 202, 6);
  const noWave = new World(emptySave(), input, 202, 5);
  check('6단계에 웨이브가 생긴다', withWave.diff.wave !== null && noWave.diff.wave === null);
  check('11단계가 웨이브를 갈아끼운다', difficultyMods(11).wave!.count === 15 && difficultyMods(11).wave!.startTime === 300);
  check('웨이브는 겹쳐 쌓이지 않는다', difficultyMods(11).wave!.count !== difficultyMods(6).wave!.count);
  check('12단계에 자폭병 웨이브가 붙는다', difficultyMods(12).bomberWave !== null && difficultyMods(11).bomberWave === null);

  // 실제로 나오는지. 평소 스폰을 끄고 웨이브만 남겨 세어 봅니다
  const w = new World(emptySave(), input, 303, 6);
  w.time = 59;
  step(w, 3, true, true);
  console.log(`   1분 직후 적 ${w.enemies.length}마리`);
  check('웨이브가 실제로 나온다', w.enemies.length >= 5, `${w.enemies.length}마리`);
}

console.log('9) 사망 원인이 기록되는가');
{
  // 접촉사
  const w = new World(emptySave(), input, 1357);
  w.spawner.enabled = false;
  const e = w.spawnEnemy('tank', 640, 360, {});
  w.player.x = e.x;
  w.player.y = e.y;
  w.player.invuln = 0;
  w.player.stats.maxHp = 1;
  w.player.hp = 1;
  step(w, 1, false);
  check('접촉사는 그 적이 사인으로 남는다', w.killedBy?.id === 'tank', String(w.killedBy?.id));

  // 장판사: 장판을 깐 적이 이미 죽었어도 사인이 남아야 합니다
  const w2 = new World(emptySave(), input, 2468);
  w2.spawner.enabled = false;
  const puddle = w2.spawnEnemy('puddle', 200, 200, {});
  w2.killEnemy(puddle);
  const hazard = w2.hazards[0];
  check('장판에 주인이 기록된다', hazard?.source?.id === 'puddle', String(hazard?.source?.id));

  // 정예 여부도 같이 남습니다
  const w3 = new World(emptySave(), input, 9753);
  w3.spawner.enabled = false;
  const elite = w3.spawnEnemy('basic', 640, 360, { elite: true });
  w3.player.x = elite.x;
  w3.player.y = elite.y;
  w3.player.invuln = 0;
  w3.player.stats.maxHp = 1;
  w3.player.hp = 1;
  step(w3, 1, false);
  check('정예에게 죽으면 정예로 남는다', w3.killedBy?.elite === true);
}

// ---------------------------------------------------------------------------
console.log('10) 적을 서로 구분할 수 있는가 (색 · 모양 · 표식)');
{
  // 난전에서 적을 못 알아보면 피할 수가 없습니다.
  // "색 = 위험도, 모양 = 행동 유형" 규칙이 깨지지 않았는지 자동으로 잡습니다
  const defs = ALL_ENEMY_IDS.map((id) => getEnemyDef(id));

  // 10-1) 같은 실루엣(변 수 + 표식)을 두 종이 나눠 쓰면 안 됩니다
  const shapes = new Map<string, string[]>();
  for (const d of defs) {
    const key = `${d.sides}/${d.extraDraw ?? 'none'}`;
    shapes.set(key, [...(shapes.get(key) ?? []), d.name]);
  }
  const dupShapes = [...shapes.entries()].filter(([, names]) => names.length > 1);
  check(
    '같은 실루엣을 쓰는 적이 없다',
    dupShapes.length === 0,
    dupShapes.map(([k, n]) => `${k}: ${n.join('·')}`).join(' / '),
  );

  // 10-2) 색이 너무 가까우면 뭉쳐 있을 때 섞입니다
  const rgb = (hex: string) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
  const colorDist = (a: string, b: string) => {
    const [r1, g1, b1] = rgb(a);
    const [r2, g2, b2] = rgb(b);
    return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
  };

  let worst = { pair: '', dist: Infinity };
  for (let i = 0; i < defs.length; i++) {
    for (let j = i + 1; j < defs.length; j++) {
      const d = colorDist(defs[i].color, defs[j].color);
      if (d < worst.dist) worst = { pair: `${defs[i].name}·${defs[j].name}`, dist: d };
    }
  }
  console.log(`   가장 가까운 색 조합 ${worst.pair} 거리 ${worst.dist.toFixed(0)}`);
  check('어떤 두 적도 색이 너무 붙어 있지 않다', worst.dist >= 45, `${worst.pair} ${worst.dist.toFixed(0)}`);

  // 10-3) 위험한 적일수록 강렬한 난색을 씁니다 (색 = 위험도 규칙)
  const warmth = (hex: string) => {
    const [r, g, b] = rgb(hex);
    return r - (g + b) / 2;
  };
  const danger = (id: EnemyId) => ENEMY_TABLE[id].damage;
  const deadly = ALL_ENEMY_IDS.filter((id) => danger(id) >= 1.8);
  const mild = ALL_ENEMY_IDS.filter((id) => danger(id) <= 1.0);
  const coldestDeadly = Math.min(...deadly.map((id) => warmth(getEnemyDef(id).color)));
  const warmestMild = Math.max(...mild.map((id) => warmth(getEnemyDef(id).color)));
  console.log(`   즉사급 최저 난색도 ${coldestDeadly.toFixed(0)} · 안전급 최고 난색도 ${warmestMild.toFixed(0)}`);
  check('즉사급 적이 안전한 적보다 난색이다', coldestDeadly > warmestMild, `${coldestDeadly} vs ${warmestMild}`);
}

console.log('10-2) 적탄은 쏜 적과 무관하게 같은 빨강인가');
{
  const w = new World(emptySave(), input, 3141);
  w.spawner.enabled = false;

  // 원거리적이 조준하고 쏠 때까지 둡니다
  w.spawnEnemy('ranged', 700, 360, {});
  w.player.x = 640;
  w.player.y = 360;
  step(w, ENEMY_PARAMS.ranged.aimTime + 0.6);

  // 보스 탄막도 같이 확인합니다
  w.spawnBoss();
  step(w, 6);

  const enemyShots = w.projectiles.filter((p) => !p.friendly);
  const offColor = enemyShots.filter((p) => p.color !== ENEMY_BULLET.color);
  console.log(`   적탄 ${enemyShots.length}발 · 색이 다른 탄 ${offColor.length}발`);
  check('적탄이 실제로 날아왔다', enemyShots.length > 0);
  check('적탄 색이 전부 통일돼 있다', offColor.length === 0, [...new Set(offColor.map((p) => p.color))].join(','));

  // 탄이 플레이어보다 빨라야 조준이 위협이 됩니다
  console.log(`   탄속 ${ENEMY_PARAMS.ranged.bulletSpeed} · 플레이어 이동속도 ${w.player.stats.moveSpeed}`);
  check('탄이 플레이어 기본 이동속도보다 빠르다', ENEMY_PARAMS.ranged.bulletSpeed > w.player.stats.moveSpeed);
}

console.log('10-3) 돌진적: 예고 뒤 순식간에 튀어나가는가');
{
  const w = new World(emptySave(), stillInput, 2626);
  w.spawner.enabled = false;
  const e = w.spawnEnemy('charger', 200, 360, {});
  // 예고 3초 동안 기본공격에 먼저 죽으면 돌진 자체를 못 봅니다
  makeUnkillable(e);
  w.player.x = 500;
  w.player.y = 360;

  let maxSpeed = 0;
  let telegraphSeen = false;
  let barTotal = 0;
  for (let i = 0; i < Math.round(12 / FIXED_DT); i++) {
    stillInput.beginStep();
    w.player.invuln = 1;
    w.update(FIXED_DT);
    if (e.state.phase === 1) {
      telegraphSeen = true;
      barTotal = e.state.timer3;
    }
    maxSpeed = Math.max(maxSpeed, Math.hypot(e.vx, e.vy));
  }

  console.log(`   최고 속도 ${maxSpeed.toFixed(0)} (플레이어 ${w.player.stats.moveSpeed}) · 막대 기준 ${barTotal.toFixed(2)}초`);
  check('돌진 예고가 떴다', telegraphSeen);
  check('막대 기준 시간이 채워져 있다', barTotal > 0, `${barTotal}`);
  check(
    '돌진이 플레이어보다 훨씬 빠르다',
    maxSpeed > w.player.stats.moveSpeed * 3,
    `${maxSpeed.toFixed(0)} vs ${w.player.stats.moveSpeed}`,
  );

  // 정예는 예고가 짧습니다
  const w2 = new World(emptySave(), input, 2626);
  w2.spawner.enabled = false;
  const normal = w2.spawnEnemy('charger', 200, 360, {});
  const elite = w2.spawnEnemy('charger', 200, 400, { elite: true });
  console.log(`   예고 일반 ${chargerTelegraphTime(normal).toFixed(2)}초 · 정예 ${chargerTelegraphTime(elite).toFixed(2)}초`);
  check('정예 돌진적은 예고가 짧다', chargerTelegraphTime(elite) < chargerTelegraphTime(normal));
}

console.log('10-4) 정예 고유 강화가 걸리는가');
{
  const w = new World(emptySave(), input, 5252);
  w.spawner.enabled = false;
  const normal = w.spawnEnemy('ranged', 700, 360, {});
  const elite = w.spawnEnemy('ranged', 700, 400, { elite: true });

  console.log(`   조준 일반 ${rangedAimTime(normal).toFixed(2)}초 · 정예 ${rangedAimTime(elite).toFixed(2)}초`);
  check('정예 원거리적은 조준이 0.4배다', Math.abs(rangedAimTime(elite) / rangedAimTime(normal) - 0.4) < 1e-9);

  // 고유 강화가 없는 적은 정예여도 그대로여야 합니다
  const plain = w.spawnEnemy('basic', 300, 300, { elite: true });
  check('표에 없는 적은 고유 강화가 없다', eliteMul(plain, 'aimTimeMul') === 1);

  // 종류별 체력 · 속도는 공통 배율을 대체합니다. 곱하면 안 됩니다
  for (const [id, hpMul, speedMul] of [
    ['tank', 3.0, 0.8],
    ['fast', 2.0, 1.4],
  ] as const) {
    const base = w.spawnEnemy(id, 400, 300, {});
    const big = w.spawnEnemy(id, 400, 340, { elite: true });
    const hpRatio = big.maxHp / base.maxHp;
    const speedRatio = big.speed / base.speed;
    console.log(
      `   ${base.def.name} 정예 체력 x${hpRatio.toFixed(2)} (기대 ${hpMul}) · 속도 x${speedRatio.toFixed(2)} (기대 ${speedMul})`,
    );
    check(`${base.def.name} 정예 체력이 표 그대로다`, Math.abs(hpRatio - hpMul) < 1e-6, `${hpRatio}`);
    check(`${base.def.name} 정예 속도가 표 그대로다`, Math.abs(speedRatio - speedMul) < 1e-6, `${speedRatio}`);
  }

  // 표에 값이 없는 적은 공통 배율 그대로여야 합니다
  const plainBase = w.spawnEnemy('basic', 500, 300, {});
  const plainElite = w.spawnEnemy('basic', 500, 340, { elite: true });
  check(
    '표에 없는 적은 공통 체력 배율을 쓴다',
    Math.abs(plainElite.maxHp / plainBase.maxHp - ELITE.hpMul) < 1e-6,
  );
}

console.log('10-4-2) 자폭적은 스폰 후 잠시 멈춰 있는가');
{
  const w = new World(emptySave(), input, 3131);
  w.spawner.enabled = false;
  const e = w.spawnEnemy('bomber', 200, 360, {});
  w.player.x = 900;
  w.player.y = 360;
  const startX = e.x;

  // 대기 시간의 절반 지점에서는 아직 제자리여야 합니다
  step(w, ENEMY_PARAMS.bomber.spawnDelay * 0.5, true, true);
  const movedWhileWaiting = Math.abs(e.x - startX);

  // 대기가 끝나면 플레이어 쪽으로 움직여야 합니다
  step(w, 1.5, true, true);
  const movedAfter = e.x - startX;

  console.log(
    `   대기 ${ENEMY_PARAMS.bomber.spawnDelay}초 · 대기 중 이동 ${movedWhileWaiting.toFixed(1)}px · 그 뒤 이동 ${movedAfter.toFixed(1)}px`,
  );
  check('대기 중에는 거의 움직이지 않는다', movedWhileWaiting < 2, `${movedWhileWaiting}`);
  check('대기가 끝나면 플레이어 쪽으로 온다', movedAfter > 20, `${movedAfter}`);

  // 점화되면 대기를 무시하고 곧바로 달려듭니다
  const w2 = new World(emptySave(), input, 3132);
  w2.spawner.enabled = false;
  const b = w2.spawnEnemy('bomber', 200, 360, {});
  w2.player.x = 900;
  w2.player.y = 360;
  bomberIgnite(b, w2);
  const igniteX = b.x;
  step(w2, ENEMY_PARAMS.bomber.spawnDelay * 0.5, true, true);
  check('점화되면 대기가 취소된다', b.x - igniteX > 5, `${(b.x - igniteX).toFixed(1)}px`);
}

console.log('10-4-3) 자폭적의 방아쇠 세 가지 (피격 · 근접 · 처치)');
{
  // 맞으면 점화되어 빨라집니다
  const w = new World(emptySave(), stillInput, 4141);
  w.spawner.enabled = false;
  const shot = w.spawnEnemy('bomber', 200, 360, {});
  makeUnkillable(shot);
  w.player.x = 900;
  w.player.y = 360;
  step(w, ENEMY_PARAMS.bomber.spawnDelay + 0.1);
  const calmSpeed = Math.hypot(shot.vx, shot.vy);
  w.damageEnemy(shot, 1);
  step(w, 0.1);
  const litSpeed = Math.hypot(shot.vx, shot.vy);
  console.log(`   피격 점화 · 속도 ${calmSpeed.toFixed(0)} → ${litSpeed.toFixed(0)} · 도화선 ${shot.state.timer.toFixed(1)}초`);
  check('맞으면 점화된다', shot.state.flag === true);
  check('점화되면 빨라진다', litSpeed > calmSpeed * 2, `${calmSpeed.toFixed(0)} → ${litSpeed.toFixed(0)}`);
  check('피격 점화 도화선은 4초쪽이다', shot.state.timer > ENEMY_PARAMS.bomber.contactFuse * 2);

  // 바로 앞까지 붙으면 점화되어 터지고 플레이어가 맞습니다
  const w2 = new World(emptySave(), stillInput, 4142);
  w2.spawner.enabled = false;
  const near = w2.spawnEnemy('bomber', 400, 360, {});
  makeUnkillable(near);
  // 기본공격이 먼저 맞히면 피격 점화(4초)가 걸려서 근접 점화(0.8초)를 못 잽니다
  w2.player.stats.range = 0;
  w2.player.x = 400 + near.radius + w2.player.radius + ENEMY_PARAMS.bomber.triggerRange - 4;
  w2.player.y = 360;
  const hpBefore = w2.player.hp;
  // godMode 를 끕니다. 폭발이 실제로 플레이어를 때리는지 봐야 합니다
  step(w2, ENEMY_PARAMS.bomber.spawnDelay + ENEMY_PARAMS.bomber.contactFuse + 0.3, false);
  console.log(`   근접 자폭 · 플레이어 체력 ${hpBefore.toFixed(0)} → ${w2.player.hp.toFixed(0)}`);
  check('근접하면 점화되어 터진다', near.dead);
  check('근접 자폭은 플레이어를 때린다', w2.player.hp < hpBefore);
  check('자폭한 개체는 시체 폭발이 없다', w2.pendingBlasts.length === 0);

  // 처치하면 2초 뒤 시체가 터지고, 그 폭발은 옆에 있던 적도 때립니다
  const w3 = new World(emptySave(), stillInput, 4143);
  w3.spawner.enabled = false;
  const corpse = w3.spawnEnemy('bomber', 400, 360, {});
  const bystander = w3.spawnEnemy('basic', 430, 360, {});
  makeUnkillable(bystander);
  // 걸어서 반경 밖으로 나가버리면 폭발이 닿았는지를 못 잽니다
  bystander.speed = 0;
  w3.player.x = 900;
  w3.player.y = 360;
  const bystanderHp = bystander.hp;
  w3.killEnemy(corpse);
  check('처치 직후에는 아직 안 터진다', w3.pendingBlasts.length === 1 && bystander.hp === bystanderHp);
  step(w3, ENEMY_PARAMS.bomber.corpseDelay + 0.2);
  const lost = bystanderHp - bystander.hp;
  console.log(`   시체 폭발 ${ENEMY_PARAMS.bomber.corpseDelay}초 뒤 · 옆 적이 받은 피해 ${lost.toFixed(0)}`);
  check('시체는 잠시 뒤에 터진다', w3.pendingBlasts.length === 0);
  check('시체 폭발은 적에게도 들어간다', lost > 0, `${lost}`);
}

console.log('10-4-4) 겁쟁이는 방치되면 결국 달려드는가');
{
  const P = ENEMY_PARAMS.coward;
  const w = new World(emptySave(), stillInput, 5151);
  w.spawner.enabled = false;
  const e = w.spawnEnemy('coward', 200, 360, {});
  makeUnkillable(e);
  w.player.x = 1100;
  w.player.y = 360;

  // 인내가 남아 있는 동안에는 돌진하지 않습니다 (사거리 밖이므로)
  let dashedWhileCalm = false;
  for (let i = 0; i < Math.round(P.patienceTime * 0.5 / FIXED_DT); i++) {
    step(w, FIXED_DT);
    if (!cowardEnraged(e, w) && e.state.phase !== 0 && dist(e.x, e.y, w.player.x, w.player.y) > P.triggerRange * 1.2) {
      dashedWhileCalm = true;
    }
  }
  const calmDist = dist(e.x, e.y, w.player.x, w.player.y);
  check('인내가 남아 있으면 멀리서 달려들지 않는다', !dashedWhileCalm);
  check('인내 전에는 아직 평온하다', !cowardEnraged(e, w));

  // 인내가 끝나면 사거리와 무관하게 달려듭니다
  step(w, P.patienceTime * 0.5 + 8);
  const rageDist = dist(e.x, e.y, w.player.x, w.player.y);

  console.log(`   인내 ${P.patienceTime}초 · 거리 ${calmDist.toFixed(0)}px → ${rageDist.toFixed(0)}px`);
  check('인내가 끝나면 상태가 바뀐다', cowardEnraged(e, w));
  check('인내가 끝나면 플레이어에게 붙는다', rageDist < 120, `${rageDist.toFixed(0)}px`);
}

console.log('10-4-5) 정예 탱커는 체력을 재생하는가');
{
  const w = new World(emptySave(), stillInput, 6161);
  w.spawner.enabled = false;
  // 사거리(330) 밖에 둡니다. 기본공격이 닿으면 재생량이 아니라 차액을 재게 됩니다
  const t = w.spawnEnemy('tank', 300, 200, { elite: true });
  w.player.x = 1200;
  w.player.y = 660;
  w.damageEnemy(t, t.maxHp * 0.5);
  const low = t.hp;
  step(w, 2);
  const healed = (t.hp - low) / t.maxHp / 2;

  console.log(`   체력 ${low.toFixed(0)} → ${t.hp.toFixed(0)} / ${t.maxHp.toFixed(0)} · 초당 ${(healed * 100).toFixed(1)}%`);
  check('정예 탱커는 초당 5% 회복한다', Math.abs(healed - 0.05) < 0.005, `${(healed * 100).toFixed(2)}%`);

  // 일반 탱커는 재생이 없습니다
  const w2 = new World(emptySave(), stillInput, 6162);
  w2.spawner.enabled = false;
  const plain = w2.spawnEnemy('tank', 300, 200, {});
  w2.player.x = 1200;
  w2.player.y = 660;
  w2.damageEnemy(plain, plain.maxHp * 0.5);
  const plainLow = plain.hp;
  step(w2, 2);
  check('일반 탱커는 재생이 없다', plain.hp === plainLow, `${plainLow.toFixed(1)} → ${plain.hp.toFixed(1)}`);
}

console.log('10-4-6) 체인 라이트닝은 거리와 무관하게 연쇄 횟수만큼 때리는가');
{
  const w = new World(emptySave(), stillInput, 7171);
  w.spawner.enabled = false;
  w.player.x = 300;
  w.player.y = 360;
  // 치명타가 뜨면 감쇠율이 아니라 운을 재게 됩니다
  w.player.stats.critChance = 0;

  // 화면 끝까지 멀찍이 흩뿌립니다. 연쇄 사거리가 남아 있으면 첫 마리에서 끊깁니다
  const spots = [
    [420, 340],
    [900, 120],
    [1300, 620],
    [520, 660],
    [1150, 300],
  ] as const;
  const line = spots.map(([x, y]) => {
    const e = w.spawnEnemy('basic', x, y, {});
    makeUnkillable(e);
    e.speed = 0;
    return e;
  });
  const before = line.map((e) => e.hp);

  const level = 1;
  const jumps = Math.round(SKILLS.chain.jumps + SKILLS.chain.jumpsPerLevel * (level - 1));
  getSkillDef('chain').activate(w, makeSlot('chain', level));

  const taken = line.map((e, i) => before[i] - e.hp);
  const reached = taken.filter((d) => d > 0).length;
  const sorted = taken.filter((d) => d > 0).sort((a, b) => b - a);
  const tail = sorted[sorted.length - 1] / sorted[0];

  console.log(
    `   최소 간격 ${Math.round(Math.min(...spots.slice(1).map(([x, y]) => Math.hypot(x - spots[0][0], y - spots[0][1]))))}px 이상 · 때린 수 ${reached}/${jumps} · 피해 ${sorted.map((d) => d.toFixed(0)).join(' → ')}`,
  );
  check('연쇄 횟수만큼 반드시 때린다', reached === jumps, `${reached}/${jumps}`);
  check('마지막 대상도 충분히 아프다', tail > 0.7, `${(tail * 100).toFixed(0)}%`);

  // 대상이 모자라면 있는 만큼만 때리고 끊깁니다
  const w2 = new World(emptySave(), stillInput, 7172);
  w2.spawner.enabled = false;
  w2.player.x = 300;
  w2.player.y = 360;
  const few = [w2.spawnEnemy('basic', 500, 360, {}), w2.spawnEnemy('basic', 1200, 200, {})];
  few.forEach((e) => {
    makeUnkillable(e);
    e.speed = 0;
  });
  const fewBefore = few.map((e) => e.hp);
  getSkillDef('chain').activate(w2, makeSlot('chain', 1));
  check('대상이 모자라면 있는 만큼만 때린다', few.every((e, i) => fewBefore[i] - e.hp > 0));
}

console.log('10-4-7) 레벨업 알림이 창을 닫은 뒤에 스탯 → 스킬 순서로 뜨는가');
{
  const w = new World(emptySave(), stillInput, 8181);
  w.spawner.enabled = false;

  // 스킬 선택창이 뜨는 레벨까지 올립니다
  while (!isSkillLevel(w.player.level + 1)) w.gainXp(w.player.xpToNext);
  w.effects.texts.length = 0;
  w.notices.length = 0;
  w.gainXp(w.player.xpToNext);

  check('스킬 선택창이 예약됐다', w.pendingSkillChoices > 0);
  check('스탯 글자는 아직 안 떴다', w.effects.texts.length === 0, `${w.effects.texts.length}`);
  check('스탯 알림이 줄 서 있다', w.notices.length === STAT_GAINS_PER_LEVEL, `${w.notices.length}`);

  // 선택창이 떠 있는 동안 world.update 가 멈추므로 대기 시간도 멈춥니다
  const statTail = w.noticeTail();
  const choices = generateSkillChoices(w);
  w.pendingSkillChoices--;
  applySkillChoice(w, choices[0]);
  const skillNotice = w.notices[w.notices.length - 1];
  check('스킬 알림이 스탯보다 뒤에 있다', skillNotice.delay > statTail, `${skillNotice.delay} vs ${statTail}`);

  // 창을 닫고 진행하면 순서대로 뜹니다
  const order: string[] = [];
  for (let i = 0; i < Math.round(2 / FIXED_DT); i++) {
    const before = w.effects.texts.length;
    step(w, FIXED_DT);
    for (let k = before; k < w.effects.texts.length; k++) order.push(w.effects.texts[k].text);
    if (w.notices.length === 0) break;
  }

  console.log(`   뜬 순서 ${order.join(' → ')}`);
  check('스탯이 먼저 전부 뜬다', order.length === STAT_GAINS_PER_LEVEL + 1, `${order.length}`);
  check('스킬이 마지막에 뜬다', order[order.length - 1].includes(getSkillDef(choices[0].id).name));
}

console.log('10-4-8) 돌진적: 인식 사거리가 없고 벽에 붙어도 제대로 돌진하는가');
{
  // 화면 반대편 끝에 있어도 예고를 시작합니다
  const w = new World(emptySave(), stillInput, 9191);
  w.spawner.enabled = false;
  const far = w.spawnEnemy('charger', 120, 120, {});
  makeUnkillable(far);
  w.player.x = CANVAS.w - 120;
  w.player.y = CANVAS.h - 120;
  let sawTelegraph = false;
  for (let i = 0; i < Math.round(12 / FIXED_DT); i++) {
    step(w, FIXED_DT);
    if (far.state.phase === 1) {
      sawTelegraph = true;
      break;
    }
  }
  console.log(`   거리 ${dist(120, 120, w.player.x, w.player.y).toFixed(0)}px 에서 예고 ${sawTelegraph ? '시작' : '없음'}`);
  check('사거리와 무관하게 예고를 시작한다', sawTelegraph);

  // 벽에 붙여 놓아도 벽에서 떨어진 뒤 예고하고, 곧바로 자기 기절에 걸리지 않습니다
  const w2 = new World(emptySave(), stillInput, 9192);
  w2.spawner.enabled = false;
  const wall = w2.spawnEnemy('charger', 8, 360, {});
  makeUnkillable(wall);
  w2.player.x = CANVAS.w - 200;
  w2.player.y = 360;
  let maxSpeed = 0;
  let telegraphX = 0;
  for (let i = 0; i < Math.round(14 / FIXED_DT); i++) {
    step(w2, FIXED_DT);
    if (wall.state.phase === 1) telegraphX = wall.x;
    maxSpeed = Math.max(maxSpeed, Math.hypot(wall.vx, wall.vy));
    if (wall.state.phase === 3) break;
  }
  console.log(`   벽에서 시작 · 예고 위치 x=${telegraphX.toFixed(0)} · 최고 속도 ${maxSpeed.toFixed(0)}`);
  check('벽에서 떨어진 뒤에 예고한다', telegraphX > wall.radius + ENEMY_PARAMS.charger.wallClearance - 1, `x=${telegraphX.toFixed(0)}`);
  check('벽에 붙어 있어도 실제로 돌진한다', maxSpeed > ENEMY_PARAMS.charger.dashSpeed * 0.9, `${maxSpeed.toFixed(0)}`);
}

console.log('10-4-9) 회전 궤도는 항상 켜져 있고 겹치지 않는가');
{
  const w = new World(emptySave(), stillInput, 9393);
  w.spawner.enabled = false;
  const slot = makeSlot('orbit', 1);
  w.player.attacks[0] = slot;

  const orbCount = (): number => w.projectiles.filter((p) => p.kind === 'orbit' && !p.dead).length;
  const want = (l: number): number => Math.round(SKILLS.orbit.count + SKILLS.orbit.countPerLevel * (l - 1));

  step(w, 0.1);
  check('고르는 즉시 구체가 돈다', orbCount() === want(1), `${orbCount()}`);

  // 예전에는 쿨(6초)이 지속시간(5초)보다 짧아지면 겹쳐 쌓였습니다
  step(w, 30);
  console.log(`   30초 뒤 구체 ${orbCount()}개 (기대 ${want(1)}개)`);
  check('오래 둬도 겹쳐 쌓이지 않는다', orbCount() === want(1), `${orbCount()}`);

  // 레벨이 오르면 그 자리에서 개수만 늘어납니다
  slot.level = 3;
  step(w, 0.1);
  console.log(`   Lv.3 구체 ${orbCount()}개 (기대 ${want(3)}개)`);
  check('레벨업하면 개수가 맞춰진다', orbCount() === want(3), `${orbCount()}`);

  // 공격력이 오르면 돌고 있던 구체에도 반영됩니다
  const beforeDamage = w.projectiles.find((p) => p.kind === 'orbit')?.damage ?? 0;
  w.player.stats.attack *= 2;
  step(w, 0.1);
  const afterDamage = w.projectiles.find((p) => p.kind === 'orbit')?.damage ?? 0;
  check('공격력 변화가 구체에 반영된다', afterDamage > beforeDamage * 1.9, `${beforeDamage} → ${afterDamage}`);
}

console.log('10-4-10) 레벨업 선택지에 업그레이드가 확정으로 끼지 않는가');
{
  // 공격 스킬 하나만 가진 상태에서 뽑습니다. 칸이 남아 있으므로 새 스킬이 나올 수 있어야 합니다
  let rollsWithUpgrade = 0;
  const rolls = 400;
  for (let n = 0; n < rolls; n++) {
    const w = new World(emptySave(), stillInput, 20000 + n);
    w.spawner.enabled = false;
    const first = generateSkillChoices(w).filter((c) => !c.upgrade && getSkillDef(c.id).kind === 'attack');
    if (first.length) applySkillChoice(w, first[0]);
    if (generateSkillChoices(w).some((c) => c.upgrade)) rollsWithUpgrade++;
  }
  const ratio = rollsWithUpgrade / rolls;
  console.log(`   업그레이드가 섞인 판 ${(ratio * 100).toFixed(1)}% (설정 ${(LEVEL.upgradeOfferChance * 100).toFixed(0)}%)`);
  check('설정한 확률과 맞는다', Math.abs(ratio - LEVEL.upgradeOfferChance) < 0.08, `${(ratio * 100).toFixed(1)}%`);
}

console.log('10-4-11) 정예 고유 능력 (바보 · 분열 · 장판 · 소환 · 방패 · 자폭 · 겁쟁이)');
{
  // 바보: 일반은 튕길 때 한 발, 정예는 **같은 탄을** 세 발
  const foolSpeed: Record<string, number> = {};
  for (const [label, elite, want] of [
    ['일반', false, ENEMY_PARAMS.fool.bulletCount],
    ['정예', true, ENEMY_PARAMS.fool.eliteBulletCount],
  ] as const) {
    const w = new World(emptySave(), stillInput, 11001);
    w.spawner.enabled = false;
    const f = w.spawnEnemy('fool', 60, 360, { elite });
    makeUnkillable(f);
    f.state.flag = true;
    f.state.angle = Math.PI; // 왼쪽 벽으로 직진
    w.player.x = 800;
    w.player.y = 360;
    step(w, 2);
    const shots = w.projectiles.filter((p) => !p.friendly);
    const speed = shots.length ? Math.hypot(shots[0].vx, shots[0].vy) : 0;
    foolSpeed[label] = speed;
    console.log(`   바보 ${label} · 튕길 때 ${shots.length}발 · 탄속 ${speed.toFixed(0)}`);
    check(`바보 ${label}은 ${want}발 쏜다`, shots.length === want, `${shots.length}발`);
  }
  check(
    '정예 바보적도 탄속은 일반과 같다',
    Math.abs(foolSpeed['정예'] - foolSpeed['일반']) < 0.01,
    `${foolSpeed['정예'].toFixed(0)} vs ${foolSpeed['일반'].toFixed(0)}`,
  );

  // 예고 없이 벽에서 쏘는 탄이, 2초 조준선을 그리고 쏘는 탄보다 빠르면 예고가 의미를 잃습니다.
  // 정예 원거리적의 탄속은 값으로 짐작하지 않고 실제로 쏘게 해서 잽니다
  {
    const w = new World(emptySave(), stillInput, 11009);
    w.spawner.enabled = false;
    w.spawnEnemy('ranged', 900, 360, { elite: true });
    w.player.x = 640;
    w.player.y = 360;
    // 한 번에 길게 돌리면 탄이 플레이어에 맞고 사라진 뒤를 보게 됩니다.
    // 잘게 밟으면서 처음 날아온 탄을 잡습니다
    let rangedSpeed = 0;
    for (let i = 0; i < 80 && rangedSpeed === 0; i++) {
      step(w, 0.05);
      w.player.invuln = 1; // 맞아서 죽으면 그 뒤가 안 돕니다
      const shot = w.projectiles.find((p) => !p.friendly);
      if (shot) rangedSpeed = Math.hypot(shot.vx, shot.vy);
    }
    console.log(`   정예 원거리 탄속 ${rangedSpeed.toFixed(0)} · 정예 바보 탄속 ${foolSpeed['정예'].toFixed(0)}`);
    check('정예 원거리적이 실제로 쐈다', rangedSpeed > 0);
    check('정예 바보적 탄이 정예 원거리적 탄보다 느리다', foolSpeed['정예'] < rangedSpeed, `${foolSpeed['정예'].toFixed(0)} vs ${rangedSpeed.toFixed(0)}`);
  }

  // 분열: 정예만 손자까지 나뉩니다 (1 → 3 → 9)
  for (const [label, elite, want] of [
    ['일반', false, 3],
    ['정예', true, 9],
  ] as const) {
    const w = new World(emptySave(), stillInput, 11002);
    w.spawner.enabled = false;
    const s = w.spawnEnemy('splitter', 640, 360, { elite });
    w.killEnemy(s);
    const gen1 = w.enemies.filter((o) => !o.dead);
    for (const c of [...gen1]) w.killEnemy(c);
    const gen2 = w.enemies.filter((o) => !o.dead);
    console.log(`   분열 ${label} · 1세대 ${gen1.length} → 2세대 ${gen2.length}`);
    check(`분열 ${label}은 2세대가 ${want === 9 ? 9 : 0}마리다`, gen2.length === (want === 9 ? 9 : 0), `${gen2.length}`);
  }

  // 장판: 정예는 두 배 넓고 1초 뒤부터 아픕니다
  {
    const w = new World(emptySave(), stillInput, 11003);
    w.spawner.enabled = false;
    const plain = w.spawnEnemy('puddle', 300, 200, {});
    const elite = w.spawnEnemy('puddle', 900, 600, { elite: true });
    w.killEnemy(plain);
    w.killEnemy(elite);
    const [hp1, hp2] = w.hazards;
    console.log(`   장판 일반 반경 ${hp1.radius.toFixed(0)} 피해 ${hp1.tickDamage.toFixed(0)} · 정예 반경 ${hp2.radius.toFixed(0)} 피해 ${hp2.tickDamage.toFixed(1)}`);
    check('일반 장판은 피해가 없다', hp1.tickDamage === 0);
    check('정예 장판은 두 배 넓다', Math.abs(hp2.radius / hp1.radius - 2) < 1e-6);
    check('정예 장판은 피해가 있다', hp2.tickDamage > 0);
    check('정예 장판은 덜 느려진다', hp2.slow > hp1.slow, `${hp2.slow} vs ${hp1.slow}`);

    // 1초 유예 동안에는 안 아프고, 그 뒤로 0.5초마다 아픕니다
    w.player.x = 900;
    w.player.y = 600;
    const before = w.player.hp;
    step(w, ENEMY_PARAMS.puddle.hazardArm - 0.15, false);
    check('유예 동안에는 안 아프다', w.player.hp === before, `${before} → ${w.player.hp}`);
    step(w, 1.2, false);
    console.log(`   정예 장판 위 1.2초 · 체력 ${before.toFixed(0)} → ${w.player.hp.toFixed(0)}`);
    check('유예가 끝나면 아프다', w.player.hp < before);
  }

  // 소환: 하수인은 잡을 수 있지만 보상이 없고, 보상은 전부 본체 쪽에 있습니다
  {
    const w = new World(emptySave(), stillInput, 11004);
    w.spawner.enabled = false;
    const src = w.spawnEnemy('summoner', 640, 360, {});
    makeUnkillable(src);
    w.player.x = 200;
    w.player.y = 200;

    // 상한까지 채우려면 소환 간격 x 상한 만큼 돌려야 합니다
    step(w, ENEMY_PARAMS.summoner.summonInterval * (ENEMY_PARAMS.summoner.maxMinions + 2) + 1);
    const minions = w.enemies.filter((o) => !o.dead && o.ownerId === src.id);
    const kinds = new Set(minions.map((o) => o.defId));
    console.log(`   하수인 ${minions.length}마리 · 종류 ${[...kinds].join(', ') || '없음'}`);

    check('하수인을 실제로 부른다', minions.length > 0);
    check('상한을 넘지 않는다', minions.length <= ENEMY_PARAMS.summoner.maxMinions, `${minions.length}마리`);
    // 종류가 섞이면 무엇을 상대하는지 알 수 없습니다. 스폰 때 정해진 하나로 고정입니다
    check('한 종류만 부른다', kinds.size === 1, [...kinds].join(','));
    check(
      '부르는 종류는 표 안에서 나온다',
      [...kinds].every((k) => (ENEMY_PARAMS.summoner.minionPool as readonly string[]).includes(k)),
    );
    // 이제 하수인도 평범하게 맞고 죽습니다. 무적도 타겟 불가도 없습니다
    check('하수인은 무적이 아니다', minions.every((o) => !o.immortal));
    check('하수인도 타겟이 된다', minions.every((o) => o.targetable));

    // 다만 잡아도 아무것도 안 나옵니다. 5초마다 무한히 다시 채워지는 적이라
    // 보상을 붙이면 소환적 하나를 방치하는 것이 무한 경험치 공급이 됩니다
    {
      const victim = minions[0];
      const k0 = w.stats.kills;
      const xp0 = w.player.xp;
      const c0 = w.coins.length;
      w.damageEnemy(victim, victim.maxHp * 10);
      console.log(
        `   하수인 직접 처치 · 죽음 ${victim.dead} · 처치 ${k0} → ${w.stats.kills} · 경험치 ${xp0} → ${w.player.xp} · 코인 ${c0} → ${w.coins.length}`,
      );
      check('하수인은 피해를 받고 죽는다', victim.dead);
      check('하수인 처치는 처치로 안 세어진다', w.stats.kills === k0, `${k0} → ${w.stats.kills}`);
      check('하수인 처치는 경험치를 안 준다', w.player.xp === xp0, `${xp0} → ${w.player.xp}`);
      check('하수인 처치는 코인을 안 준다', w.coins.length === c0, `${c0} → ${w.coins.length}`);
    }

    // 본체를 잡으면 남은 하수인이 전부 사라지고, 그 수만큼 코인이 떨어집니다.
    // 이것이 소환적의 보상 전부라, 하수인을 치우고 다니면 그만큼 몫이 줄어듭니다.
    //
    // 하수인 수를 손으로 맞춥니다. 자연히 불리게 두면 그동안 기본공격이 하수인을
    // 잡아버려서 몇 마리가 남아 있었는지가 판마다 달라집니다
    {
      const wk = new World(emptySave(), stillInput, 11005);
      wk.spawner.enabled = false;
      wk.player.x = 60;
      wk.player.y = 60;
      const host = wk.spawnEnemy('summoner', 1200, 660, {});
      const want = ENEMY_PARAMS.summoner.maxMinions;
      for (let i = 0; i < want; i++) wk.spawnEnemy('fool', 1200 + i * 10, 660, { ownerId: host.id });

      const killsBefore = wk.stats.kills;
      const coinsBefore = wk.coins.length;
      wk.damageEnemy(host, host.maxHp * 10);
      const left = wk.enemies.filter((o) => !o.dead && o.ownerId === host.id).length;
      const gained = wk.coins.length - coinsBefore;
      const per = ENEMY_PARAMS.summoner.minionCoinPerAlive;
      console.log(
        `   본체 처치 · 하수인 ${want}마리 → ${left}마리 · 코인 +${gained} (기대 ${want * per} 이상) · 처치 수 ${killsBefore} → ${wk.stats.kills}`,
      );
      check('본체를 잡으면 하수인이 전부 사라진다', left === 0);
      check('하수인 소멸은 처치로 안 세어진다', wk.stats.kills === killsBefore + 1, `${killsBefore} → ${wk.stats.kills}`);
      // 소환적 자신의 코인 드랍(7% 확률)이 섞일 수 있어 하한으로 잽니다
      check('살아 있던 하수인 수만큼 코인이 떨어진다', gained >= want * per, `${want}마리 → +${gained}개`);
    }

    // 하수인은 화면의 적 상한에 안 셉니다. 세면 소환적 넷이 상한의 4분의 1을
    // 판이 끝날 때까지 붙들고 있어 후반에 다른 적이 안 나옵니다
    const wc = new World(emptySave(), stillInput, 11006);
    wc.spawner.enabled = false;
    const host = wc.spawnEnemy('summoner', 640, 360, {});
    makeUnkillable(host);
    wc.player.x = 200;
    wc.player.y = 200;
    const countedBefore = wc.countedAlive();
    step(wc, ENEMY_PARAMS.summoner.summonInterval * (ENEMY_PARAMS.summoner.maxMinions + 2) + 1);
    const born = wc.enemies.filter((o) => !o.dead && o.ownerId === host.id).length;
    console.log(`   하수인 ${born}마리 · 상한에 세어지는 적 ${countedBefore} → ${wc.countedAlive()}`);
    check('하수인은 화면의 적 상한에 안 세어진다', born > 0 && wc.countedAlive() === countedBefore, `${wc.countedAlive()} vs ${countedBefore}`);
    check('하수인이 실제 목록에는 들어 있다', wc.enemies.filter((o) => !o.dead).length > wc.countedAlive());

    const w2 = new World(emptySave(), stillInput, 11005);
    w2.spawner.enabled = false;
    const eliteSrc = w2.spawnEnemy('summoner', 640, 360, { elite: true });
    makeUnkillable(eliteSrc);
    w2.player.x = 640;
    w2.player.y = 360;
    step(w2, ENEMY_PARAMS.summoner.summonInterval + 0.2);
    const eliteMinions = w2.enemies.filter((o) => !o.dead && o.ownerId === eliteSrc.id);
    console.log(`   정예 소환 → 하수인 ${eliteMinions.length}마리 · 정예 ${eliteMinions.filter((o) => o.elite).length}마리`);
    check('정예 소환적의 하수인은 정예다', eliteMinions.length > 0 && eliteMinions.every((o) => o.elite));
  }

  // 미라: 첫 죽음은 죽음이 아니고, 되살아난 뒤에는 스스로 무너집니다
  {
    const w = new World(emptySave(), stillInput, 11007);
    w.spawner.enabled = false;
    const m = w.spawnEnemy('mummy', 400, 300, {});
    w.player.x = 1200;
    w.player.y = 700;
    const baseHp = m.maxHp;
    const baseDmg = m.damage;
    const baseSpeed = m.speed;

    const killsBefore = w.stats.kills;
    w.damageEnemy(m, baseHp * 5);
    console.log(`   미라 첫 죽음 · dead=${m.dead} · 쓰러짐 ${m.downed.toFixed(1)}초`);
    check('첫 죽음에는 안 죽는다', !m.dead && m.downed > 0);
    check('쓰러진 동안은 처치로 안 세어진다', w.stats.kills === killsBefore);
    check('쓰러진 동안은 타겟이 안 된다', !m.targetable);
    const downedHp = m.hp;
    w.damageEnemy(m, 9999);
    check('쓰러진 동안은 피해를 안 받는다', m.hp === downedHp && !m.dead);

    step(w, ENEMY_PARAMS.mummy.reviveDelay + 0.2, false);
    console.log(
      `   부활 · 체력 ${baseHp.toFixed(0)} → ${m.maxHp.toFixed(0)} · 공격력 ${baseDmg.toFixed(1)} → ${m.damage.toFixed(1)}` +
        ` · 속도 ${baseSpeed.toFixed(0)} → ${m.speed.toFixed(0)}`,
    );
    check('되살아난다', !m.dead && m.revived && m.downed === 0);
    check('체력이 3배가 된다', Math.abs(m.maxHp / baseHp - ENEMY_PARAMS.mummy.hpMul) < 1e-6);
    check('공격력이 2배가 된다', Math.abs(m.damage / baseDmg - ENEMY_PARAMS.mummy.damageMul) < 1e-6);
    check('이동속도가 1.5배로 시작한다', m.speed > baseSpeed * 1.4, `${m.speed.toFixed(0)} vs ${baseSpeed.toFixed(0)}`);

    // 속도는 5초에 걸쳐 원래대로 돌아옵니다
    step(w, 5.2, false);
    console.log(`   5초 뒤 속도 ${m.speed.toFixed(0)} (원래 ${baseSpeed.toFixed(0)})`);
    check('속도가 원래대로 돌아온다', Math.abs(m.speed - baseSpeed) < 1, `${m.speed.toFixed(1)}`);

    // 매초 최대 체력의 20% 씩 빠지므로 가만히 둬도 5초면 무너집니다
    const w3 = new World(emptySave(), stillInput, 11008);
    w3.spawner.enabled = false;
    const m3 = w3.spawnEnemy('mummy', 400, 300, {});
    w3.player.x = 1300;
    w3.player.y = 750;
    w3.damageEnemy(m3, m3.maxHp * 5);
    step(w3, ENEMY_PARAMS.mummy.reviveDelay + 0.1, false);
    const reviveAt = w3.time;
    let gone = 0;
    for (let i = 0; i < 800 && gone === 0; i++) {
      step(w3, 0.05, false);
      if (m3.dead) gone = w3.time - reviveAt;
    }
    const expect = 1 / ENEMY_PARAMS.mummy.hpDrainPerSec;
    console.log(`   스스로 무너지기까지 ${gone.toFixed(1)}초 (예상 ${expect.toFixed(1)}초)`);
    check('가만히 둬도 스스로 무너진다', gone > 0 && Math.abs(gone - expect) < 1.0, `${gone.toFixed(1)}초`);
    check('두 번째 죽음은 진짜다', m3.dead && m3.revived);

    // 정예는 절반 만에 일어납니다
    const w4 = new World(emptySave(), stillInput, 11009);
    w4.spawner.enabled = false;
    const m4 = w4.spawnEnemy('mummy', 400, 300, { elite: true });
    w4.player.x = 1300;
    w4.player.y = 750;
    w4.damageEnemy(m4, m4.maxHp * 5);
    console.log(`   정예 미라 부활 대기 ${m4.downed.toFixed(2)}초 (일반 ${ENEMY_PARAMS.mummy.reviveDelay})`);
    check('정예는 절반 만에 일어난다', Math.abs(m4.downed - ENEMY_PARAMS.mummy.reviveDelay * 0.5) < 1e-6);
  }

  // 은신: 가까이 와야 드러나고, 정예는 절반 거리까지 붙어야 보입니다
  {
    const w = new World(emptySave(), stillInput, 11010);
    w.spawner.enabled = false;
    const R = ENEMY_PARAMS.stealth.revealRange;
    const plain = w.spawnEnemy('stealth', 400, 300, {});
    const elite = w.spawnEnemy('stealth', 400, 700, { elite: true });

    // 둘 다 사거리 밖
    w.player.x = 400 + R + 80;
    w.player.y = 300;
    step(w, 0.05, false);
    check('멀면 안 보인다', !plain.targetable && plain.alpha < 1);

    // 일반은 보이지만 정예는 아직 안 보이는 거리
    w.player.x = 400 + R * 0.8;
    w.player.y = 300;
    step(w, 0.05, false);
    const seenPlain = plain.targetable;
    w.player.x = 400 + R * 0.8;
    w.player.y = 700;
    step(w, 0.05, false);
    const seenElite = elite.targetable;
    console.log(`   거리 ${(R * 0.8).toFixed(0)} · 일반 ${seenPlain ? '보임' : '안 보임'} · 정예 ${seenElite ? '보임' : '안 보임'}`);
    check('가까우면 드러난다', seenPlain);
    check('정예는 같은 거리에서 아직 안 보인다', !seenElite);

    // 정예도 절반 거리 안이면 보입니다
    w.player.x = 400 + R * 0.4;
    w.player.y = 700;
    step(w, 0.05, false);
    check('정예도 절반 거리에서는 드러난다', elite.targetable);
  }

  // 돌진: 예고 통로가 실제로 멈추는 지점까지만 그어집니다
  {
    const w = new World(emptySave(), stillInput, 11011);
    w.spawner.enabled = false;
    const c = w.spawnEnemy('charger', 300, 360, {});
    makeUnkillable(c);
    // 오른쪽으로 돌진하게 세웁니다
    w.player.x = 1200;
    w.player.y = 360;
    let line = w.telegraphs.find((t) => t.kind === 'line' && t.owner === c.id);
    for (let i = 0; i < 400 && !line; i++) {
      step(w, 0.05, false);
      line = w.telegraphs.find((t) => t.kind === 'line' && t.owner === c.id);
    }
    if (!line) {
      check('돌진 예고 통로가 그어진다', false);
    } else {
      const len = Math.hypot(line.x2 - line.x, line.y2 - line.y);
      const diag = Math.hypot(CANVAS.w, CANVAS.h);
      console.log(`   통로 길이 ${len.toFixed(0)}px · 화면 대각선 ${diag.toFixed(0)}px`);
      // 화면 밖까지 긋던 시절에는 보이는 통로가 실제보다 훨씬 빨리 꽉 차 보였습니다
      check('통로가 화면 밖까지 뻗지 않는다', len < diag * 0.95, `${len.toFixed(0)}px`);
      check(
        '통로 끝이 경기장 안이다',
        line.x2 <= CANVAS.w + 1 && line.x2 >= -1 && line.y2 <= CANVAS.h + 1 && line.y2 >= -1,
        `(${line.x2.toFixed(0)}, ${line.y2.toFixed(0)})`,
      );
    }

    // 돌진하는 동안은 기절도 감속도 안 걸립니다
    let dashing = false;
    for (let i = 0; i < 400 && !dashing; i++) {
      step(w, 0.05, false);
      dashing = c.statusImmune;
    }
    console.log(`   돌진 중 statusImmune=${c.statusImmune}`);
    check('돌진 중에는 면역이 켜진다', dashing);
    w.stunEnemy(c, 2);
    w.slowEnemy(c, 0.3, 2);
    check('돌진 중에는 기절이 안 걸린다', c.stun === 0);
    check('돌진 중에는 감속이 안 걸린다', c.slow === 1);
  }

  // 방패: 정예는 내구도가 크고, 방패가 있을 때 덜 아프고 깨진 뒤 더 아픕니다
  {
    const w = new World(emptySave(), stillInput, 11006);
    w.spawner.enabled = false;
    const plain = w.spawnEnemy('shield', 300, 200, {});
    const elite = w.spawnEnemy('shield', 900, 600, { elite: true });
    console.log(`   방패 일반 ${plain.shieldMax.toFixed(0)}/${plain.maxHp.toFixed(0)} · 정예 ${elite.shieldMax.toFixed(0)}/${elite.maxHp.toFixed(0)}`);
    check('정예 방패는 체력의 1.2배다', Math.abs(elite.shieldMax / elite.maxHp - 1.2) < 1e-6);

    // 방패가 있는 동안은 절반만 들어갑니다 (관통 계열로 방패를 우회해서 잽니다)
    const hpBefore = elite.hp;
    w.damageEnemy(elite, 20, { ignoreShield: true });
    const shielded = hpBefore - elite.hp;
    elite.shieldHp = 0;
    const midHp = elite.hp;
    w.damageEnemy(elite, 20, { ignoreShield: true });
    const broken = midHp - elite.hp;
    console.log(`   정예 방패 · 방패 있을 때 ${shielded.toFixed(0)} · 깨진 뒤 ${broken.toFixed(0)} (원본 20)`);
    check('방패가 있으면 절반만 아프다', Math.abs(shielded - 10) < 1e-6, `${shielded}`);
    check('방패가 깨지면 더 아프다', Math.abs(broken - 24) < 1e-6, `${broken}`);
  }

  // 자폭: 정예 시체 폭발은 절반 시간에 1.5배 범위로 터집니다
  {
    const w = new World(emptySave(), stillInput, 11007);
    w.spawner.enabled = false;
    const plain = w.spawnEnemy('bomber', 300, 200, {});
    const elite = w.spawnEnemy('bomber', 900, 600, { elite: true });
    w.player.x = 200;
    w.player.y = 700;
    w.killEnemy(plain);
    w.killEnemy(elite);
    const [b1, b2] = w.pendingBlasts;
    console.log(`   자폭 일반 ${b1.delay.toFixed(1)}초/${b1.radius.toFixed(0)} · 정예 ${b2.delay.toFixed(1)}초/${b2.radius.toFixed(0)}`);
    check('정예 시체는 절반 시간에 터진다', Math.abs(b2.delay / b1.delay - 0.5) < 1e-6);
    check('정예 폭발 범위는 1.5배다', Math.abs(b2.radius / b1.radius - 1.5) < 1e-6);
  }

  // 겁쟁이: 정예는 더 멀리서 알아채고 더 빠르게 달려듭니다
  {
    const P = ENEMY_PARAMS.coward;
    const w = new World(emptySave(), stillInput, 11008);
    w.spawner.enabled = false;
    const e = w.spawnEnemy('coward', 640, 360, { elite: true });
    makeUnkillable(e);
    // 일반 사거리 밖, 정예 사거리 안에 섭니다
    w.player.x = 640 + P.triggerRange * 1.25;
    w.player.y = 360;
    let maxSpeed = 0;
    for (let i = 0; i < Math.round(2 / FIXED_DT); i++) {
      step(w, FIXED_DT);
      maxSpeed = Math.max(maxSpeed, Math.hypot(e.vx, e.vy));
    }
    console.log(`   정예 겁쟁이 · 거리 ${(P.triggerRange * 1.25).toFixed(0)}px 에서 돌진 ${maxSpeed.toFixed(0)} (일반 ${P.dashSpeed})`);
    check('정예 겁쟁이는 더 멀리서 달려든다', maxSpeed > P.dashSpeed, `${maxSpeed.toFixed(0)}`);
    check('정예 겁쟁이 돌진은 1.5배다', Math.abs(maxSpeed - P.dashSpeed * 1.5) < 1, `${maxSpeed.toFixed(0)}`);
  }
}

console.log('10-4-11b) 정예 분열체는 코인을 안 주고, 죽은 돌진적의 예고는 사라지는가');
{
  // 정예 분열적은 1 → 3 → 9 라서 개체마다 확정 드랍을 주면 코인이 13개씩 쏟아집니다
  const w = new World(emptySave(), stillInput, 11009);
  w.spawner.enabled = false;
  const s = w.spawnEnemy('splitter', 640, 360, { elite: true });
  w.killEnemy(s);
  const afterFirst = w.coins.length;
  for (const c of [...w.enemies.filter((o) => !o.dead)]) w.killEnemy(c);
  for (const c of [...w.enemies.filter((o) => !o.dead)]) w.killEnemy(c);
  console.log(
    `   정예 분열 · 최초 처치 코인 ${afterFirst}개 · 전부 처치 뒤 ${w.coins.length}개 · 처치 수 ${w.stats.kills} · 도감 ${w.stats.killsByType.splitter ?? 0}`,
  );
  check('최초 처치에만 코인이 나온다', w.coins.length === afterFirst, `${afterFirst} → ${w.coins.length}`);
  // 정예 드랍이 확률이 된 뒤로는(2026-09-12) 0 개일 수도 있습니다. 여기서 재는 것은
  // "분열체가 코인을 안 준다"이지 정예가 몇 개를 주느냐가 아닙니다 (그쪽은 10-4-11c)
  check('한 마리가 주는 코인은 최대 하나다', afterFirst <= 1, `${afterFirst}`);

  // **분열체는 처치로 안 셉니다** (2026-09-09). 정예 분열적은 1 → 3 → 9 라서
  // 세면 한 마리가 13 처치가 되어 처치 수가 무엇을 뜻하는지 알 수 없게 됩니다
  check('분열체를 잡아도 처치는 한 번뿐이다', w.stats.kills === 1, `${w.stats.kills}`);
  check('도감의 종류별 처치도 한 번뿐이다', w.stats.killsByType.splitter === 1, `${w.stats.killsByType.splitter}`);
  // 잡는 노동에 대한 대가는 그대로입니다. 처치 수만 안 세는 것이지 보상이 사라진 것이 아닙니다
  check('분열체도 경험치는 준다', w.player.xp > 0, `${w.player.xp.toFixed(1)}`);

  // 차지 도중에 죽으면 경로 예고도 같이 사라집니다
  const w2 = new World(emptySave(), stillInput, 11010);
  w2.spawner.enabled = false;
  const c2 = w2.spawnEnemy('charger', 640, 360, {});
  makeUnkillable(c2);
  w2.player.x = 900;
  w2.player.y = 360;
  for (let i = 0; i < Math.round(6 / FIXED_DT) && c2.state.phase !== 1; i++) step(w2, FIXED_DT);
  const during = w2.telegraphs.filter((t) => !t.dead && t.kind === 'line').length;
  w2.killEnemy(c2);
  const after = w2.telegraphs.filter((t) => !t.dead && t.kind === 'line').length;
  console.log(`   돌진 예고 · 차지 중 ${during}개 → 처치 뒤 ${after}개`);
  check('차지 중에는 경로가 떠 있다', during > 0);
  check('처치하면 경로가 사라진다', after === 0, `${after}개`);
}

console.log('10-4-12) 군체왕: 잡몹에 비례해 강해지고 삼키고 분노하는가');
{
  const S = BOSS_SWARM;
  const w = new World(emptySave(), stillInput, 12002);
  w.spawner.enabled = false;
  const boss = w.spawnBoss('swarm');
  boss.y = 360; // 등장 연출 건너뛰기
  w.player.x = 200;
  w.player.y = 200;

  // 잡몹을 임계치 위로 깔아둡니다
  for (let i = 0; i < S.devourThreshold + 6; i++) {
    const a = (i / (S.devourThreshold + 6)) * Math.PI * 2;
    w.spawnEnemy('basic', boss.x + Math.cos(a) * 120, boss.y + Math.sin(a) * 120, {});
  }
  const before = w.enemies.filter((e) => !e.boss && !e.dead).length;
  step(w, S.devourInterval + S.devourTelegraph + 0.4);
  const after = w.enemies.filter((e) => !e.boss && !e.dead).length;
  console.log(`   잡몹 ${before} → ${after} (삼킴) · 남은 적탄 ${w.projectiles.filter((p) => !p.friendly).length}`);
  check('임계치를 넘으면 잡몹을 삼킨다', after < before, `${before} → ${after}`);

  // 체력 절반에서 한 번 무적 + 대량 소환
  const w2 = new World(emptySave(), stillInput, 12003);
  w2.spawner.enabled = false;
  const b2 = w2.spawnBoss('swarm');
  b2.y = 360;
  w2.player.x = 200;
  w2.player.y = 200;
  step(w2, 0.1);
  const minionsBefore = w2.enemies.filter((e) => !e.boss && !e.dead).length;
  b2.hp = b2.maxHp * (S.enrageHpRatio - 0.01);
  step(w2, 0.1);
  const minionsAfter = w2.enemies.filter((e) => !e.boss && !e.dead).length;
  console.log(`   분노 · 무적 ${b2.invuln.toFixed(1)}초 · 잡몹 ${minionsBefore} → ${minionsAfter}`);
  check('체력 절반에서 무적이 된다', b2.invuln > 0);
  check('분노하면 잡몹을 쏟아낸다', minionsAfter - minionsBefore >= S.enrageSummonCount);

  // 무적 동안에는 피해가 안 들어갑니다
  const hp = b2.hp;
  w2.damageEnemy(b2, 500);
  check('무적 동안에는 안 맞는다', b2.hp === hp);

  // 한 번만 발동합니다
  b2.invuln = 0;
  const minionsMid = w2.enemies.filter((e) => !e.boss && !e.dead).length;
  b2.hp = b2.maxHp * 0.2;
  step(w2, 0.1);
  const minionsEnd = w2.enemies.filter((e) => !e.boss && !e.dead).length;
  check('분노는 한 번뿐이다', minionsEnd - minionsMid < S.enrageSummonCount, `${minionsMid} → ${minionsEnd}`);
}

console.log('10-5) 보스 3종이 전부 도는가');
for (const id of ALL_BOSS_IDS) {
  const w = new World(emptySave(), input, 7070);
  w.spawner.enabled = false;
  const boss = w.spawnBoss(id);
  step(w, 25, true, true);

  const shots = w.projectiles.filter((p) => !p.friendly).length;
  console.log(
    `   ${boss.def.name.padEnd(7)} 체력 ${boss.maxHp.toFixed(0)} · 속도 ${boss.speed.toFixed(0)} · 남은 적탄 ${shots} · 잡몹 ${w.enemies.length - 1} · 예고폭발 ${w.pendingBlasts.length}`,
  );
  check(`${boss.def.name}: 좌표가 정상이다`, finite(boss.x, boss.y, boss.hp));
  check(`${boss.def.name}: 화면 안에 있다`, boss.x > -100 && boss.x < 1400 && boss.y > -100 && boss.y < 820);
  check(`${boss.def.name}: 사망 원인이 자기 자신으로 남는다`, killerOf(boss).id === id);
}
{
  // 등장할 때마다 종류가 돌아갑니다
  const order = [0, 1, 2, 3].map((i) => bossIdForSpawn(i));
  console.log(`   등장 순서 ${order.join(' → ')}`);
  check('보스 종류가 돌아가며 나온다', order[0] !== order[1] && order[1] !== order[2] && order[3] === order[0]);
}

console.log('11) 난이도 해금 시간 규칙');
{
  console.log(
    `   난이도 0 ${unlockTimeFor(0) / 60}분 · 2 ${unlockTimeFor(2) / 60}분 · 3 ${unlockTimeFor(3) / 60}분 · 9 ${unlockTimeFor(9) / 60}분`,
  );
  check('앞쪽 난이도는 15분', unlockTimeFor(0) === 900 && unlockTimeFor(2) === 900);
  check('3단계부터 30분', unlockTimeFor(3) === 1800 && unlockTimeFor(9) === 1800);

  // --- 클리어는 시계가 아니라 보스 처치입니다 (2026-09-10) ---
  //
  // 클리어 시간에 타이머가 멈추고 보스가 한 마리 나오며, **그 개체**를 잡아야 클리어입니다.
  // 앞 보스를 잡는 것으로는 안 됩니다. 잡으면 그때부터 타이머가 다시 흐릅니다
  {
    const save = emptySave();
    const w = new World(save, input, 1, 0);
    w.time = unlockTimeFor(0) - 1;
    step(w, 3);

    check('클리어 시간에 타이머가 멈춘다', Math.abs(w.time - unlockTimeFor(0)) < 1e-6, `${w.time.toFixed(2)}`);
    check('클리어 보스가 나온다', w.clearBossId !== 0, `${w.clearBossId}`);
    check('아직 클리어가 아니다', !w.cleared);

    // 앞 보스를 잡는 것으로는 안 됩니다
    const other = w.spawnBoss();
    w.killEnemy(other);
    check('다른 보스를 잡아도 클리어가 아니다', !w.cleared);

    // 시간만 채우고 끝내면 해금이 안 됩니다
    const timeOnly = emptySave();
    commitRun(timeOnly, w);
    check('시간만 채운 판은 해금이 안 된다', timeOnly.maxDifficulty === 0, `${timeOnly.maxDifficulty}`);

    const boss = w.enemies.find((e) => e.id === w.clearBossId)!;
    w.killEnemy(boss);
    check('그 보스를 잡으면 클리어', w.cleared);

    step(w, 5);
    check('클리어 뒤 타이머가 다시 흐른다', w.time > unlockTimeFor(0) + 4, `${w.time.toFixed(1)}`);

    commitRun(save, w);
    check('난이도 0 을 클리어하면 1 이 열린다', save.maxDifficulty === 1, `${save.maxDifficulty}`);
    check('저장에 클리어가 남는다', save.records.clearedByDifficulty['0'] === true);
  }
}

// ---------------------------------------------------------------------------
console.log('12) 죽는 연출: 파편이 잡몹만 데려가고 보상은 없는가');
{
  const w = new World(emptySave(), input, 7, 0);
  const p = w.player;

  // 플레이어 주위에 잡몹을 촘촘히 둘러 세웁니다. 파편이 어느 방향으로 날아가든 맞습니다
  for (let i = 0; i < 12; i++) {
    const a = (Math.PI * 2 * i) / 12;
    w.spawnEnemy('basic', p.x + Math.cos(a) * 60, p.y + Math.sin(a) * 60);
  }
  // 보스와 무적 개체도 사거리 안에 둡니다. 이 둘은 파편으로 죽으면 안 됩니다
  w.spawnBoss();
  const boss = w.enemies.find((e) => e.boss);
  if (boss) {
    boss.x = p.x + 70;
    boss.y = p.y;
  }
  w.spawnEnemy('fool', p.x - 70, p.y, { immortal: true });

  const before = {
    xp: p.xp,
    level: p.level,
    kills: w.stats.kills,
    coins: w.coins.length,
    enemies: w.enemies.length,
  };

  w.damagePlayer(99999, true, null);
  check('죽으면 게임오버가 선다', w.gameOver && !p.alive);
  check('파편이 생긴다', w.shards.length > 0, `${w.shards.length}개`);

  // 연출을 끝까지 돌립니다
  let frames = 0;
  while (!w.updateDeathBurst(FIXED_DT) && frames < 400) frames++;

  check('연출이 1초 안에 끝난다', w.deathTime >= 1 && w.deathTime < 1.1, `${w.deathTime.toFixed(2)}초`);
  check('파편이 잡몹을 데려갔다', w.shardKills > 0, `${w.shardKills}마리`);
  check('처치 수가 늘지 않는다', w.stats.kills === before.kills, `${before.kills} → ${w.stats.kills}`);
  check('경험치가 늘지 않는다', p.xp === before.xp && p.level === before.level);
  check('코인이 떨어지지 않는다', w.coins.length === before.coins, `${before.coins} → ${w.coins.length}`);
  check('보스는 파편으로 죽지 않는다', w.enemies.some((e) => e.boss));
  check('무적 개체는 파편으로 죽지 않는다', w.enemies.some((e) => e.immortal));
  check(
    '실제로 적이 줄었다',
    w.enemies.length < before.enemies,
    `${before.enemies} → ${w.enemies.length}`,
  );
  console.log(
    `   파편 ${w.shards.length}개 남음 · 데려간 잡몹 ${w.shardKills}마리 · 남은 적 ${w.enemies.length}마리`,
  );

  // 건너뛰기: 앞 구간에서는 안 먹고, 그 뒤에는 먹어야 합니다
  const w2 = new World(emptySave(), input, 8, 0);
  w2.damagePlayer(99999, true, null);
  check('연출 초반에는 건너뛰기가 안 먹는다', !w2.updateDeathBurst(FIXED_DT, true));
  let skipFrames = 0;
  while (w2.deathTime < 0.3 && skipFrames < 100) {
    w2.updateDeathBurst(FIXED_DT);
    skipFrames++;
  }
  check('0.25초가 지나면 건너뛴다', w2.updateDeathBurst(FIXED_DT, true), `${w2.deathTime.toFixed(2)}초`);
}

// ---------------------------------------------------------------------------
console.log('13) 보스가 겹쳐서 등장하는가 (못 잡으면 쌓입니다)');
{
  const w = new World(emptySave(), input, 11, 0);
  // 보스를 못 잡는 상황을 만듭니다. 예전에는 여기서 다음 보스가 영영 안 나왔습니다.
  //
  // **등장하는 보스를 전부** 못 잡게 해야 합니다. 첫 마리만 막아두면 판이 길어지면서
  // 플레이어가 세져서 두 번째부터는 잡아버리고, 그러면 쌓이는지를 볼 수가 없습니다.
  // (스킬 선택이 3레벨마다로 촘촘해지면서 실제로 이 시험이 깨졌습니다)
  const keepBossesAlive = (world: World) => {
    for (const e of world.enemies) if (e.boss && !e.dead) makeUnkillable(e);
  };
  w.spawnBoss();
  keepBossesAlive(w);
  check('보스 한 마리 등장', w.bossesAlive === 1, `${w.bossesAlive}`);

  // 등장 주기를 두 번 넘길 만큼 돌립니다
  step(w, 620, true, false, keepBossesAlive);
  const alive = w.enemies.filter((e) => e.boss).length;
  check('보스가 겹쳐서 두 마리 이상', alive >= 2, `${alive}마리`);
  check('bossesAlive 가 실제 수와 맞는다', w.bossesAlive === alive, `${w.bossesAlive} vs ${alive}`);

  // 상한을 넘지 않는지
  step(w, 1200, true, false, keepBossesAlive);
  const capped = w.enemies.filter((e) => e.boss).length;
  // **클리어 보스만 상한 밖에서 한 마리 더 나옵니다** (2026-09-10). 상한에 막혀
  // 안 나오면 잡을 대상이 없어서 판이 영영 안 끝납니다. 그 하나가 유일한 예외입니다
  check('동시 보스가 상한 + 클리어 보스 안에 있다', capped <= BOSS.maxAlive + 1, `${capped} > ${BOSS.maxAlive + 1}`);
  console.log(`   ${Math.round(w.time / 60)}분 시점 동시 보스 ${capped}마리 (상한 ${BOSS.maxAlive})`);

  // 한 마리를 잡으면 자리가 나야 합니다
  const victim = w.enemies.find((e) => e.boss);
  if (victim) w.killEnemy(victim);
  check('잡으면 살아있는 보스 수가 준다', w.bossesAlive === capped - 1, `${w.bossesAlive}`);
}

// ---------------------------------------------------------------------------
console.log('14) 스킬 선택 건너뛰기');
{
  const save = emptySave();
  // 4단계 총액이 5,550 코인이라 넉넉히 줍니다
  save.coins = 20000;
  check('건너뛰기는 처음에 0회', (save.perm.skip ?? 0) === 0);
  check('건너뛰기를 살 수 있다', buyPerm(save, SKIP_UPGRADE.key));
  check('산 만큼 판에 들어온다', new World(save, input, 3, 0).player.skips === 1);

  // 마지막 직전 단계까지는 횟수제입니다
  buyPerm(save, SKIP_UPGRADE.key);
  buyPerm(save, SKIP_UPGRADE.key);
  check('3단계는 3회', new World(save, input, 3, 0).player.skips === 3);

  // 건너뛰면 스킬이 안 늘고 횟수만 줍니다
  const w = new World(save, input, 3, 0);
  const before = ownedSlots(w.player).length;
  w.player.skips--;
  check('건너뛰면 스킬 수가 그대로', ownedSlots(w.player).length === before);
  check('건너뛴 만큼 횟수가 준다', w.player.skips === 2);

  // 마지막 단계는 무제한입니다
  check('무제한 단계를 살 수 있다', buyPerm(save, SKIP_UPGRADE.key));
  check('그 위로는 못 산다', !buyPerm(save, SKIP_UPGRADE.key), `${save.perm.skip}`);
  check('무제한으로 바뀐다', isSkipUnlimited(save));

  const wu = new World(save, input, 3, 0);
  check('판에 무제한으로 들어온다', wu.player.skips === Number.POSITIVE_INFINITY, `${wu.player.skips}`);
  // 스킬 선택이 오는 횟수만큼 써도 줄지 않아야 합니다
  let uses = 0;
  for (let lv = 2; lv <= 91; lv++) {
    if (!isSkillLevel(lv)) continue;
    uses++;
    wu.player.skips--;
  }
  check('무제한은 아무리 써도 안 준다', wu.player.skips === Number.POSITIVE_INFINITY, `${uses}회 사용`);

  // 횟수제로는 왜 부족한지 숫자로 남깁니다
  let choices = 0;
  for (let lv = 2; lv <= 45; lv++) {
    if (isSkillLevel(lv)) choices++;
  }
  const limited = SKIP_UPGRADE.unlimitedLevel - 1;
  check('횟수제만으로는 스킬 선택을 다 막을 수 없다', choices > limited, `${choices} vs ${limited}`);
  console.log(
    `   레벨 45 까지 스킬 선택 ${choices}회 · 횟수제 최대 ${limited}회 · ${SKIP_UPGRADE.unlimitedLevel}단계(${SKIP_UPGRADE.costs[SKIP_UPGRADE.unlimitedLevel - 1]} 코인)부터 무제한`,
  );
}

// ---------------------------------------------------------------------------
console.log('15) 업적');
{
  // 명세가 그대로 지켜지는지부터
  const ids = ACHIEVEMENTS.map((a) => a.id);
  check('id 가 겹치지 않는다', new Set(ids).size === ids.length);
  check('전부 단계가 하나 이상', ACHIEVEMENTS.every((a) => a.tiers.length > 0));
  check(
    '단계형은 목표가 오름차순',
    ACHIEVEMENTS.every((a) => a.tiers.every((t, i) => i === 0 || (t.goal ?? 0) > (a.tiers[i - 1].goal ?? 0))),
  );
  const hiddenDefs = ACHIEVEMENTS.filter((a) => a.hidden);
  check('히든은 최소 100 코인', hiddenDefs.every((a) => a.tiers.every((t) => t.coin >= 100)), `${hiddenDefs.length}개`);

  const total = ACHIEVEMENTS.reduce((s, a) => s + a.tiers.reduce((x, t) => x + t.coin, 0), 0);
  console.log(`   업적 ${ACHIEVEMENTS.length}개 (히든 ${hiddenDefs.length}개) · 보상 총액 ${total} 코인`);

  // 새 저장으로는 아무것도 안 열려야 합니다
  {
    const save = emptySave();
    const got = checkAchievements(save, null, false);
    check('새 저장은 아무것도 안 열린다', got.length === 0, `${got.length}개`);
    check('코인도 안 들어온다', save.coins === 0, `${save.coins}`);
  }

  // 난이도 클리어 업적은 저장의 클리어 기록을 그대로 읽습니다
  {
    const save = emptySave();
    save.records.clearedByDifficulty['0'] = true;
    save.records.clearedByDifficulty['1'] = true;
    const got = checkAchievements(save, null, false);
    const names = got.map((g) => g.id);
    check('난이도 0 클리어가 열린다', names.includes('clear0'), names.join(','));
    check('난이도 1 클리어가 열린다', names.includes('clear1'));
    check('안 깬 난이도는 안 열린다', !names.includes('clear2'));
    check('코인이 실제로 들어온다', save.coins === 40 + 60, `${save.coins}`);

    // 두 번 훑어도 또 주면 안 됩니다
    const again = checkAchievements(save, null, false);
    check('같은 업적을 두 번 주지 않는다', again.length === 0 && save.coins === 100, `${save.coins}`);
  }

  // 단계형은 한 번에 여러 단계가 열려도 코인을 전부 줍니다
  {
    const save = emptySave();
    save.records.totalKills = 600;
    const got = checkAchievements(save, null, false);
    const kills = got.find((g) => g.id === 'kills');
    check('누적 처치 3단계가 한 번에 열린다', save.achievements.kills === 3, `${save.achievements.kills}`);
    check('세 단계 코인을 전부 준다', kills?.coin === 20 + 40 + 70, `${kills?.coin}`);
    check('알림은 마지막 단계 하나만', got.filter((g) => g.id === 'kills').length === 1);
  }

  // 판 안에서 열리는 업적 (레벨 70)
  {
    const save = emptySave();
    const w = new World(save, input, 5, 0);
    w.player.level = 69;
    check('레벨 69 로는 안 열린다', !checkAchievements(save, w, false).some((g) => g.id === 'level70'));
    w.player.level = 70;
    const got = checkAchievements(save, w, false);
    check('폭주(레벨 70)가 열린다', got.some((g) => g.id === 'level70'), got.map((g) => g.id).join(','));
  }

  // 죽는 순간 파편 처치가 누적으로 쌓이고 그것으로 업적이 열립니다
  {
    const save = emptySave();
    const w = new World(save, input, 6, 0);
    const p = w.player;
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI * 2 * i) / 8;
      w.spawnEnemy('basic', p.x + Math.cos(a) * 55, p.y + Math.sin(a) * 55);
    }
    w.damagePlayer(99999, true, null);
    let frames = 0;
    while (!w.updateDeathBurst(FIXED_DT) && frames < 400) frames++;
    commitAchieveStats(save, w);
    check('파편 처치가 누적에 쌓인다', save.achieveStats.shardKills > 0, `${save.achieveStats.shardKills}`);
    const got = checkAchievements(save, w, true);
    check('자살전략이 열린다', got.some((g) => g.id === 'shard'), got.map((g) => g.id).join(','));
  }

  // 조건식이 없는 업적(코나미)은 스스로 열리지 않고 밖에서만 열립니다
  {
    const save = emptySave();
    checkAchievements(save, null, false);
    check('코나미는 저절로 안 열린다', !save.achievements.konami);
    const got = unlockDirect(save, 'konami');
    check('직접 열면 열린다', got.length === 1 && save.achievements.konami === 1);
    check('코나미 코인 100', save.coins === 100, `${save.coins}`);
    check('두 번 열리지 않는다', unlockDirect(save, 'konami').length === 0);
  }

  // 사슬 업적(난이도 클리어)은 화면에 다음 한 칸만 보입니다
  {
    const save = emptySave();
    const chainRows = (s: typeof save) => visibleAchievements(s).filter((a) => a.chain === 'clear');

    const first = chainRows(save);
    check('새 저장에는 난이도 클리어가 한 줄만 보인다', first.length === 1, `${first.length}줄`);
    check('사슬은 난이도 0 에서 시작한다', first[0]?.id === 'clear0', `${first[0]?.id}`);

    // 입문(-1)은 사슬 밖이라 항상 따로 보입니다. 해금 사슬이 0 에서 시작하므로
    // -1 을 안 깬 사람이 뒤쪽 난이도 업적을 통째로 못 보는 일이 없어야 합니다
    const introId = `clear${DIFFICULTY.min}`;
    const intro = ACHIEVEMENTS.find((a) => a.id === introId);
    check('입문 난이도는 사슬에 안 들어간다', !!intro && !intro.chain, `${intro?.chain}`);
    check('입문 난이도는 새 저장에도 보인다', visibleAchievements(save).some((a) => a.id === introId));

    // 입문을 건너뛴 채 0 과 1 을 깨도 다음 칸(2)이 제대로 나타납니다
    save.records.clearedByDifficulty['0'] = true;
    save.records.clearedByDifficulty['1'] = true;
    checkAchievements(save, null, false);
    const after = chainRows(save);
    check('깨면 다음 칸이 나타난다', after.length === 3, `${after.map((a) => a.id).join(',')}`);
    check('새로 나타난 칸은 난이도 2', after[2]?.id === 'clear2', `${after[2]?.id}`);
    check('입문을 건너뛰어도 뒤가 안 막힌다', visibleAchievements(save).some((a) => a.id === introId));

    // 사슬 밖 업적은 하나도 안 가립니다
    const shown = visibleAchievements(save);
    const outside = ACHIEVEMENTS.filter((a) => !a.chain).length;
    check('사슬 밖 업적은 전부 보인다', shown.filter((a) => !a.chain).length === outside);
    check('진행도 분모는 전체 그대로', achieveProgress(save).total === ACHIEVEMENTS.length);
  }

  // 뒤지게 빠르네: 화면에 뜬 적이 아니라 표 전체를 기준으로 잽니다
  {
    const save = emptySave();
    const w = new World(save, input, 4, 0);
    const top = fastestEnemySpeed();
    // 시간 강화도 난이도 배율도 안 들어갑니다. 표에 적힌 기본 이속만 봅니다
    const want = ENEMY_BASE.speed * ENEMY_TABLE.fast.speed * (ELITE_TRAITS.fast?.speedMul ?? 1);

    check('적이 하나도 없어도 기준이 잡힌다', w.enemies.length === 0 && top > 0, `${top}`);
    check('기준은 가장 빠른 적(정예 빠른적)', Math.abs(top - want) < 0.01, `${top} vs ${want}`);
    check('기본 이동속도로는 안 열린다', w.player.stats.moveSpeed < top * 1.2, `${w.player.stats.moveSpeed} vs ${top}`);

    // 돌진 같은 능력 속도(950)는 기준에 안 들어갑니다. 들어가면 달성이 불가능해집니다
    check('능력 속도는 기준이 아니다', top < ENEMY_PARAMS.charger.dashSpeed, `${top}`);

    w.player.stats.moveSpeed = top * 1.2;
    const got = checkAchievements(save, w, false);
    check('충분히 빨라지면 열린다', got.some((g) => g.id === 'outrun'), got.map((g) => g.id).join(','));
  }

  // 설정의 업적 초기화 (테스트용)
  {
    const save = emptySave();
    save.records.totalKills = 600;
    checkAchievements(save, null, false);
    const before = save.coins;
    check('지우기 전에는 열려 있다', save.achievements.kills === 3 && before > 0, `${before}`);

    save.achieveStats.shardKills = 7;
    resetAchievements(save);
    check('업적이 지워진다', Object.keys(save.achievements).length === 0);
    check('업적 누적값도 지워진다', save.achieveStats.shardKills === 0);
    check('코인은 남는다', save.coins === before, `${save.coins}`);
    check('기록은 안 건드린다', save.records.totalKills === 600);

    // 기록으로 판정되는 업적은 곧바로 다시 열립니다. 알림을 다시 보려고 만든 버튼입니다
    const again = checkAchievements(save, null, false);
    check('기록 기반 업적은 다시 열린다', again.some((g) => g.id === 'kills'), again.map((g) => g.id).join(','));
  }

  // 사인 수집가: 죽인 적이 종류별로 모입니다
  {
    const save = emptySave();
    const w = new World(save, input, 7, 0);
    w.killedBy = { id: 'basic', elite: false };
    commitAchieveStats(save, w);
    commitAchieveStats(save, w);
    check('같은 적은 한 번만 센다', save.achieveStats.deathCauses.length === 1, `${save.achieveStats.deathCauses}`);
  }
}

console.log('16) 저장 데이터가 낡거나 망가졌을 때');
{
  // `save.ts` 의 `knownSkills` 가 `SKILLS` 를 기준으로 거릅니다.
  // 그 표와 실제 스킬 등록부가 갈라지면 걸러내는 기준 자체가 틀어집니다
  const tableIds = Object.keys(SKILLS).sort().join(',');
  check('SKILLS 표와 스킬 등록부가 같은 목록이다', tableIds === [...ALL_SKILL_IDS].sort().join(','), tableIds);

  // 스킬 id 를 바꾸거나 없앤 뒤에 옛 저장을 여는 상황입니다.
  // 거르지 않으면 `getSkillDef` 가 undefined 를 돌려주고 `.kind` 에서 터지는데,
  // 그 자리가 판 시작과 상점 둘 다라 게임을 켤 수도 고칠 수도 없게 됩니다
  const stale = fromJSON({
    unlockedStartSkills: ['orbit', 'ghostBeam'],
    equippedStartSkills: ['ghostBeam'],
    records: { bestBuild: ['aura', 'ghostBeam'] },
  });
  check('없는 스킬은 걸러진다', stale.unlockedStartSkills.join(',') === 'orbit', stale.unlockedStartSkills.join(','));
  check('장착 목록도 걸러진다', stale.equippedStartSkills.length === 0, stale.equippedStartSkills.join(','));
  check('최고 기록 빌드도 걸러진다', stale.records.bestBuild.join(',') === 'aura', stale.records.bestBuild.join(','));

  // 걸러낸 뒤에는 실제로 판이 시작되어야 합니다
  let started = true;
  try {
    new World(stale, input, 3, 0);
  } catch {
    started = false;
  }
  check('그 저장으로도 판이 시작된다', started);

  // 개발자 모드는 기본이 꺼짐이어야 합니다. 켜져 있으면 디버그 · ?unlock · ?seed 가
  // 통째로 열린 채로 시작합니다
  check('새 저장은 개발자 모드가 꺼져 있다', emptySave().devMode === false);
  check('켜둔 값은 유지된다', fromJSON({ devMode: true }).devMode === true);
  check('boolean 이 아니면 꺼짐으로 본다', fromJSON({ devMode: 'yes' }).devMode === false);

  // 하드모드 해금. **난이도 0 부터 15 까지이고 입문(-1)은 안 셉니다**
  {
    const nothing = emptySave();
    check('아무것도 안 깼으면 잠겨 있다', !clearedAllFrom(nothing, 0));
    check('새 저장은 하드모드가 꺼져 있다', nothing.hardMode === false);

    const all = emptySave();
    for (let lv = 0; lv <= DIFFICULTY.max; lv++) all.records.clearedByDifficulty[String(lv)] = true;
    check('0~15 를 다 깨면 열린다', clearedAllFrom(all, 0));
    // 입문을 안 깼어도 열려야 합니다. 그게 이 조건의 전부입니다
    check('입문(-1)은 안 봐도 열린다', all.records.clearedByDifficulty['-1'] !== true);
    // 반대로 업적 "완주" 는 입문까지 봐야 합니다. 둘이 같아지면 구분한 의미가 없습니다
    check('업적 완주는 입문까지 봐야 한다', !clearedAllFrom(all, DIFFICULTY.min));

    const oneShort = emptySave();
    for (let lv = 0; lv < DIFFICULTY.max; lv++) oneShort.records.clearedByDifficulty[String(lv)] = true;
    check('한 단계라도 남으면 안 열린다', !clearedAllFrom(oneShort, 0));

    // **시간만 채운 것은 클리어가 아닙니다** (2026-09-10). 클리어 시간에 닿으면
    // 타이머가 멈추고 보스가 나오는데, 그 보스를 못 잡고 죽으면 기록만 남습니다
    const timeOnly = emptySave();
    for (let lv = 0; lv <= DIFFICULTY.max; lv++) timeOnly.records.bestTimeByDifficulty[String(lv)] = unlockTimeFor(lv);
    check('시간만 채운 것으로는 안 열린다', !clearedAllFrom(timeOnly, 0));

    check('하드모드 값은 저장에 남는다', fromJSON({ hardMode: true }).hardMode === true);
  }

  // 단계마다 이름이 다른 업적. **이름을 읽는 곳이 전부 `tierName` 을 거쳐야** 화면과
  // 알림이 같은 이름을 말합니다
  {
    const rich = ACHIEVEMENTS.find((a) => a.id === 'rich')!;
    check('부자는 세 단계다', rich.tiers.length === 3, `${rich.tiers.length}`);
    check('1단계는 부자', tierName(rich, 0) === '부자', tierName(rich, 0));
    check('2단계는 집주인', tierName(rich, 1) === '집주인', tierName(rich, 1));
    check('3단계는 땅주인', tierName(rich, 2) === '땅주인', tierName(rich, 2));

    // 단계 이름이 없는 업적은 업적 이름을 그대로 씁니다
    const kills = ACHIEVEMENTS.find((a) => a.id === 'kills')!;
    check('이름을 안 준 단계는 업적 이름', tierName(kills, 3) === kills.name, tierName(kills, 3));

    // 실제로 단계를 따면 알림에 그 단계 이름이 실립니다
    const save = emptySave();
    save.achieveStats.coinsEarned = 6000;
    const got = checkAchievements(save, null, false).filter((g) => g.id === 'rich');
    check('2단계를 따면 알림이 집주인이라고 말한다', got.length === 1 && got[0].name === '집주인', got.map((g) => g.name).join(','));
  }

  // 터치 입력. **조이스틱이 키보드를 갈아끼웁니다.** 더하면 둘을 같이 쥐었을 때
  // 속도가 두 배가 되는 자리가 생깁니다
  {
    const fake = { addEventListener: () => {} } as unknown as Window;
    const ti = new Input(fake);
    check('아무것도 안 하면 안 움직인다', ti.moveVector().x === 0 && ti.moveVector().y === 0);

    ti.setTouchVector({ x: 1, y: 0 });
    check('조이스틱 방향이 그대로 나온다', ti.moveVector().x === 1 && ti.moveVector().y === 0);

    // 잡은 채로 가만히 있는 것과 놓은 것은 다릅니다
    ti.setTouchVector({ x: 0, y: 0 });
    check('잡고 가만히 있으면 안 움직인다', ti.moveVector().x === 0);
    ti.setTouchVector(null);
    check('놓으면 키보드로 돌아온다', ti.moveVector().x === 0 && ti.moveVector().y === 0);

    // Q 버튼은 실제 키와 같은 길로 들어가야 `wasPressed` 한 곳만 보면 됩니다
    ti.pressVirtual('KeyQ');
    ti.beginStep();
    check('Q 버튼이 눌림으로 잡힌다', ti.wasPressed('KeyQ') && ti.isDown('KeyQ'));
    ti.beginStep();
    check('누른 것은 한 스텝만 새 눌림이다', !ti.wasPressed('KeyQ') && ti.isDown('KeyQ'));
    ti.releaseVirtual('KeyQ');
    check('떼면 풀린다', !ti.isDown('KeyQ'));

    // 판을 새로 시작하면 잡고 있던 것도 풀려야 합니다
    ti.setTouchVector({ x: 1, y: 1 });
    ti.clear();
    check('clear 하면 조이스틱도 놓입니다', ti.moveVector().x === 0 && ti.moveVector().y === 0);

    // **일시정지 버튼도 Q 와 같은 길입니다.** 폰에는 Esc 가 없어서 이것이 판을
    // 멈추는 유일한 길인데, `pauseRun` 을 직접 부르면 멈추는 길이 둘이 됩니다.
    // 누른 자리에서 곧바로 놓아야 다음에 누를 때도 "새 눌림"으로 잡힙니다
    ti.pressVirtual('Escape');
    ti.releaseVirtual('Escape');
    ti.beginStep();
    check('일시정지 버튼이 Esc 눌림으로 잡힌다', ti.wasPressed('Escape'));
    check('누르자마자 놓여 있다', !ti.isDown('Escape'));
    ti.pressVirtual('Escape');
    ti.releaseVirtual('Escape');
    ti.beginStep();
    check('두 번째도 새 눌림으로 잡힌다', ti.wasPressed('Escape'));
  }

  // 모바일 판별. **터치 여부만으로 가르면 터치 노트북에도 조이스틱이 붙습니다.**
  // 그리고 브라우저 전역이 있다고 가정하면 안 됩니다 (`navigator` 는 Node 20 에
  // 없어서 CI 만 터진 적이 있습니다)
  {
    check('브라우저 밖에서는 터치 기기가 아니다', !isTouchDevice());
    check('브라우저 밖에서는 모바일 배치가 아니다', !isMobileLayout());
  }

  // 모바일 HUD. **우상단은 일시정지 버튼 자리라 비워야 합니다.** 예전에는 처치·코인·
  // 적 세 줄이 거기 있어서 버튼과 정확히 겹쳤습니다.
  // 그리고 `난이도 N` 이 체력바(y 18~38) 위에 그대로 겹쳐 있었습니다
  {
    const w = new World(emptySave(), new Input({ addEventListener: () => {} } as unknown as Window), 1, 5);
    const texts: { s: string; x: number; y: number }[] = [];
    const rec = recordingRenderer(texts);

    drawHud(rec, w, true);
    const topRight = texts.filter((t) => t.x > CANVAS.w - 220 && t.y < 110);
    check('모바일은 우상단을 비운다', topRight.length === 0, topRight.map((t) => t.s).join(','));

    const diff = texts.find((t) => t.s.startsWith('난이도'));
    check('난이도가 체력바 아래로 내려갔다', !!diff && diff.y > 54, diff ? `y=${diff.y}` : '없음');
    check('모바일에도 처치·코인이 남아 있다', texts.some((t) => t.s.startsWith('처치')));

    // PC 는 지금 그대로여야 합니다. 우상단 세 줄이 그 자리에 있습니다
    const pc: { s: string; x: number; y: number }[] = [];
    drawHud(recordingRenderer(pc), w, false);
    check('PC 는 우상단에 처치·코인이 있다', pc.some((t) => t.s.startsWith('처치') && t.x > CANVAS.w - 220));
    const pcDiff = pc.find((t) => t.s.startsWith('난이도'));
    check('PC 도 난이도가 체력바를 안 가린다', !!pcDiff && pcDiff.y > 54, pcDiff ? `y=${pcDiff.y}` : '없음');

    console.log(
      `   HUD 글자 · 모바일 ${texts.length}개 (우상단 ${topRight.length}) · PC ${pc.length}개 · 난이도 y=${diff?.y}`,
    );
  }

  // **하드모드가 캔버스에서 바꾸는 것은 맨 처음 `clear` 한 줄뿐이어야 합니다**
  // (2026-09-07 사용자 지시).
  //
  // 경기장 **바깥**(좌우 정보 패널과 여백)은 붉어져도 되지만 **경기장 안은 안 됩니다.**
  // 예전에 화면 전체와 경기장 바닥에 각각 덧칠을 걸었다가 둘 다 되돌린 자리라,
  // 덧칠이 하나라도 다시 들어가면 여기서 잡힙니다.
  //
  // 색은 눈으로 볼 수밖에 없지만 **그리기 호출이 같은지는 잴 수 있습니다.**
  {
    const calls: string[] = [];
    const counting = new Proxy(recordingRenderer([]), {
      get(target, prop: string) {
        const v = (target as unknown as Record<string, unknown>)[prop];
        if (typeof v !== 'function') return v;
        return (...args: unknown[]) => {
          calls.push(`${prop}(${args.join(',')})`);
          return (v as (...a: unknown[]) => unknown)(...args);
        };
      },
    }) as unknown as Renderer;

    // **같은 판을 두 번 그립니다.** 저장의 hardMode 를 바꿔서 World 를 새로 만들면
    // 난이도까지 달라져서(하드 0 은 일반 15 의 장치를 들고 옵니다) 적 수가 달라지고,
    // 그러면 그리기 차이가 아니라 판 차이를 재게 됩니다
    const sv = emptySave();
    const w = new World(sv, input, 909, 0);
    for (let i = 0; i < 120; i++) w.update(FIXED_DT);

    // `World.hard` 는 판 시작에 굳는 값이라 저장을 바꿔도 안 따라옵니다.
    // 같은 판을 두 번 그려야 하므로 여기서만 직접 갈아끼웁니다
    const draw = (hard: boolean): string[] => {
      calls.length = 0;
      (w as unknown as { hard: boolean }).hard = hard;
      drawWorld(counting, w);
      return [...calls];
    };

    const plain = draw(false);
    const hard = draw(true);
    (w as unknown as { hard: boolean }).hard = false;
    check('그리기 호출 수가 같다', plain.length === hard.length, `${plain.length} vs ${hard.length}`);

    const differ = plain.map((c, i) => (c === hard[i] ? -1 : i)).filter((i) => i >= 0);
    check(
      '다른 것은 맨 처음 clear 한 줄뿐이다',
      differ.length === 1 && differ[0] === 0 && plain[0].startsWith('clear('),
      differ.map((i) => `${i}:${plain[i]} vs ${hard[i]}`).join(' / ') || '차이 없음',
    );

    // **경기장 바닥은 어느 쪽이든 같은 색이어야 합니다.** `clear` 바로 다음의
    // `rect(0,0,1280,720,...)` 이 그 자리이고, 여기가 갈리면 인게임이 붉어집니다
    const floor = (list: string[]): string | undefined => list.find((c) => c.startsWith('rect(0,0,1280,720'));
    check('경기장 바닥은 하드에서도 같다', !!floor(plain) && floor(plain) === floor(hard), `${floor(plain)} vs ${floor(hard)}`);
    check('바깥은 실제로 갈린다', plain[0] !== hard[0], `${plain[0]} vs ${hard[0]}`);

    // 메인 화면 배경도 같은 규칙입니다
    calls.length = 0;
    drawIdleBackground(counting, false);
    const idlePlain = [...calls];
    calls.length = 0;
    drawIdleBackground(counting, true);
    const idleHard = [...calls];
    check('메뉴 배경도 clear 하나만 다르다', idlePlain.length === idleHard.length && idlePlain.slice(1).join('|') === idleHard.slice(1).join('|'));
    check('메뉴 배경도 경기장 바닥은 같다', floor(idlePlain) === floor(idleHard), `${floor(idlePlain)}`);
    // **세 값이 한 벌입니다.** 캔버스 패널색(`PANEL_BG`)과 페이지 여백(`--bg`)이
    // 어긋나면 캔버스 가장자리에 띠가 다시 드러납니다. 색은 눈으로 볼 수밖에 없지만
    // **같은 값인지는 잴 수 있습니다.** 눈에 맡기면 한쪽만 고치는 날이 반드시 옵니다
    {
      const css = readFileSync('src/style.css', 'utf8');
      const bgOf = (selector: string): string => {
        const block = css.slice(css.indexOf(selector));
        const m = /--bg:\s*([^;]+);/.exec(block.slice(0, block.indexOf('}')));
        return m ? m[1].trim() : '없음';
      };
      check('일반 여백이 캔버스 패널색과 같다', bgOf(':root {') === PANEL_BG, `${bgOf(':root {')} vs ${PANEL_BG}`);
      check('하드 여백이 캔버스 패널색과 같다', bgOf('body.hard {') === PANEL_BG_HARD, `${bgOf('body.hard {')} vs ${PANEL_BG_HARD}`);
    }

    console.log(`   캔버스 그리기 ${plain.length}개 · 바깥 ${plain[0]} → ${hard[0]}`);
  }

  // 설정 기본값. **화면 흔들림은 절반에서 시작합니다.** 예전에 상수 하나로 쓰던
  // 세기와 같은 값이고, 더 원하는 사람만 전체로 올립니다
  const fresh = emptySave();
  check('흔들림 기본은 절반', SETTINGS.shake.levels[fresh.shakeLevel].name === '절반');
  check('파티클 기본은 전체', SETTINGS.particles.levels[fresh.particleLevel].name === '전체');
  check('자동 일시정지는 기본으로 켬', fresh.autoPause === true);

  // 단계 표가 줄어든 뒤에 옛 저장을 열어도 없는 자리를 가리키면 안 됩니다
  const bad = fromJSON({ shakeLevel: 99, particleLevel: -3, autoPause: false });
  check('범위를 벗어난 단계는 잘립니다', bad.shakeLevel === SETTINGS.shake.levels.length - 1 && bad.particleLevel === 0);
  check('자동 일시정지는 끈 값이 유지된다', bad.autoPause === false);

  // **파티클 설정이 판의 난수를 건드리면 안 됩니다.** 건드리면 시드를 고정해도
  // 설정마다 다른 판이 됩니다
  {
    const a = emptySave();
    a.particleLevel = 0;
    const b = emptySave();
    b.particleLevel = SETTINGS.particles.levels.length - 1;
    const wa = new World(a, input, 4242, 0);
    const wb = new World(b, input, 4242, 0);
    let maxParticlesA = 0;
    let maxParticlesB = 0;
    for (let i = 0; i < 600; i++) {
      wa.update(FIXED_DT);
      wb.update(FIXED_DT);
      maxParticlesA = Math.max(maxParticlesA, wa.effects.particles.length);
      maxParticlesB = Math.max(maxParticlesB, wb.effects.particles.length);
    }
    check(
      '파티클 설정이 달라도 같은 판이 나온다',
      wa.enemies.length === wb.enemies.length && wa.stats.kills === wb.stats.kills,
      `적 ${wa.enemies.length}/${wb.enemies.length} · 처치 ${wa.stats.kills}/${wb.stats.kills}`,
    );
    check('파티클을 끄면 실제로 안 뿌린다', maxParticlesA === 0, `${maxParticlesA}`);
    // **한 순간의 개수로 재면 안 됩니다.** 파티클은 금방 사라지므로 마지막 프레임에
    // 마침 하나도 없을 수 있고, 그러면 밸런스를 만질 때마다 이 시험이 뒤집힙니다
    check('전체면 뿌린다', maxParticlesB > 0, `${maxParticlesB}`);
  }

  // 배열이 아니거나 문자열이 아닌 것이 섞여 있어도 버팁니다
  const junk = fromJSON({ unlockedStartSkills: 'orbit', equippedStartSkills: [7, null, 'aura'] });
  check('배열이 아니면 빈 목록', junk.unlockedStartSkills.length === 0);
  check('문자열 아닌 값은 걸러진다', junk.equippedStartSkills.join(',') === 'aura', junk.equippedStartSkills.join(','));
}

// ---------------------------------------------------------------------------
// 17) 하드모드 상점 (2026-09-06)
//
// 여기서 지키는 것은 넷입니다.
//   - 하드를 안 연 사람에게 21단계가 새어 나가지 않는가
//   - 하드 25단계 값이 스탯 상한을 안 넘는가 (치명타가 정확히 걸립니다)
//   - 업적 "플렉스"의 목표치와 세는 쪽이 짝을 이루는가
//   - 무장 확장의 표가 실제 판과 맞는가
// ---------------------------------------------------------------------------
console.log('\n17) 하드모드 상점');
{
  // --- 스탯 21~25 단계 ---
  check('스탯 비용표가 하드 상한까지 있다', PERM_UPGRADES.every((u) => u.costs.length === PERM_HARD_MAX_LEVEL));

  {
    const locked = emptySave();
    const open = emptySave();
    open.hardUnlocked = true;
    locked.perm.hp = PERM_MAX_LEVEL;
    open.perm.hp = PERM_MAX_LEVEL;
    check('하드를 안 열면 20단계가 끝이다', permMaxLevel(locked, 'hp') === PERM_MAX_LEVEL);
    check('하드를 열면 25단계까지 간다', permMaxLevel(open, 'hp') === PERM_HARD_MAX_LEVEL);
    check('하드를 안 열면 21단계를 못 산다', permNextCost(locked, 'hp') === null);
    check('하드를 열면 21단계를 살 수 있다', permNextCost(open, 'hp') !== null);
  }

  {
    // 손댄 저장이 하드 단계를 들고 있어도 하드를 연 적 없으면 안 먹어야 합니다.
    // `save.perm` 은 값 검증이 없는 자유 맵이라 여기서 자르지 않으면 그대로 통과합니다
    const full: Record<string, number> = {};
    for (const u of PERM_UPGRADES) full[u.key] = PERM_HARD_MAX_LEVEL;
    const locked = createStats(full, false);
    const open = createStats(full, true);
    check(
      '하드를 안 열면 20단계까지만 먹는다',
      locked.maxHp === BASE_STATS.maxHp + 15 * PERM_MAX_LEVEL,
      `${locked.maxHp}`,
    );
    check(
      '하드 구간은 단계당 두 배로 오른다',
      open.maxHp === locked.maxHp + 30 * (PERM_HARD_MAX_LEVEL - PERM_MAX_LEVEL),
      `${open.maxHp}`,
    );

    // **상한을 넘으면 그 스탯이 레벨업 추첨에서 통째로 빠집니다.** 치명타가 여기 걸립니다
    for (const def of STAT_DEFS) {
      if (def.cap === undefined) continue;
      const up = PERM_UPGRADES.find((u) => u.stat === def.key);
      if (!up) continue;
      check(`${def.name} 25단계가 상한을 안 넘는다`, open[def.key] <= def.cap + 1e-9, `${open[def.key]} / ${def.cap}`);
    }
    check('치명타는 25단계에서 상한에 닿는다', Math.abs(open.critChance - 0.75) < 1e-9, `${open.critChance}`);
  }

  // 하드 구간 설명은 `desc` 끝의 상승량만 갈아끼웁니다. 형태가 안 맞으면 원본이 그대로
  // 나오면서 화면이 20단계 값을 계속 말하게 됩니다
  for (const up of PERM_UPGRADES) {
    check(`${up.name} 설명이 상승량으로 끝난다`, /\+[\d.]+%?$/.test(up.desc), up.desc);
  }

  // --- 업적 짝 맞추기 ---
  {
    const before = totalPurchasable();
    check('플렉스 목표는 156 (하드 제외)', before === 156, `${before}`);
    check('공급부족 목표가 더 크다', totalPurchasableAll() > before, `${totalPurchasableAll()}`);

    const s = emptySave();
    s.hardUnlocked = true;
    for (const u of PERM_UPGRADES) s.perm[u.key] = PERM_HARD_MAX_LEVEL;
    s.perm[XP_UPGRADE.key] = XP_UPGRADE.costs.length;
    check(
      '플렉스는 하드 구간을 안 센다',
      purchasedCount(s) === PERM_UPGRADES.length * PERM_MAX_LEVEL,
      `${purchasedCount(s)}`,
    );
    check('공급부족은 하드 구간을 센다', purchasedCountAll(s) > purchasedCount(s));
    check('플렉스는 하드 항목만으로 안 채워진다', purchasedCount(s) < totalPurchasable());
  }

  // --- 무장 확장 ---
  {
    check(
      '무장 표 길이가 단계 수 + 1 이다',
      ARMS_UPGRADE.startAttacks.length === ARMS_UPGRADE.costs.length + 1 &&
        ARMS_UPGRADE.slots.length === ARMS_UPGRADE.costs.length + 1,
    );
    check('하드 기본은 시작 장착 1칸', ARMS_UPGRADE.startAttacks[0] === 1);
    check('마지막 단계는 장착 4 · 슬롯 4', ARMS_UPGRADE.startAttacks[4] === 4 && ARMS_UPGRADE.slots[4] === 4);

    const normal = emptySave();
    check('일반은 슬롯 3칸', attackSlotCount(normal) === 3, `${attackSlotCount(normal)}`);
    check('일반은 시작 장착 2칸', maxStartFor(normal, 'attack') === 2);

    const hard = emptySave();
    hard.hardUnlocked = true;
    hard.hardMode = true;
    check('하드는 시작 장착이 1칸으로 깎인다', maxStartFor(hard, 'attack') === 1);
    check('하드도 슬롯은 3칸에서 시작', attackSlotCount(hard) === 3);

    for (let step = 0; step <= ARMS_UPGRADE.costs.length; step++) {
      hard.perm[ARMS_UPGRADE.key] = step;
      check(
        `무장 ${step}단계: 장착 ${ARMS_UPGRADE.startAttacks[step]} · 슬롯 ${ARMS_UPGRADE.slots[step]}`,
        maxStartFor(hard, 'attack') === ARMS_UPGRADE.startAttacks[step] &&
          attackSlotCount(hard) === ARMS_UPGRADE.slots[step],
      );
    }

    // 무장을 사 두어도 일반 판에서는 안 듣습니다 (하드 전용)
    hard.hardMode = false;
    check('일반 판에서는 무장 확장이 안 듣는다', attackSlotCount(hard) === 3 && maxStartFor(hard, 'attack') === 2);
  }

  // --- 시작 장착이 판에서 실제로 잘리는가 ---
  {
    const s = emptySave();
    s.hardUnlocked = true;
    s.hardMode = true;
    s.unlockedStartSkills = ['shotgun', 'sniper'];
    s.equippedStartSkills = ['shotgun', 'sniper'];
    const p = createPlayer(s);
    check('하드로 넘어오면 초과 장착이 잘린다', p.attacks.filter((x) => x !== null).length === 1);
    check('슬롯 자체는 3칸', p.attacks.length === 3);

    s.hardMode = false;
    const p2 = createPlayer(s);
    check('일반에서는 두 개가 다 들어간다', p2.attacks.filter((x) => x !== null).length === 2);
  }

  // --- 시작 스킬 숙련 ---
  {
    const s = emptySave();
    s.hardUnlocked = true;
    s.unlockedStartSkills = ['shotgun'];
    s.equippedStartSkills = ['shotgun'];
    check('안 사면 1레벨', startSkillLevel(s) === 1);
    s.perm[START_SKILL_LEVEL_UPGRADE.key] = START_SKILL_LEVEL_UPGRADE.costs.length;
    check('다 사면 3레벨', startSkillLevel(s) === 3);
    const p = createPlayer(s);
    check('시작 스킬이 그 레벨로 들어간다', p.attacks[0]?.level === 3, `${p.attacks[0]?.level}`);
  }

  // --- 경험치 강화 ---
  {
    const s = emptySave();
    check('안 사면 배율 1', Math.abs(xpMultiplier(s) - 1) < 1e-9);
    s.perm[XP_UPGRADE.key] = XP_UPGRADE.costs.length;
    const mul = xpMultiplier(s);
    check(
      '다 사면 배율이 표대로다',
      Math.abs(mul - (1 + XP_UPGRADE.costs.length * XP_UPGRADE.perLevel)) < 1e-9,
      `x${mul.toFixed(2)}`,
    );

    // **곱하는 곳이 `gainXp` 한 곳뿐인지**를 실제로 넣어 보고 잽니다
    const w = new World(s, input, 777, 0);
    w.gainXp(10);
    check('경험치에 배율이 먹는다', Math.abs(w.player.xp - 10 * mul) < 1e-6, `${w.player.xp}`);

    // 강제 레벨업(F1)은 "모자란 만큼"을 넣는 자리라 배율이 곱해지면 두 레벨이 오릅니다
    const w2 = new World(s, input, 777, 0);
    w2.gainXp(10, true);
    check('raw 는 배율을 안 탄다', Math.abs(w2.player.xp - 10) < 1e-6, `${w2.player.xp}`);
  }

  // --- 노출 조건 ---
  {
    check('새 저장은 하드가 안 열려 있다', emptySave().hardUnlocked === false);
    // 하드를 켜 둔 채 갱신한 사람은 그 사실을 인정합니다
    check('옛 저장의 hardMode 는 해금으로 읽힌다', fromJSON({ hardMode: true }).hardUnlocked === true);
    check('한 번 열면 저장에 남는다', fromJSON({ hardUnlocked: true }).hardUnlocked === true);
    // **끈다고 다시 잠기면 안 됩니다.** 산 것을 확인할 방법이 없어집니다
    check('하드를 꺼도 해금은 남는다', fromJSON({ hardMode: false, hardUnlocked: true }).hardUnlocked === true);
  }

  // 코인 규모. 하드 상점이 "살 수 있는 목록"인지 "영영 못 사는 목록"인지가 여기서 갈립니다.
  // 하드 코인 배율을 정할 때 이 숫자를 보십시오
  {
    let normal = 0;
    let hard = 0;
    for (const u of PERM_UPGRADES) {
      for (let i = 0; i < u.costs.length; i++) {
        if (i < PERM_MAX_LEVEL) normal += u.costs[i];
        else hard += u.costs[i];
      }
    }
    for (const u of [XP_UPGRADE, START_SKILL_LEVEL_UPGRADE, ARMS_UPGRADE]) {
      for (const c of u.costs) hard += c;
    }
    console.log(
      `   항목 ${totalPurchasable()} → ${totalPurchasableAll()}개 · 스탯 1~20 ${normal.toLocaleString()} · 하드 ${hard.toLocaleString()} 코인`,
    );
  }
}

// ---------------------------------------------------------------------------
// 18) 하드모드 난이도 (2026-09-06)
//
// 지키는 것은 넷입니다.
//   - 하드 0 이 일반 15 의 **장치를 전부** 가져오는가
//   - 배율은 낮췄는가, 그리고 **1 아래로 내려가지 않는가**
//   - 하드에는 입문(-1)이 없는가
//   - 기록 키가 일반과 갈리는가
// ---------------------------------------------------------------------------
console.log('\n18) 하드모드 난이도');
{
  const normal15 = difficultyMods(DIFFICULTY.max);
  const hard0 = difficultyMods(0, true);
  const hard15 = difficultyMods(DIFFICULTY.max, true);

  check('하드 표가 일반과 같은 칸 수다', HARD_DIFFICULTY_STEPS.length === DIFFICULTY.max, `${HARD_DIFFICULTY_STEPS.length}`);

  // --- 장치는 전부 가져옵니다 ---
  // **전원 정예만 예외입니다** (2026-09-08 사용자 확정). 하드 0 은 일반 15 의 장치를
  // 전부 들고 오되 이것 하나만 빼고, 하드 6 에서 다시 켜집니다. 그래야 0~5 가
  // "정예가 없는 하드"라는 다른 판이 되고, "15칸에 켤 장치가 안 남는다"가 풀립니다
  check('하드 0 은 전원 정예가 아니다', !hard0.allElite && normal15.allElite);
  check('대신 정예 비율이 오른다', hard0.eliteRatioMul > normal15.eliteRatioMul, `${hard0.eliteRatioMul}`);
  check('하드 6 에서 다시 켜진다', difficultyMods(6, true).allElite);
  check('하드 5 까지는 안 켜진다', !difficultyMods(5, true).allElite);
  check('하드 0 은 무적 바보적', hard0.foolInvuln === normal15.foolInvuln && hard0.foolInvuln);
  check('하드 0 은 선택지 2장', hard0.skillChoices === normal15.skillChoices, `${hard0.skillChoices}`);
  check('하드 0 은 돌진 쿨 없음', hard0.chargerNoCooldown === normal15.chargerNoCooldown);
  check('하드 0 은 분열 탄막', hard0.splitterShoot === normal15.splitterShoot);
  check('하드 0 도 30분 클리어', hard0.clearTime === normal15.clearTime, `${hard0.clearTime}`);
  check('하드 0 의 웨이브가 일반 15 와 같다', hard0.wave?.count === normal15.wave?.count);

  // --- 배율은 낮춥니다 ---
  check('하드 0 체력이 일반 15 보다 낮다', hard0.hpMul < normal15.hpMul, `${hard0.hpMul.toFixed(2)} < ${normal15.hpMul.toFixed(2)}`);
  check('하드 0 공격력이 일반 15 보다 낮다', hard0.damageMul < normal15.damageMul);
  check('하드 0 스폰율이 일반 15 보다 낮다', hard0.spawnRateMul < normal15.spawnRateMul);

  // **1 아래로 내려가면 안 됩니다.** 배율 자체에 곱하면 (x2.10 x 0.7 = x1.47) 이 아니라
  // 감소 계열(자폭병 속도 x0.8 등)이 1 을 넘어 오히려 강화가 됩니다
  const muls: [string, number][] = [
    ['체력', hard0.hpMul],
    ['공격력', hard0.damageMul],
    ['이동속도', hard0.speedMul],
    ['스폰율', hard0.spawnRateMul],
    ['접촉', hard0.contactDamageMul],
    ['적탄', hard0.bulletSpeedMul],
  ];
  for (const [name, v] of muls) {
    check(`하드 0 ${name} 배율이 1 이상`, v >= 1, `${v.toFixed(2)}`);
  }
  // 일반 15 에서 1 미만이던 것은 하드에서도 1 미만이어야 합니다 (약화는 약화로 남습니다)
  check(
    '자폭병 속도는 여전히 1 미만',
    normal15.bomberSpeedMul < 1 && hard0.bomberSpeedMul < 1,
    `${hard0.bomberSpeedMul.toFixed(2)}`,
  );
  check('겁쟁이 인내도 1 미만', hard0.cowardPatienceMul < 1, `${hard0.cowardPatienceMul.toFixed(2)}`);

  // --- 하드 표가 실제로 쌓입니다 ---
  check('하드 15 가 하드 0 보다 세다', hard15.hpMul > hard0.hpMul && hard15.damageMul > hard0.damageMul);
  check('하드 15 가 일반 15 보다 세다', hard15.hpMul > normal15.hpMul, `${hard15.hpMul.toFixed(2)}`);
  check('하드 코인이 일반 15 보다 많다', hard0.coinMul > normal15.coinMul, `${hard0.coinMul.toFixed(2)}`);
  check('하드 코인이 단계마다 오른다', hard15.coinMul > hard0.coinMul, `${hard15.coinMul.toFixed(2)}`);

  // --- 입문(-1)이 없습니다 ---
  check('하드는 -1 을 0 으로 자른다', clampDifficulty(-1, true) === 0);
  check('일반은 -1 이 그대로', clampDifficulty(-1) === -1);
  check('하드 -1 을 넣어도 하드 0 이 나온다', difficultyMods(-1, true).hpMul === hard0.hpMul);

  // --- 기록 키 ---
  check('하드 기록 키가 갈린다', difficultyKey(3, true) === 'h3' && difficultyKey(3, false) === '3');
  {
    // 하드로 깬 기록이 일반 해금을 열어주면 안 됩니다 (그 반대도 마찬가지)
    const s = emptySave();
    for (let lv = 0; lv <= DIFFICULTY.max; lv++) {
      s.records.clearedByDifficulty[difficultyKey(lv, true)] = true;
    }
    check('하드 기록만으로는 일반 완주가 아니다', !clearedAllFrom(s, 0, false));
    check('하드 기록으로 하드 완주는 참', clearedAllFrom(s, 0, true));
  }

  console.log(
    `   하드 0 체력 x${hard0.hpMul.toFixed(2)} (일반 15 는 x${normal15.hpMul.toFixed(2)}) · 하드 15 x${hard15.hpMul.toFixed(2)} · 코인 x${hard0.coinMul.toFixed(2)} → x${hard15.coinMul.toFixed(2)}`,
  );
}

// ---------------------------------------------------------------------------
// 19) 하드 1: 거대 포식자 (2026-09-08)
//
// 이 패턴은 화면을 봐야만 알 수 있는 것이 많아 보이지만, 실제로 어긋나기 쉬운 곳은
// 전부 숫자입니다. 특히 **판정과 그림이 같은 값을 보는가**(`sweep.halfW/halfH`)와
// **2차가 반드시 반대편인가**가 그렇습니다.
// ---------------------------------------------------------------------------
console.log('\n19) 하드 1: 거대 포식자');
{
  const hardSave = (): SaveData => {
    const s = emptySave();
    s.hardMode = true;
    s.hardUnlocked = true;
    return s;
  };

  // --- 몸통만 치명적입니다 ---
  {
    const w = new World(hardSave(), input, 4242, 1);
    w.spawner.enabled = false;
    const boss = w.spawnBoss('boss');
    const plain = new World(emptySave(), input, 4242, 0);
    plain.spawner.enabled = false;
    const plainBoss = plain.spawnBoss('boss');

    check('하드 1 에서 포식자가 커진다', boss.radius > plainBoss.radius * 1.4, `${boss.radius.toFixed(0)}`);
    check('몸통 접촉이 x5', boss.contactMul === BOSS_PREDATOR_HARD.contactMul, `${boss.contactMul}`);
    check('일반 포식자는 x1', plainBoss.contactMul === 1);

    // 슬램은 500% 를 안 받습니다. 몸통과 충격파의 세기가 갈려 있어야 합니다
    const body = boss.damage * boss.contactMul * w.diff.contactDamageMul;
    const slam = boss.damage * BOSS_PREDATOR.slamDamageMul;
    check('슬램이 몸통보다 훨씬 약하다', slam < body / 4, `몸통 ${body.toFixed(0)} · 슬램 ${slam.toFixed(0)}`);
    console.log(
      `   몸통 ${body.toFixed(0)} · 슬램 ${slam.toFixed(0)} · 낙하 ${(body * BOSS_PREDATOR_HARD.fallDamageMul).toFixed(0)} (플레이어 체력 ${w.player.stats.maxHp.toFixed(0)})`,
    );
  }

  // --- 특수 패턴이 실제로 돌아갑니다 ---
  {
    const w = new World(hardSave(), input, 909, 1);
    w.spawner.enabled = false;
    const boss = w.spawnBoss('boss');

    // 훑기가 보인 절반 / 벽 크기 / 타겟 가능 여부를 프레임마다 모읍니다
    const sides: string[] = [];
    const pairs: [string, string][] = [];
    let firstOfPair: string | null = null;
    let sawWall = false;
    let wallCoversHalf = true;
    let hiddenTargetable = false;
    let sawStun = false;
    let fallX = -1;
    let fallY = -1;
    let playerAtFall = { x: 0, y: 0 };

    step(w, 60, true, false, () => {
      const s = boss.sweep;
      if (s?.active) {
        sawWall = true;
        const key = `${s.axis}${s.side}`;
        if (sides[sides.length - 1] !== key) {
          sides.push(key);
          // flag 가 false 면 1차, true 면 2차입니다
          if (!boss.state.flag) firstOfPair = key;
          else if (firstOfPair) {
            pairs.push([firstOfPair, key]);
            firstOfPair = null;
          }
        }
        // 벽은 경기장 절반을 통째로 덮어야 합니다
        const spanW = s.halfW * 2;
        const spanH = s.halfH * 2;
        const ok = s.axis === 'lr' ? spanW === CANVAS.w / 2 : spanH === CANVAS.h / 2;
        if (!ok) wallCoversHalf = false;
      }
      // 화면 밖에 있는 동안 자동 조준에 잡히면 안 됩니다
      if (boss.y < -100 && boss.targetable) hiddenTargetable = true;
      // 낙하 예고가 뜬 순간의 플레이어 자리를 적어둡니다
      if (boss.state.phase === 13 && fallX < 0) {
        fallX = boss.state.targetX;
        fallY = boss.state.targetY;
        playerAtFall = { x: w.player.x, y: w.player.y };
      }
      if (boss.state.phase === 14) sawStun = true;
    });

    check('특수 패턴에서 벽이 실제로 지나간다', sawWall);
    check('벽이 경기장 절반을 덮는다', wallCoversHalf);
    check('화면 밖에서는 타겟이 안 된다', !hiddenTargetable);
    check('낙하 뒤 기절 단계가 온다', sawStun);
    check(
      '낙하 지점이 예고 시점의 플레이어 자리다',
      Math.abs(fallX - playerAtFall.x) < 0.001 && Math.abs(fallY - playerAtFall.y) < 0.001,
    );

    // 훑기는 두 번이고 2차는 반드시 반대편입니다.
    // **순서가 아니라 단계(`state.flag`)로 짝을 짓습니다.** 목록의 짝수/홀수 자리로
    // 나누면 판이 끝나며 한쪽만 기록된 경우에 짝이 통째로 밀립니다
    check('훑기가 최소 두 번 돈다', sides.length >= 2, `${sides.join(' → ')}`);
    for (const [a, b] of pairs) {
      // 'lr0' 처럼 앞 두 글자가 축, 마지막 한 글자가 절반입니다
      check(`${a} 다음은 같은 축의 반대편 (${b})`, a.slice(0, 2) === b.slice(0, 2) && a[2] !== b[2]);
    }
    check('짝을 이룬 훑기가 있다', pairs.length >= 1, `${pairs.length}쌍`);
    console.log(`   훑은 절반 ${sides.join(' → ')}`);
  }

  // --- 일반모드에는 안 나옵니다 ---
  {
    const w = new World(emptySave(), input, 909, 15);
    w.spawner.enabled = false;
    const boss = w.spawnBoss('boss');
    let sawSpecial = false;
    step(w, 60, true, false, () => {
      if (boss.sweep || boss.state.phase >= 10) sawSpecial = true;
    });
    check('일반 15 에서는 특수 패턴이 없다', !sawSpecial);
    check('일반 15 의 포식자는 안 커진다', boss.contactMul === 1);
  }

  // --- 패턴이 끝나면 다시 경기장 안입니다 ---
  //
  // 화면 밖에 나가 있는 것은 특수 패턴 도중뿐이어야 합니다. 패턴이 끝났는데도
  // 밖에 남아 있으면 잡을 수도 맞을 수도 없는 보스가 되어 판이 영영 안 끝납니다
  {
    const w = new World(hardSave(), input, 31337, 1);
    w.spawner.enabled = false;
    const boss = w.spawnBoss('boss');
    let outsideWhileNormal = false;
    step(w, 120, true, false, () => {
      if (boss.sweep) return;
      const out = boss.x < -boss.radius || boss.x > CANVAS.w + boss.radius || boss.y < -boss.radius || boss.y > CANVAS.h + boss.radius;
      if (out) outsideWhileNormal = true;
    });
    check('패턴 밖에서는 항상 경기장 안이다', !outsideWhileNormal, `${boss.x.toFixed(0)},${boss.y.toFixed(0)}`);
    check('보스 좌표가 정상이다', finite(boss.x, boss.y, boss.hp));
  }
}

// ---------------------------------------------------------------------------
// 20) 하드 2: 방패적 (2026-09-08)
//
// **내구도만 오르고 본체가 받는 피해는 안 바뀝니다.** 이게 이 칸의 전부이고,
// 여기가 어긋나면 "관통이 방패적의 카운터"라는 관계가 통째로 뒤집힙니다.
// ---------------------------------------------------------------------------
console.log('\n20) 하드 2: 방패적');
{
  const hardSave = (): SaveData => {
    const s = emptySave();
    s.hardMode = true;
    s.hardUnlocked = true;
    return s;
  };
  const shieldOf = (w: World) => {
    w.spawner.enabled = false;
    return w.spawnEnemy('shield', 400, 400, {});
  };

  const before = shieldOf(new World(hardSave(), input, 55, 1));
  const after = shieldOf(new World(hardSave(), input, 55, 2));
  const normal15 = shieldOf(new World(emptySave(), input, 55, 15));

  check('하드 1 까지는 방패 내구도가 그대로', Math.abs(before.shieldMax / before.maxHp - 0.5) < 0.001, `${(before.shieldMax / before.maxHp).toFixed(2)}`);
  check('하드 2 에서 방패 내구도가 6배', Math.abs(after.shieldMax / after.maxHp - 3.0) < 0.001, `${(after.shieldMax / after.maxHp).toFixed(2)}`);
  check('일반모드는 안 바뀐다', Math.abs(normal15.shieldMax / normal15.maxHp - 0.5) < 0.001);

  // --- 관통은 완전히 그대로입니다 ---
  {
    const w = new World(hardSave(), input, 55, 2);
    const e = shieldOf(w);
    const hp0 = e.hp;
    const shield0 = e.shieldHp;
    w.damageEnemy(e, 100, { fromX: w.player.x, fromY: w.player.y, ignoreShield: true });
    check('관통은 본체에 그대로 들어간다', Math.abs(hp0 - e.hp - 100) < 0.001, `${(hp0 - e.hp).toFixed(1)}`);
    check('관통은 방패를 안 깎는다', e.shieldHp === shield0);
  }

  // --- 막히는 스킬은 방패에 통째로 버려집니다 ---
  {
    const w = new World(hardSave(), input, 55, 2);
    const e = shieldOf(w);
    e.facing = Math.atan2(w.player.y - e.y, w.player.x - e.x);
    const hp0 = e.hp;
    w.damageEnemy(e, 100, { fromX: w.player.x, fromY: w.player.y });
    check('막히는 피해는 본체에 안 들어간다', e.hp === hp0);
    check('막히는 피해는 방패를 깎는다', e.shieldHp < e.shieldMax);
    check('한 방에 안 깨진다', e.shieldHp > 0, `${e.shieldHp.toFixed(0)}`);
  }

  // --- 죽이는 데 필요한 총 피해 (본체 체력 기준) ---
  {
    const kill = (durabilityRatio: number) => ({
      pierce: 1,
      blocked: durabilityRatio + 1,
    });
    const now = kill(0.5);
    const hard = kill(3.0);
    check('관통은 하드 2 에서도 총량이 같다', now.pierce === hard.pierce);
    check('막히는 빌드는 확실히 늘어난다', hard.blocked > now.blocked * 2.5, `${hard.blocked}배`);
    console.log(`   총 피해 (본체 체력 기준) · 관통 ${hard.pierce.toFixed(2)}배 (지금 ${now.pierce.toFixed(2)}) · 막히는 ${hard.blocked.toFixed(2)}배 (지금 ${now.blocked.toFixed(2)})`);
  }
}

// ---------------------------------------------------------------------------
// 21) 하드 3: 사제적 (2026-09-08)
// ---------------------------------------------------------------------------
console.log('\n21) 하드 3: 사제적');
{
  const hardSave = (): SaveData => {
    const s = emptySave();
    s.hardMode = true;
    s.hardUnlocked = true;
    return s;
  };
  /**
   * 재는 것이 "회복"이라 플레이어의 자동 공격을 꺼야 합니다.
   * 안 끄면 회복량이 아니라 "회복 - 기본공격"을 재게 됩니다
   */
  const silent = (w: World): World => {
    w.spawner.enabled = false;
    w.player.stats.attack = 0;
    return w;
  };

  // --- 스폰은 하드 3 부터입니다 ---
  {
    const h2 = new World(hardSave(), input, 4242, 2);
    const h3 = new World(hardSave(), input, 4242, 3);
    check('하드 2 까지는 사제가 안 열린다', !h2.diff.extraEnemies.includes('priest'));
    check('하드 3 부터 사제가 열린다', h3.diff.extraEnemies.includes('priest'));
    check('일반 15 에서도 안 열린다', !new World(emptySave(), input, 1, 15).diff.extraEnemies.includes('priest'));
  }

  // --- 능력: 주변 적을 회복시키고 자기 자신은 안 됩니다 ---
  {
    const w = silent(new World(hardSave(), input, 4242, 3));
    const p = w.spawnEnemy('priest', 300, 300, {});
    const near = w.spawnEnemy('basic', 300 + 40, 300, {});
    const far = w.spawnEnemy('basic', 300 + 600, 300, {});
    // 셋 다 반쯤 깎아두고 봅니다
    for (const e of [p, near, far]) e.hp = e.maxHp * 0.5;
    // 쿨이 돌 때까지 (10초) + 재생 3초
    step(w, 13, true, false);

    check('가까운 적은 회복한다', near.hp > near.maxHp * 0.6, `${(near.hp / near.maxHp * 100).toFixed(0)}%`);
    check('먼 적은 회복 안 한다', far.hp <= far.maxHp * 0.51, `${(far.hp / far.maxHp * 100).toFixed(0)}%`);
    check('사제 자신은 회복 안 한다', p.hp <= p.maxHp * 0.51, `${(p.hp / p.maxHp * 100).toFixed(0)}%`);
    console.log(`   10초 뒤 · 가까운 적 ${(near.hp / near.maxHp * 100).toFixed(0)}% · 먼 적 ${(far.hp / far.maxHp * 100).toFixed(0)}% · 사제 ${(p.hp / p.maxHp * 100).toFixed(0)}%`);
  }

  // --- 화상이 재생의 카운터입니다 ---
  {
    const w = silent(new World(hardSave(), input, 4242, 3));
    const target = w.spawnEnemy('basic', 300, 300, {});
    target.hp = target.maxHp * 0.5;
    target.regenTime = ENEMY_PARAMS.priest.regenTime;
    // 화상은 지속 피해도 같이 넣으므로, 회복이 멈추는지만 보려고 피해를 0 으로 둡니다
    target.burnTime = 5;
    target.burnDps = 0;
    const before = target.hp;
    step(w, 2, true, false);
    check('화상 중에는 회복이 멈춘다', Math.abs(target.hp - before) < 0.001, `${(target.hp - before).toFixed(2)}`);
    // **타이머는 계속 흘렀어야 합니다.** 멈추면 카운터가 아니라 "잠깐 미루기"가 됩니다
    check('재생 시간은 계속 흐른다', target.regenTime < ENEMY_PARAMS.priest.regenTime - 1.5, `${target.regenTime.toFixed(2)}`);
  }

  // --- 중첩되지 않고 시간만 갱신됩니다 ---
  {
    const w = silent(new World(hardSave(), input, 4242, 3));
    const target = w.spawnEnemy('basic', 300, 300, {});
    target.hp = target.maxHp * 0.5;
    target.regenTime = 1.0;
    const hpPerSec = target.maxHp * ENEMY_PARAMS.priest.regenRatio;
    const before = target.hp;
    step(w, 1, true, false);
    // 두 번 걸렸다면 두 배로 찼을 것입니다
    check('회복량이 중첩되지 않는다', target.hp - before < hpPerSec * 1.2, `${(target.hp - before).toFixed(1)} vs ${hpPerSec.toFixed(1)}`);
  }

  // --- 정예는 반경이 넓고 즉시 회복이 붙습니다 ---
  {
    const w = silent(new World(hardSave(), input, 4242, 3));
    const plain = w.spawnEnemy('priest', 200, 200, {});
    const elite = w.spawnEnemy('priest', 900, 200, { elite: true });
    check('정예 사제는 반경이 넓다', priestRadius(elite, w) > priestRadius(plain, w) * 1.4);

    // 정예가 걸면 그 순간 잃은 체력의 일부가 즉시 찹니다
    const target = w.spawnEnemy('basic', 940, 200, {});
    target.hp = target.maxHp * 0.5;
    const at = target.hp;
    elite.state.timer3 = 0.02;
    step(w, 0.1, true, false);
    check('정예는 거는 순간 즉시 회복시킨다', target.hp > at, `${(target.hp - at).toFixed(1)}`);
  }

  // --- 색과 모양 규칙 ---
  {
    const d = getEnemyDef('priest');
    check('사제는 칠각형이다', d.sides === 7, `${d.sides}`);
    check('사제는 차가운 색이다', (() => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(d.color.slice(i, i + 2), 16));
      return r - (g + b) / 2 < 0;
    })());
  }
}

// ---------------------------------------------------------------------------
// 22) 하드 4: 폭격기 (2026-09-09)
//
// 여기서 어긋나기 쉬운 곳은 셋입니다. **발수와 흩뿌리는 반경이 짝을 이루는가**
// (발수만 올리면 피할 자리가 없어집니다), **아군 오사에 보상이 안 붙는가**,
// **보스가 자기 폭격에 안 맞는가**입니다. 뒤의 둘은 어기면 곧바로 최적 전략이
// 뒤집히는데(폭격 한가운데로 잡몹 몰기 · 보스 옆에 붙어 있기) 화면에서는 안 보입니다.
// ---------------------------------------------------------------------------
console.log('\n22) 하드 4: 폭격기');
{
  const hardSave = (): SaveData => {
    const s = emptySave();
    s.hardMode = true;
    s.hardUnlocked = true;
    return s;
  };

  // --- 표의 짝이 맞는가 ---
  {
    const H = BOSS_BOMBARD_HARD;
    const B = BOSS_BOMBARD;
    // 발수만 올리면 반경 안에 안전한 자리가 안 남습니다. 넓이가 같이 늘어야 합니다
    const densityBefore = (B.shots * B.blastRadius ** 2) / B.spread ** 2;
    const densityAfter = (H.shots * B.blastRadius ** 2) / H.spread ** 2;
    console.log(
      `   ${B.shots}발/반경 ${B.spread} → ${H.shots}발/반경 ${H.spread} · 밀도 ${densityBefore.toFixed(2)} → ${densityAfter.toFixed(2)} · 쿨 ${B.volleyInterval.toFixed(1)} → ${(B.volleyInterval * H.volleyIntervalMul).toFixed(1)}초`,
    );
    check('발수가 늘었다', H.shots > B.shots);
    check('흩뿌리는 반경도 같이 늘었다', H.spread > B.spread);
    // **발수와 반경은 짝입니다.** 밀도가 지금과 크게 달라지면 안 됩니다.
    // 크게 오르면 피할 자리가 없어져 무작위 즉사가 되고, 크게 내려가면
    // "폭격이 늘었다"고 해놓고 국소적으로는 오히려 헐거워집니다
    check(
      '발수와 반경이 짝을 이뤄 밀도가 크게 안 변한다',
      densityAfter > densityBefore * 0.7 && densityAfter < densityBefore * 1.4,
      `x${(densityAfter / densityBefore).toFixed(2)}`,
    );
    check('쿨이 늘어 옮겨갈 틈이 생긴다', H.volleyIntervalMul > 1);
  }

  // --- 하드 4 에서만 켜집니다 ---
  {
    check('하드 4 는 켜진다', difficultyMods(4, true).bossBombardHard);
    check('하드 3 은 아직 안 켜진다', !difficultyMods(3, true).bossBombardHard);
    check('일반 15 에도 없다', !difficultyMods(15, false).bossBombardHard);
  }

  // --- 실제로 폭격이 두 배로 떨어지고 착화지점이 남는가 ---
  {
    const w = new World(hardSave(), input, 5150, 4);
    w.spawner.enabled = false;
    const boss = w.spawnBoss('bombard');
    w.player.x = 640;
    w.player.y = 360;

    const plain = new World(emptySave(), input, 5150, 0);
    plain.spawner.enabled = false;
    plain.spawnBoss('bombard');
    plain.player.x = 640;
    plain.player.y = 360;

    // 등장 연출이 끝나고 폭격이 몇 번 돌 때까지 돌립니다
    let hardShots = 0;
    let plainShots = 0;
    step(w, 14, true, false, () => {
      hardShots = Math.max(hardShots, w.pendingBlasts.filter((b) => !b.dead).length);
    });
    step(plain, 14, true, false, () => {
      plainShots = Math.max(plainShots, plain.pendingBlasts.filter((b) => !b.dead).length);
    });
    console.log(
      `   한 번에 예약된 폭격 · 일반 ${plainShots}발 → 하드 4 ${hardShots}발 · 착화지점 ${w.hazards.filter((h) => !h.dead).length}개`,
    );
    check('폭격이 실제로 더 많이 떨어진다', hardShots > plainShots, `${plainShots} → ${hardShots}`);
    check('터진 자리에 착화지점이 남는다', w.hazards.some((h) => !h.dead));
    check('일반모드에는 착화지점이 없다', plain.hazards.every((h) => h.dead));

    const fire = w.hazards.find((h) => !h.dead);
    if (fire) {
      check(
        '착화지점은 절반 반경이다',
        Math.abs(fire.radius - BOSS_BOMBARD.blastRadius * BOSS_BOMBARD_HARD.scorchRadiusMul) < 0.01,
        `${fire.radius}`,
      );
      check('착화지점은 피해를 준다', fire.tickDamage > 0, `${fire.tickDamage.toFixed(1)}`);
      // 감속까지 걸면 빠져나오기 전에 다음 폭격을 맞는 연쇄가 생깁니다
      check('착화지점은 감속을 안 건다', fire.slow === 1, `${fire.slow}`);
      check('착화지점은 플레이어 쪽이다', fire.side === 'player');
    } else {
      check('착화지점이 하나는 있다', false);
    }
    void boss;
  }

  // --- 보스는 적이 낸 폭발에 안 맞습니다 ---
  // 판 안에서 체력만 보면 플레이어의 기본공격이 섞이므로, 폭발 한 번을 직접 재봅니다
  {
    const w = new World(hardSave(), input, 5152, 4);
    w.spawner.enabled = false;
    const boss = w.spawnBoss('bombard');
    step(w, 0.05, true, false);
    const hp0 = boss.hp;
    w.explodeAll(boss.x, boss.y, 200, 9999, '#ff7a1a', null, true);
    check('보스는 적이 낸 폭발에 안 맞는다', boss.hp === hp0, `${hp0.toFixed(0)} → ${boss.hp.toFixed(0)}`);
    // 대조군: 내가 낸 폭발에는 예전 그대로 맞습니다
    w.explodeAll(boss.x, boss.y, 200, 300, '#ff7a1a', null);
    check('내가 낸 폭발에는 맞는다', boss.hp < hp0, `${hp0.toFixed(0)} → ${boss.hp.toFixed(0)}`);
  }

  // --- 아군 오사에는 보상이 하나도 안 붙습니다 ---
  {
    const w = new World(hardSave(), input, 5151, 4);
    w.spawner.enabled = false;
    w.player.x = 100;
    w.player.y = 100;

    const victims = [];
    for (let i = 0; i < 5; i++) victims.push(w.spawnEnemy('basic', 900 + i * 8, 400, {}));
    // 폭발 판정은 공간 격자를 훑습니다. 한 프레임을 돌려 격자에 올려야 잡힙니다
    step(w, 0.05, true, false);
    for (const v of victims) v.hp = 1;

    const k0 = w.stats.kills;
    const xp0 = w.player.xp;
    const c0 = w.coins.length;
    const best0 = w.track.corpseBlastBest;
    // 폭격기가 내는 것과 같은 폭발입니다 (편을 안 가리고 보상이 없음)
    w.explodeAll(900, 400, 120, 9999, '#ff7a1a', null, true);
    console.log(
      `   폭격 아군 오사 · 잡몹 ${victims.filter((v) => v.dead).length}/5 처치 · 처치 수 ${k0} → ${w.stats.kills} · 경험치 ${xp0} → ${w.player.xp} · 코인 ${c0} → ${w.coins.length}`,
    );
    check('폭격이 적을 실제로 죽인다', victims.every((v) => v.dead));
    check('그 처치는 처치 수에 안 들어간다', w.stats.kills === k0, `${k0} → ${w.stats.kills}`);
    check('그 처치는 경험치를 안 준다', w.player.xp === xp0, `${xp0} → ${w.player.xp}`);
    check('그 처치는 코인을 안 준다', w.coins.length === c0, `${c0} → ${w.coins.length}`);
    // "도구로 쓴다" 는 내가 시체를 터뜨린 성과입니다. 보스의 폭격이 세면 안 됩니다
    check('"도구로 쓴다" 집계에도 안 들어간다', w.track.corpseBlastBest === best0, `${best0} → ${w.track.corpseBlastBest}`);

    // 자폭적 시체 폭발은 예전 그대로 보상이 붙습니다. 이 갈래가 섞이면 안 됩니다
    const v2 = w.spawnEnemy('basic', 300, 300, {});
    step(w, 0.05, true, false);
    v2.hp = 1;
    const k1 = w.stats.kills;
    w.explodeAll(300, 300, 120, 9999, '#ff7a1a', null);
    check('내가 낸 폭발은 예전대로 보상이 붙는다', w.stats.kills === k1 + 1, `${k1} → ${w.stats.kills}`);
  }
}

console.log('\n23) 클리어 뒤 급상승 (OVERTIME)');
{
  const save = emptySave();
  const w = new World(save, input, 5, 0);
  const ct = w.diff.clearTime;

  // --- 클리어 전에는 아무것도 안 걸립니다 ---
  w.time = ct;
  check('클리어 전 급상승 시간은 0', w.overtimeMinutes() === 0, `${w.overtimeMinutes()}`);
  check('클리어 전 속도 배율은 1', w.overtimeSpeedMul() === 1, `${w.overtimeSpeedMul()}`);
  check('클리어 전 적 상한은 기본값', w.maxAliveNow() === SPAWN.maxAlive + w.diff.maxAliveAdd, `${w.maxAliveNow()}`);

  // --- 속도는 **잡는 그 순간** 이미 speedStart 입니다 (2026-09-12 재설계) ---
  w.cleared = true;
  const speedAt = (min: number) => {
    w.time = ct + min * 60;
    return w.overtimeSpeedMul();
  };
  const nearSpeed = (label: string, got: number, want: number) =>
    check(label, Math.abs(got - want) < 0.01, `${got.toFixed(2)} (기대 ${want})`);

  // **이 시험이 이 구간 설계의 전부입니다.** 0 분이 1 로 돌아가면 도망칠 수 없게
  // 되기까지 몇 분이 생기고, 그 몇 분이 그대로 파밍 시간이 됩니다
  nearSpeed('클리어하는 순간 이미 speedStart', speedAt(0), OVERTIME.speedStart);
  nearSpeed('1분에 +0.5', speedAt(1), OVERTIME.speedStart + OVERTIME.speedPerMinute);
  nearSpeed('2분에 +1.0', speedAt(2), OVERTIME.speedStart + OVERTIME.speedPerMinute * 2);
  check('상한에서 멈춘다', speedAt(30) === OVERTIME.speedMax, `${speedAt(30)}`);

  // **정예 빠른적이 플레이어보다 빨라야 합니다.** 이 부등호가 깨지면 클리어 뒤에도
  // 그냥 도망다닐 수 있게 되어 급상승이 하는 일이 없어집니다.
  //
  // 기준이 둘인 이유는 플레이어 이동속도가 판 안에서 자라기 때문입니다. 상점만 산
  // 상태(365)는 **클리어하는 그 순간** 이미 따라잡히고, 스탯을 상한까지 올린
  // 플레이어(510)도 **1분이면** 따라잡힙니다
  {
    const eliteSpd = ELITE_TRAITS.fast?.speedMul ?? ELITE.speedMul;
    const fastBase = ENEMY_BASE.speed * ENEMY_TABLE.fast.speed * eliteSpd;
    const cap = STAT_DEFS.find((d) => d.key === 'moveSpeed')!.cap!;
    check('클리어 직후 상점만 산 플레이어(365)보다 빠르다', fastBase * OVERTIME.speedStart > 365, `${(fastBase * OVERTIME.speedStart).toFixed(0)}`);
    check(
      `1분이면 이동속도 상한(${cap})도 따라잡는다`,
      fastBase * speedAt(1) > cap,
      `${(fastBase * speedAt(1)).toFixed(0)}`,
    );
  }

  // --- 체력·공격력은 합연산으로 시간 강화 위에 더해집니다 ---
  {
    const before = new World(emptySave(), input, 5, 0);
    before.time = ct;
    const after = new World(emptySave(), input, 5, 0);
    after.cleared = true;
    after.time = ct + 300; // 5분
    const gainHp = after.timeScale().hp - before.timeScale().hp;
    // 5분이면 기본 시간 강화 +1.0 에 급상승 +2.0 이 더해집니다
    const want = 5 * TIME_SCALING.hpPerMinute + 5 * OVERTIME.hpPerMinute;
    check('체력이 합연산으로 오른다', Math.abs(gainHp - want) < 0.01, `${gainHp.toFixed(2)} (기대 ${want.toFixed(2)})`);
    check('공격력도 같이 오른다', after.timeScale().dmg > before.timeScale().dmg);
    check('속도는 곱연산이다', after.timeScale().speed > before.timeScale().speed * 1.9, `${after.timeScale().speed.toFixed(2)}`);
  }

  // --- 적 수도 늘고, 성능 점검 기준에서 멈춥니다 ---
  {
    const base = SPAWN.maxAlive + w.diff.maxAliveAdd;
    w.time = ct + 120;
    check('2분이면 적 상한이 는다', w.maxAliveNow() > base, `${base} → ${w.maxAliveNow()}`);
    w.time = ct + 3600;
    check('적 상한이 성능 점검 기준에서 멈춘다', w.maxAliveNow() === OVERTIME.maxAliveCap, `${w.maxAliveNow()}`);
  }

  console.log(
    `   속도 0분 x${speedAt(0).toFixed(2)} · 3분 x${speedAt(3).toFixed(2)} · 상한 x${OVERTIME.speedMax} · 적 상한 ${OVERTIME.maxAliveCap}`,
  );

  // --- 클리어 뒤에는 코인이 훨씬 덜 떨어집니다 (2026-09-12) ---
  {
    const n = 2000;
    const before = new World(emptySave(), input, 5, 0);
    before.spawner.enabled = false;
    for (let i = 0; i < n; i++) before.dropCoin(640, 360);
    check('클리어 전에는 부르는 족족 떨어진다', before.coins.length === n, `${before.coins.length}/${n}`);

    const after = new World(emptySave(), input, 5, 0);
    after.spawner.enabled = false;
    after.cleared = true;
    for (let i = 0; i < n; i++) after.dropCoin(640, 360);
    const rate = after.coins.length / n;
    check('클리어 뒤에는 눈에 띄게 줄어든다', rate < 0.5, `${(rate * 100).toFixed(0)}%`);
    check('그래도 아예 끊기지는 않는다', after.coins.length > 0, `${after.coins.length}`);
    check(
      '표에 적힌 배율 근처다',
      Math.abs(rate - OVERTIME.coinDropMul) < 0.05,
      `${(rate * 100).toFixed(0)}% (표 ${OVERTIME.coinDropMul * 100}%)`,
    );
    console.log(`   클리어 뒤 코인 드랍 ${(rate * 100).toFixed(0)}% (표 ${OVERTIME.coinDropMul * 100}%)`);
  }

  // --- 클리어 보너스는 **처음 깰 때만** 제값입니다 (2026-09-12) ---
  {
    // 같은 저장으로 두 판을 이어 돌립니다. 첫 판은 기록이 비어 있으니 제값,
    // 두 번째 판은 저장에 클리어가 남아 있으니 줄어든 값이어야 합니다
    const save = emptySave();
    const clearOnce = (sv: typeof save) => {
      const w = new World(sv, input, 31, 0);
      w.time = w.diff.clearTime - 1;
      step(w, 3);
      const boss = w.enemies.find((e) => e.id === w.clearBossId)!;
      const before = w.stats.coins;
      w.killEnemy(boss);
      // 보스 코인은 바닥에 떨어지는 것이라 주워야 `stats.coins` 에 들어옵니다.
      // 여기서 늘어난 것은 즉시 적립되는 보너스뿐입니다
      return { w, gained: w.stats.coins - before };
    };

    const first = clearOnce(save);
    check('첫 클리어는 제값', first.w.clearBonus === CLEAR_BONUS.coin, `${first.w.clearBonus}`);
    check('첫 클리어임을 기억한다', first.w.clearBonusFirst);
    check('실제로 코인이 들어온다', first.gained === CLEAR_BONUS.coin, `${first.gained}`);
    commitRun(save, first.w);

    const again = clearOnce(save);
    const want = Math.round(CLEAR_BONUS.coin * CLEAR_BONUS.repeatRatio);
    check('두 번째부터는 줄어든다', again.w.clearBonus === want, `${again.w.clearBonus} (기대 ${want})`);
    check('첫 클리어가 아니라고 표시된다', !again.w.clearBonusFirst);
    check('줄어든 값이 제값보다 확실히 작다', want < CLEAR_BONUS.coin * 0.5, `${want}`);

    // **다른 난이도는 별개입니다.** 난이도 0 을 깼다고 1 의 첫 클리어가 사라지면
    // "안 깬 난이도로 가라"는 규칙 자체가 성립하지 않습니다
    const other = new World(save, input, 31, 1);
    check('다른 난이도는 여전히 첫 클리어', !hasCleared(save, 1), '난이도 1');
    check('그 판의 난이도가 1 이다', other.difficulty === 1, `${other.difficulty}`);

    console.log(`   첫 클리어 ${CLEAR_BONUS.coin} → 재클리어 ${want} (난이도 배율은 그 위에 곱해집니다)`);
  }

  // --- 화면이 타이머 정지를 계속 알리는가 ---
  {
    const ww = new World(emptySave(), input, 5, 0);
    ww.time = ww.diff.clearTime - 1;
    step(ww, 3);

    const texts: { s: string; x: number; y: number }[] = [];
    drawHud(recordingRenderer(texts), ww, false);
    check('타이머 정지를 알린다', texts.some((t) => t.s.includes('타이머 정지')), texts.map((t) => t.s).join(' | '));
    check('클리어 대상을 짚어준다', texts.some((t) => t.s.includes('클리어 대상')));

    // 앞 보스가 섞여 있어도 막대는 클리어 대상을 가리켜야 합니다
    ww.spawnBoss();
    const two: { s: string; x: number; y: number }[] = [];
    drawHud(recordingRenderer(two), ww, false);
    check('보스가 둘이어도 막대가 클리어 대상을 가리킨다', two.some((t) => t.s.includes('· 클리어 대상')));

    const boss = ww.enemies.find((e) => e.id === ww.clearBossId)!;
    ww.killEnemy(boss);
    const after: { s: string; x: number; y: number }[] = [];
    drawHud(recordingRenderer(after), ww, false);
    check('클리어하면 안내가 사라진다', !after.some((t) => t.s.includes('타이머 정지')));
    check('클리어하면 표시도 사라진다', !after.some((t) => t.s.includes('클리어 대상')));
  }

  // --- 옛 저장 소급 ---
  {
    // 시간으로 깼던 판은 클리어로 읽어야 합니다. 안 하면 이미 15까지 깬 사람의
    // 해금 사슬과 하드모드 스위치가 통째로 날아갑니다
    const old = fromJSON({
      records: {
        bestTimeByDifficulty: {
          '0': unlockTimeFor(0),
          '3': unlockTimeFor(3),
          '4': unlockTimeFor(4) - 1,
          h0: unlockTimeFor(0, true),
        },
      },
    });
    check('옛 시간 기록이 클리어로 소급된다', hasCleared(old, 0));
    check('30분짜리도 소급된다', hasCleared(old, 3));
    check('1초 모자란 것은 소급 안 된다', !hasCleared(old, 4));
    check('하드 키도 소급된다', hasCleared(old, 0, true));

    // 이미 클리어 칸이 있는 저장은 그대로 둡니다. 소급이 덮어쓰면
    // "보스를 못 잡았는데 시간만 채운 판"이 클리어로 바뀝니다
    const fresh = fromJSON({
      records: { bestTimeByDifficulty: { '0': unlockTimeFor(0) }, clearedByDifficulty: {} },
    });
    check('클리어 칸이 있으면 소급하지 않는다', !hasCleared(fresh, 0));
  }
}

console.log('\n24) 패치로그');
{
  check('버전이 하나 이상 있다', PATCH_NOTES.length > 0);
  check('최신이 맨 앞이다', LATEST_PATCH === PATCH_NOTES[0].version, `${LATEST_PATCH} vs ${PATCH_NOTES[0].version}`);

  const vers = PATCH_NOTES.map((n) => n.version);
  check('버전이 겹치지 않는다', new Set(vers).size === vers.length, vers.join(','));

  for (const n of PATCH_NOTES) {
    check(`${n.version} 에 날짜가 있다`, /^\d{4}-\d{2}-\d{2}$/.test(n.date), n.date);
    check(`${n.version} 에 내용이 있다`, n.groups.length > 0);
    for (const g of n.groups) {
      check(`${n.version} ${g.title} 에 항목이 있다`, g.items.length > 0);
      for (const it of g.items) {
        check(`${n.version} ${it.title} 에 줄이 있다`, it.lines.length > 0);
        // **수치는 안 적습니다** (2026-09-10 사용자 지시). 반경 380 이 아니라 "범위 증가"입니다.
        // 판마다 배율이 달라 그 숫자가 화면에서 뜻을 갖지 않고, 다음에 손볼 때 여기까지
        // 고쳐야 합니다. 배율·단위 표기만 막고 "난이도 3" 같은 것은 그대로 둡니다
        for (const line of it.lines) {
          check(
            `"${line}" 에 수치가 없다`,
            !/(x\s*\d|\d\s*(배|초|%|px))/.test(line),
            line,
          );
        }
      }
    }
  }

  // --- 하드 항목은 하드모드를 연 사람에게만 ---
  const hidden = visiblePatchNotes(false);
  const shown = visiblePatchNotes(true);
  const titles = (list: ReturnType<typeof visiblePatchNotes>) =>
    list.flatMap((n) => n.groups.flatMap((g) => g.items.map((it) => it.title)));
  const hardTitles = PATCH_NOTES.flatMap((n) => n.groups.flatMap((g) => g.items.filter((it) => it.hardOnly).map((it) => it.title)));

  check('하드 전용 항목이 실제로 있다', hardTitles.length > 0, hardTitles.join(','));
  check('잠긴 저장에는 하드 항목이 안 보인다', hardTitles.every((t) => !titles(hidden).includes(t)), titles(hidden).join(','));
  check('연 저장에는 보인다', hardTitles.every((t) => titles(shown).includes(t)));
  // 하드 항목만 있던 묶음이 빈 껍데기로 남으면 안 됩니다
  check('빈 묶음이 안 남는다', hidden.every((n) => n.groups.every((g) => g.items.length > 0)));

  console.log(`   ${PATCH_NOTES.length}개 버전 · 최신 ${LATEST_PATCH} · 하드 전용 ${hardTitles.length}개`);
}

console.log('\n25) 하드 5: 경기장 레이저');
{
  const hardSave = (): SaveData => {
    const s = emptySave();
    s.hardMode = true;
    s.hardUnlocked = true;
    return s;
  };

  // --- 하드 5 부터만 열립니다 ---
  check('하드 4 에는 없다', !difficultyMods(4, true).arenaLaser);
  check('하드 5 부터 열린다', difficultyMods(5, true).arenaLaser);
  check('하드 15 까지 유지된다', difficultyMods(15, true).arenaLaser);
  check('일반모드에는 없다', !difficultyMods(15, false).arenaLaser);

  // --- 가로 또는 세로. 45도는 없습니다 ---
  {
    const w = new World(hardSave(), input, 11, 5);
    w.spawner.enabled = false;
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const l = w.spawnLaser();
      seen.add(l.axis);
      const limit = l.axis === 'h' ? CANVAS.h : CANVAS.w;
      check('레이저가 경기장 안에 있다', l.pos >= 0 && l.pos <= limit, `${l.axis} ${l.pos.toFixed(0)}`);
    }
    check('가로와 세로가 둘 다 나온다', seen.has('h') && seen.has('v'), [...seen].join(','));
    check('그 밖의 방향은 없다', seen.size === 2, [...seen].join(','));
  }

  // --- 예고가 다 차야 쏩니다 ---
  {
    const w = new World(hardSave(), input, 12, 5);
    w.spawner.enabled = false;
    const l = w.spawnLaser();
    check('예고가 같이 뜬다', w.telegraphs.some((t) => t.kind === 'line' && !t.dead));

    // 선 위에 세워 둡니다
    if (l.axis === 'h') w.player.y = l.pos;
    else w.player.x = l.pos;

    // **매 프레임 다시 세워야 합니다.** 점검용 입력이 플레이어를 계속 움직여서
    // 그냥 두면 저절로 비켜나고, 그러면 "안 맞았다"가 아니라 "안 서 있었다"가 됩니다
    const pin = (ww: World) => {
      if (l.axis === 'h') ww.player.y = l.pos;
      else ww.player.x = l.pos;
    };
    const hp0 = w.player.hp;
    step(w, HARD_LASER.telegraph * 0.5, false, false, pin);
    check('다 차기 전에는 안 맞는다', w.player.hp === hp0, `${hp0} → ${w.player.hp}`);

    step(w, HARD_LASER.telegraph, false, false, pin);
    check('다 차면 맞는다', w.player.hp < hp0, `${hp0} → ${w.player.hp}`);
    check('사인이 판의 장치로 남는다', w.lastDamageSource?.id === null, `${w.lastDamageSource?.id}`);
    check('사인에 이름이 있다', !!w.lastDamageSource?.device, `${w.lastDamageSource?.device}`);

    // 한 번만 때립니다. 잔상은 그림일 뿐입니다
    const hp1 = w.player.hp;
    w.player.invuln = 0;
    step(w, HARD_LASER.linger * 2, false, false, pin);
    check('잔상에는 피해가 없다', w.player.hp === hp1, `${hp1} → ${w.player.hp}`);
  }

  // --- 비키면 안 맞고, 적은 아예 안 맞습니다 ---
  {
    const w = new World(hardSave(), input, 13, 5);
    w.spawner.enabled = false;
    const l = w.spawnLaser();
    const off = HARD_LASER.width / 2 + w.player.radius + 30;
    const limit = l.axis === 'h' ? CANVAS.h : CANVAS.w;
    const safe = l.pos + off < limit - 20 ? l.pos + off : l.pos - off;
    // **두 축을 다 붙들어야 합니다.** 한 축만 고정하면 점검용 입력이 나머지 축으로
    // 플레이어를 몰고 다니다가 적에게 부딪혀서, 레이저가 아니라 접촉으로 맞습니다
    const stand = (ww: World) => {
      if (l.axis === 'h') {
        ww.player.x = 200;
        ww.player.y = safe;
      } else {
        ww.player.x = safe;
        ww.player.y = 200;
      }
    };
    stand(w);

    // 선 한가운데에 적을 세웁니다. 레이저는 적을 안 건드려야 합니다.
    // **기본공격을 꺼야 합니다.** 안 끄면 그 피해가 섞여서 레이저를 잰 것이 안 됩니다
    w.player.stats.attack = 0;
    const e = l.axis === 'h' ? w.spawnEnemy('tank', 1100, l.pos, {}) : w.spawnEnemy('tank', l.pos, 650, {});
    e.hp = 1e9;
    e.maxHp = 1e9;

    const hp0 = w.player.hp;
    step(w, HARD_LASER.telegraph + 0.2, false, false, stand);
    check('비키면 안 맞는다', w.player.hp === hp0, `${hp0} → ${w.player.hp}`);
    check('적은 레이저에 안 맞는다', e.hp === 1e9, `${e.hp}`);
  }

  // --- 일반모드에서는 저절로 안 나옵니다 ---
  {
    const w = new World(emptySave(), input, 14, 15);
    w.spawner.enabled = false;
    step(w, HARD_LASER.intervalMax + 5, true, false);
    check('일반모드에서는 레이저가 안 생긴다', w.lasers.length === 0, `${w.lasers.length}개`);
  }

  console.log(
    `   ${HARD_LASER.intervalMin}~${HARD_LASER.intervalMax}초마다 · 예고 ${HARD_LASER.telegraph}초 · 폭 ${HARD_LASER.width} · 공격력 배수 ${HARD_LASER.damage}`,
  );
}

console.log('\n26) 하드 6: 모두 정예 (배율 없이 능력만)');
{
  const hardSave = (): SaveData => {
    const s = emptySave();
    s.hardMode = true;
    s.hardUnlocked = true;
    return s;
  };

  check('하드 5 까지는 배율이 남는다', !difficultyMods(5, true).eliteStatsOff);
  check('하드 6 부터 배율이 빠진다', difficultyMods(6, true).eliteStatsOff);
  check('하드 6 은 전원 정예', difficultyMods(6, true).allElite);
  check('일반 15 는 배율이 그대로', !difficultyMods(15, false).eliteStatsOff && difficultyMods(15, false).allElite);

  // --- 배율은 사라지고 능력은 남는가 ---
  {
    const w = new World(hardSave(), input, 21, 6);
    w.spawner.enabled = false;
    const plain = w.spawnEnemy('tank', 300, 300, { elite: false });
    const elite = w.spawnEnemy('tank', 500, 300, { elite: true });

    check('정예 체력이 같다', elite.maxHp === plain.maxHp, `${elite.maxHp.toFixed(0)} vs ${plain.maxHp.toFixed(0)}`);
    check('정예 공격력이 같다', elite.damage === plain.damage, `${elite.damage.toFixed(1)} vs ${plain.damage.toFixed(1)}`);
    check('정예 이동속도가 같다', elite.speed === plain.speed, `${elite.speed.toFixed(0)} vs ${plain.speed.toFixed(0)}`);
    check('정예 크기가 같다', elite.radius === plain.radius, `${elite.radius.toFixed(1)} vs ${plain.radius.toFixed(1)}`);
    check('정예 경험치가 같다', elite.xp === plain.xp, `${elite.xp} vs ${plain.xp}`);
    check('그래도 정예이긴 하다', elite.elite && !plain.elite);

    // **능력은 남습니다.** 탱커 정예의 재생이 살아 있어야 합니다.
    // 기본공격을 꺼야 그 피해가 안 섞입니다
    w.player.stats.attack = 0;
    elite.hp = elite.maxHp * 0.5;
    const before = elite.hp;
    step(w, 1.2, true, false);
    check('정예 탱커 재생은 남는다', elite.hp > before, `${before.toFixed(0)} → ${elite.hp.toFixed(0)}`);
  }

  // --- 방패 받피 x0.5 는 배율이 아니라 능력입니다 (2026-09-10 사용자 확정) ---
  {
    const w = new World(hardSave(), input, 22, 6);
    w.spawner.enabled = false;
    const plain = w.spawnEnemy('shield', 300, 300, { elite: false });
    const elite = w.spawnEnemy('shield', 600, 300, { elite: true });
    check('방패 정예도 체력이 같다', elite.maxHp === plain.maxHp, `${elite.maxHp.toFixed(0)} vs ${plain.maxHp.toFixed(0)}`);

    // 방패를 안 거치는 자리(뒤)에서 때려 본체 피해만 잽니다
    const hitBack = (e: typeof plain) => {
      const hp0 = e.hp;
      w.damageEnemy(e, 100, { fromX: e.x, fromY: e.y + 400 });
      return hp0 - e.hp;
    };
    const dPlain = hitBack(plain);
    const dElite = hitBack(elite);
    check('정예 방패적은 절반만 받는다', Math.abs(dElite * 2 - dPlain) < 0.01, `${dElite.toFixed(1)} vs ${dPlain.toFixed(1)}`);
  }

  // --- 하드 5 에서는 배율이 그대로여야 합니다 (비교군) ---
  {
    const w = new World(hardSave(), input, 23, 5);
    w.spawner.enabled = false;
    const plain = w.spawnEnemy('tank', 300, 300, { elite: false });
    const elite = w.spawnEnemy('tank', 500, 300, { elite: true });
    check('하드 5 정예는 더 단단하다', elite.maxHp > plain.maxHp, `${elite.maxHp.toFixed(0)} vs ${plain.maxHp.toFixed(0)}`);
    check('하드 5 정예는 경험치가 많다', elite.xp > plain.xp, `${elite.xp} vs ${plain.xp}`);
  }

  console.log(
    `   하드 0 정예 비율 x${difficultyMods(0, true).eliteRatioMul.toFixed(2)} · 하드 6 부터 전원 정예 (배율 없음)`,
  );
}

console.log('\n27) 하드 7: 봉인적');
{
  const hardSave = (): SaveData => {
    const s = emptySave();
    s.hardMode = true;
    s.hardUnlocked = true;
    return s;
  };

  check('하드 6 까지는 안 나온다', !difficultyMods(6, true).extraEnemies.includes('sealer'));
  check('하드 7 부터 나온다', difficultyMods(7, true).extraEnemies.includes('sealer'));
  check('일반모드에는 없다', !difficultyMods(15, false).extraEnemies.includes('sealer'));
  check('하드 전용으로 표시돼 있다', ENEMY_TABLE.sealer.hardOnly === true);
  check('3분부터 나온다', ENEMY_TABLE.sealer.unlockTime === 180, `${ENEMY_TABLE.sealer.unlockTime}`);
  // "적 N종 전부"를 세는 업적에서 빠져야 합니다. 안 빼면 하드를 안 연 사람은 영영 못 깹니다
  const normalIds = ALL_ENEMY_IDS.filter((id) => !ENEMY_TABLE[id].hardOnly);
  check('적 N종 업적에서 빠진다', !normalIds.includes('sealer'), normalIds.join(','));

  // --- 탄 구조와 속도는 원거리적과 같은가 ---
  {
    const w = new World(hardSave(), input, 31, 7);
    w.spawner.enabled = false;
    w.player.stats.attack = 0;
    const e = w.spawnEnemy('sealer', w.player.x + 120, w.player.y, {});
    e.hp = 1e9;
    e.maxHp = 1e9;
    step(w, ENEMY_PARAMS.sealer.aimTime + 0.3, true, false);

    const shots = w.projectiles.filter((p) => !p.friendly && !p.dead);
    check('3갈래로 쏜다', shots.length === ENEMY_PARAMS.sealer.bulletCount, `${shots.length}발`);
    const speed = shots.length > 0 ? Math.hypot(shots[0].vx, shots[0].vy) : 0;
    check(
      '탄속이 원거리적과 같다',
      Math.abs(speed - ENEMY_PARAMS.ranged.bulletSpeed * w.diff.bulletSpeedMul) < 1,
      `${speed.toFixed(0)}`,
    );
    check('탄에 봉인이 실려 있다', shots.every((p) => p.seal > 0), `${shots[0]?.seal}`);
    // 갈래가 실제로 벌어져 있어야 합니다. 전부 같은 각이면 3갈래가 아니라 1발입니다
    const angles = shots.map((p) => Math.atan2(p.vy, p.vx));
    check('갈래가 벌어져 있다', Math.max(...angles) - Math.min(...angles) > 0.3, `${(Math.max(...angles) - Math.min(...angles)).toFixed(2)}`);
  }

  // --- 맞으면 스킬 하나가 봉인되고, 그동안 안 나갑니다 ---
  {
    const w = new World(hardSave(), input, 32, 7);
    w.spawner.enabled = false;
    const slot = makeSlot('shotgun', 5);
    w.player.attacks[0] = slot;

    const sealed = w.sealRandomSkill(ENEMY_PARAMS.sealer.sealTime);
    check('봉인이 걸린다', sealed === slot, `${sealed?.id}`);
    check('남은 시간이 들어간다', slot.sealed === ENEMY_PARAMS.sealer.sealTime, `${slot.sealed}`);

    // 봉인 중에는 발동하지 않습니다
    w.spawnEnemy('basic', w.player.x + 60, w.player.y, {});
    slot.cooldown = 0;
    const before = w.projectiles.filter((p) => p.friendly).length;
    step(w, 0.2, true, false);
    const during = w.projectiles.filter((p) => p.friendly).length;
    check('봉인 중에는 안 나간다', during === before, `${before} → ${during}`);
    // **쿨다운은 그대로 돕니다.** 봉인은 발동 금지이지 시간 정지가 아닙니다
    check('쿨다운은 안 멈춘다', slot.cooldown <= 0, `${slot.cooldown}`);

    step(w, ENEMY_PARAMS.sealer.sealTime, true, false);
    check('풀리면 다시 나간다', slot.sealed <= 0 && w.projectiles.filter((p) => p.friendly).length > during);
  }

  // --- 이미 봉인된 것에 겹쳐 걸지 않습니다 ---
  {
    const w = new World(hardSave(), input, 33, 7);
    w.spawner.enabled = false;
    const only = makeSlot('shotgun', 5);
    w.player.attacks = [only];
    w.player.utility = null;

    check('첫 번째는 걸린다', w.sealRandomSkill(1.2) === only);
    only.sealed = 0.5;
    check('이미 봉인된 것에는 안 건다', w.sealRandomSkill(1.2) === null);
    check('남은 시간이 안 늘어난다', only.sealed === 0.5, `${only.sealed}`);
  }

  // --- 정예는 봉인이 더 깁니다 ---
  {
    const w = new World(hardSave(), input, 34, 7);
    w.spawner.enabled = false;
    const plain = w.spawnEnemy('sealer', 300, 300, { elite: false });
    const elite = w.spawnEnemy('sealer', 600, 300, { elite: true });
    check('정예 봉인이 더 길다', sealerSealTime(elite) > sealerSealTime(plain), `${sealerSealTime(elite)} vs ${sealerSealTime(plain)}`);
  }

  // --- 하드 1~4 의 장치가 난이도 화면에 뜨는가 (2026-09-10 에 채웠습니다) ---
  {
    const labels = difficultyEffects(7, true).filter((e) => e.device).map((e) => e.label);
    for (const want of ['거대 포식자', '방패적 강화', '폭격기 강화', '은신적 강화', '새 적']) {
      check(`효과 목록에 "${want}" 이 있다`, labels.includes(want), labels.join(' / '));
    }
  }

  console.log(
    `   봉인 ${ENEMY_PARAMS.sealer.sealTime}초 (정예 ${ELITE_TRAITS.sealer?.sealTime}초) · ${ENEMY_PARAMS.sealer.bulletCount}갈래 · 조준 ${ENEMY_PARAMS.sealer.aimTime}초`,
  );
}

console.log(failures === 0 ? '\n전부 통과했습니다' : `\n실패 ${failures}건`);
process.exit(failures === 0 ? 0 : 1);
