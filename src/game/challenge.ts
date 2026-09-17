import {
  CANVAS,
  CHALLENGE_RULES,
  CHALLENGE_STAGES,
  SPAWN,
  type ChallengeStageDef,
  type ChallengeStageId,
  type EnemyId,
  type StatKey,
} from '../data/balance';
import { dist } from '../core/math';
import type { Enemy, KillerInfo } from './types';
import type { World } from './world';

/**
 * 도전모드 스테이지 엔진 (2026-09-16).
 *
 * **결정 본문은 `docs/기획/콘텐츠.md` 의 "2차 결정"입니다.** 여기는 그 규칙을 판에
 * 먹이는 자리일 뿐이고, 수치는 전부 `balance.ts` 의 `CHALLENGE_RULES` 에 있습니다.
 *
 * 도전 판의 공통 규칙 넷은 이 파일 밖에서 걸립니다.
 * - 상점 영구 강화 없음: `main.ts` 가 벗겨낸 저장본을 `World` 에 넘깁니다
 * - 난이도 배율 없음: 난이도 0 으로 시작합니다 (`difficultyMods(0, false)` 가 전부 1)
 * - 판 중 코인 없음: `World.dropCoin` 첫 줄
 * - 기록 차단: `main.ts` 의 `finishRun`
 */

/**
 * 암전 폭격의 사인. **적이 아니라 판의 장치라 `id` 가 null 입니다.**
 * 게임오버 화면이 그림 없이 이름만 띄웁니다 (하드 5 레이저와 같은 취급)
 */
const BOMB_KILLER: KillerInfo = { id: null, elite: false, device: '암전 폭격' };

export function challengeStage(id: ChallengeStageId): ChallengeStageDef {
  const def = CHALLENGE_STAGES.find((s) => s.id === id);
  if (!def) throw new Error(`도전 스테이지를 찾을 수 없습니다: ${id}`);
  return def;
}

/**
 * 판이 시작될 때 한 번.
 *
 * **스테이지가 적을 직접 내는 판은 평소 스폰 표를 끕니다** (`ownSpawn`).
 * `Spawner.enabled` 를 끄면 잡몹 · 웨이브 · 보스가 전부 멈춥니다 (`spawner.ts:50·129`).
 *
 * 2026-09-17 까지는 도전 판이면 무조건 껐습니다. "모든 적"이 나오는 판(6 · 8 · 9 · 10)
 * 에서는 평소 스폰이 그대로 돌아야 해서 스테이지 표를 보게 바꿨습니다. 지금 열려
 * 있는 1번과 2번은 둘 다 `ownSpawn` 이라 동작은 예전과 같습니다
 */
export function startChallenge(w: World): void {
  if (!w.challenge) return;
  if (challengeStage(w.challenge).ownSpawn) w.spawner.enabled = false;

  // 시작 유틸을 고르는 창을 띄웁니다 (2026-09-16 사용자 지시).
  //
  // **새 화면을 만들지 않습니다.** 선택 대기를 하나 올려두면 판이 시작되는 첫
  // 프레임에 기존 레벨업 선택창이 그대로 뜹니다. 그 화면의 키 조작 · 리롤 ·
  // 건너뛰기 처리를 그대로 물려받는 것이 새로 만드는 것보다 훨씬 작습니다.
  // 후보를 치료 · 대시 둘로 바꾸는 일은 `generateSkillChoices` 가 합니다
  if (challengeWantsStartUtility(w)) w.pendingSkillChoices++;

  // 2번 암전: 사거리 -50% (원문). 시야가 사거리를 따라가므로 이 한 줄이 곧
  // "얼마나 보이는가"까지 정합니다
  if (w.challenge === 'blackout') w.player.stats.range *= CHALLENGE_RULES.blackout.rangeMul;
}

/**
 * 지금 **시작 유틸 선택창**을 띄워야 하는가. 이미 골랐거나 규칙이 없으면 거짓입니다.
 *
 * 참이면 `generateSkillChoices` 가 평소 추첨을 건너뛰고 **유틸 전부**를 후보로 냅니다.
 * 목록을 여기서 안 다루는 이유는 순환 참조 때문입니다. 이 파일이 `skills/registry`
 * 를 들여오면 registry → targeting → challenge 로 고리가 닫힙니다
 */
export function challengeWantsStartUtility(w: World): boolean {
  if (w.challengeStartPicked) return false;
  if (w.challenge === 'shieldMarch') return CHALLENGE_RULES.shieldMarch.startUtilityChoice;
  // 2번 암전은 시작 유틸을 안 줍니다 (`CHALLENGE_RULES.blackout.startUtilityChoice`).
  // 스테이지마다 따로 정하는 값이라 여기서 한꺼번에 켜지 않습니다
  return false;
}

/**
 * 레벨업 선택지에서 유틸을 빼는가 (2026-09-16 사용자 지시).
 *
 * 시작에 한 번 고르고 끝까지 그것으로 버티는 구조라, 시작 선택이 끝난 뒤에는
 * 유틸이 후보에 아예 안 들어갑니다. 교체도 레벨업도 없습니다
 */
export function challengeUtilityLocked(w: World): boolean {
  return w.challenge === 'shieldMarch';
}

/** 매 프레임. `World.update` 가 부릅니다 */
export function updateChallenge(w: World): void {
  const id = w.challenge;
  if (!id) return;

  switch (id) {
    case 'shieldMarch':
      shieldMarch(w);
      break;
    case 'blackout':
      blackout(w);
      break;
    default:
      // 아직 규칙을 안 만든 스테이지. 목록 화면이 입장을 막고 있어서 여기 올 일이 없습니다
      break;
  }

  checkClear(w, id);
}

/**
 * 버티면 그 자리에서 클리어입니다 (2026-09-16 사용자 확정).
 *
 * **`gameOver` 를 안 씁니다.** 그 칸은 "플레이어가 죽었다"는 뜻이고 켜는 순간
 * 파편 연출이 시작됩니다 (`world.ts` 의 `damagePlayer`). 살아남은 판을 그 길로
 * 보내면 화면이 거짓말을 합니다. 그래서 도전 전용 종료 표시를 따로 씁니다.
 *
 * 일반 게임은 클리어해도 판이 안 끝나고 급상승 구간으로 이어지는데, 도전은
 * "버티는 판"이라 끝이 분명한 쪽이 맞습니다
 */
function checkClear(w: World, id: ChallengeStageId): void {
  if (w.cleared) return;
  if (w.time < challengeStage(id).clearTime) return;
  w.cleared = true;
  w.challengeCleared = true;
}

/**
 * 1번 방패 행진.
 *
 * 방패적과 정예 돌진적만 번갈아 나옵니다. 방패는 안 깨지고 방패적은 아주 느린 대신
 * 10초 뒤 스스로 사라집니다. 돌진적은 한 번 돌진하면 사라집니다. 둘 다 사라지는 즉시
 * 같은 종류가 다시 나오므로 화면의 구성은 판 내내 일정합니다.
 *
 * **스스로 죽는 적은 `e.dead = true` 로 지웁니다.** `killEnemy` 를 타면 경험치가
 * 붙는데, 이 판은 적이 끝없이 제풀에 죽고 다시 나오므로 그대로 두면 가만히 서 있어도
 * 경험치가 무한히 들어옵니다. 보상 없이 지우는 이 관례는 무적 바보적을 치울 때
 * 이미 쓰고 있습니다 (`world.ts:392-393`)
 */
function shieldMarch(w: World): void {
  const R = CHALLENGE_RULES.shieldMarch;

  let shields = 0;
  let chargers = 0;

  for (const e of w.enemies) {
    if (e.dead) continue;

    if (e.defId === 'shield') {
      // 수명이 다하면 조용히 사라집니다
      if (w.time - e.spawnTime >= R.shieldLife) {
        e.dead = true;
        w.effects.burst(e.x, e.y, 12, e.def.color, 140, 3, 0.5);
        continue;
      }
      shields++;
      continue;
    }

    if (e.defId === 'charger') {
      // **돌진을 마쳤는가.** `dashes` 는 돌진에 들어가는 순간 오르고(`advanced.ts:118`),
      // phase 2 가 돌진 중입니다. 돌진이 끝나 기절이나 배회로 넘어간 개체를 지웁니다.
      // 이렇게 하면 돌진적 행동 코드를 건드리지 않아도 됩니다
      if (e.dashes >= 1 && e.state.phase !== 2) {
        e.dead = true;
        w.effects.burst(e.x, e.y, 14, e.def.color, 180, 3, 0.5);
        continue;
      }
      chargers++;
      continue;
    }
  }

  // **5초마다 한 마리씩 늡니다** (2026-09-16 사용자 지시).
  //
  // 방패와 돌진을 1:3 으로 나눠 채웁니다. 1 + 3 으로 시작해 **80초에 양쪽이 동시에
  // 상한(방패 5 · 돌진 15)에 닿고**, 남은 10초는 그 밀도를 유지한 채 버팁니다.
  // 예전에는 마릿수가 고정이라 30초만 버티면 그 뒤로 화면이 끝까지 똑같았습니다
  const ticks = Math.floor(w.time / R.spawnStep);
  const shieldTicks = Math.floor(ticks / 4);
  const shieldWant = Math.min(R.shieldAliveMax, R.shieldAliveStart + shieldTicks);
  const chargerWant = Math.min(R.chargerAliveMax, R.chargerAliveStart + (ticks - shieldTicks));

  // 모자란 쪽을 채웁니다. **번갈아 나오게 하려고 따로 순번을 들고 있지 않습니다.**
  // 부족분이 큰 쪽을 먼저 내면 둘이 같은 속도로 줄어들 때 저절로 번갈아 나옵니다.
  // 순번을 상태로 들고 있으면 판 중에 한쪽만 많이 죽었을 때 어긋납니다
  const shieldShort = shieldWant - shields;
  const chargerShort = chargerWant - chargers;
  if (shieldShort <= 0 && chargerShort <= 0) return;

  if (shieldShort >= chargerShort) spawnShield(w);
  else spawnCharger(w);
}

/**
 * 가장자리 한 자리.
 *
 * **`spawner.ts` 의 `randomEdge` 를 쓰지 않고 여기서 따로 만듭니다.** 그쪽을
 * 들여오면 `advanced.ts → challenge.ts → spawner.ts → registry.ts → advanced.ts`
 * 로 순환이 생깁니다. 돌진적 행동이 이 파일에 규칙을 물어보기 때문입니다.
 * 이 파일이 `balance.ts` 만 보게 두면 그 고리가 끊깁니다.
 *
 * 난수를 두 번 뽑는 순서까지 `randomEdge` 와 같게 맞췄습니다
 */
function edgePosition(w: World): { x: number; y: number } {
  const inset = SPAWN.edgeInset;
  switch (w.rng.int(0, 4)) {
    case 0:
      return { x: w.rng.range(inset, CANVAS.w - inset), y: inset };
    case 1:
      return { x: CANVAS.w - inset, y: w.rng.range(inset, CANVAS.h - inset) };
    case 2:
      return { x: w.rng.range(inset, CANVAS.w - inset), y: CANVAS.h - inset };
    default:
      return { x: inset, y: w.rng.range(inset, CANVAS.h - inset) };
  }
}

/**
 * 2번 암전.
 *
 * 겁쟁이적과 자폭적만 나옵니다. 둘 다 한 번 역할을 하면 사라지고 곧바로 다시
 * 나옵니다. 겁쟁이적은 돌진을 마치면, 자폭적은 터지면 끝입니다 (자폭은 원래
 * 스스로 죽으므로 따로 처리할 것이 없습니다).
 *
 * 화면을 어둡게 만드는 일은 그리기 쪽(`render/scene.ts`)이 `challengeVisionRadius`
 * 를 보고 합니다. 판의 규칙과 보이는 것을 한 곳에 섞지 않습니다
 */
function blackout(w: World): void {
  const R = CHALLENGE_RULES.blackout;

  blackoutBombing(w);

  // **겁쟁이적은 돌진해도 안 죽습니다** (2026-09-17 사용자 지시). 1차 설계 원문의
  // "겁쟁이적이 돌진 후 사망"을 뺀 자리입니다. 대신 인내가 끝나면 수명이 붙습니다
  const patience = R.cowardPatience;
  const rageAll = w.time >= R.cowardEnrageAllTime;

  let alive = 0;
  for (const e of w.enemies) {
    if (e.dead) continue;
    alive++;
    if (e.defId !== 'coward') continue;

    // 막바지에는 남아 있는 것에 한꺼번에 불을 붙입니다. 새로 나오는 것도 여기 걸려
    // 나오자마자 달려듭니다 (`cowardEnrageAllTime`)
    if (rageAll && e.state.timer3 < patience) e.state.timer3 = patience;

    // **인내가 끝난 뒤 5초.** 그 시점부터 세는 것이 아니라 살아온 시간에서 빼서
    // 봅니다. 강제로 불을 붙인 개체도 그 순간이 기준이 되므로 계산이 같습니다
    if (e.state.timer3 >= patience + R.cowardEnragedLife) {
      // **처치와 같은 판정입니다** (2026-09-17 사용자 지시). 경험치 · 처치 수 ·
      // 도감이 전부 붙습니다. `e.dead = true` 로 조용히 지우던 방식과 다른 점이라,
      // 이 판에서는 못 잡은 겁쟁이도 결국 내 성과가 됩니다
      w.killEnemy(e);
      alive--;
    }
  }

  // **초당 정해진 마릿수를 냅니다** (2026-09-17 사용자 지시). 유지할 마릿수를 정해
  // 놓고 죽은 만큼 채우던 방식에서 바뀌었습니다
  const due = Math.floor(w.time * R.spawnPerSecond);
  while (w.challengeState.spawned < due) {
    w.challengeState.spawned++;
    if (alive >= R.maxAlive) continue;
    alive++;
    const pos = edgePosition(w);
    // 3 : 7 로 섞습니다. 번갈아 내지 않는 이유는 어느 쪽이 올지 세면서 기다리는
    // 판이 되지 않게 하기 위해서입니다
    if (w.rng.chance(R.bomberRatio)) w.spawnEnemy('bomber', pos.x, pos.y, {});
    else w.spawnEnemy('coward', pos.x, pos.y, { hpMul: R.cowardHpMul });
  }
}

/**
 * **5초마다 내가 서 있던 자리에 폭격이 떨어집니다** (2026-09-17 사용자 지시).
 *
 * 어둠 속에서는 가만히 서 있는 것이 최선이 됩니다. 움직이면 안 보이는 적에게 걸어
 * 들어가는 셈이라, 자리를 지키고 들어오는 것만 처리하는 쪽이 늘 안전했습니다.
 * 그 수를 깨는 장치입니다.
 *
 * **예고를 찍는 순간의 자리**에 떨어집니다. 따라오지 않으므로 한 걸음 옮기면
 * 피합니다. 쫓아오게 만들면 피할 수가 없어서 "가만히 있지 마라"가 아니라
 * "계속 뛰어라"가 되고, 그건 어둠에서 적에게 걸어 들어가라는 말과 같습니다.
 *
 * 적은 안 맞습니다 (`hitsAll` 없음). 맞으면 폭격 자리로 적을 끌고 가는 것이
 * 이득이 되어, 방해 장치가 도구로 뒤집힙니다
 */
function blackoutBombing(w: World): void {
  const R = CHALLENGE_RULES.blackout;
  // **지나간 시간에서 회차를 셉니다.** 남은 시간을 빼는 방식은 프레임 간격에
  // 기대는데, 디버그 맵에서 시간을 건너뛰면 그 사이의 회차가 통째로 사라집니다
  const due = Math.floor(w.time / R.bombInterval);
  if (due <= w.challengeState.bombs) return;
  w.challengeState.bombs = due;

  const { x, y } = w.player;
  w.addTelegraph({
    kind: 'incoming',
    x,
    y,
    radius: R.bombRadius,
    life: R.bombTelegraph,
    color: '#ffcc55',
    clipToVision: true,
  });
  w.addPendingBlast({
    x,
    y,
    radius: R.bombRadius,
    damage: R.bombDamage,
    delay: R.bombTelegraph,
    color: '#ffcc55',
    source: BOMB_KILLER,
  });
}

/**
 * 시야 반경. 0 이면 어둠 규칙이 없는 판입니다 (2026-09-16).
 *
 * **그리기 쪽만 씁니다.** 이 값 밖의 적 · 적탄 · 장판 · 코인 · **예고**가 안 그려집니다.
 * 예고까지 묻는 것은 사용자가 (나)안을 고른 결과이고, 이는 결정 14 를 뒤집습니다.
 * 판정은 그대로라 안 보여도 맞습니다
 */
export function challengeVisionRadius(w: World): number {
  if (w.challenge !== 'blackout') return 0;
  return w.player.stats.range * CHALLENGE_RULES.blackout.visionMul;
}

/**
 * 이 스탯이 **이 판의 레벨업 추첨에서 빠지는가** (2026-09-16 사용자 지시).
 *
 * 2번 암전은 사거리를 뺍니다. 시야가 사거리를 그대로 따라가므로, 사거리가 오르면
 * 판이 진행될수록 어둠이 걷혀서 "안 보이는 판"이라는 전제가 스스로 무너집니다.
 *
 * **지정 칸 추첨(`rollDesignated`)은 안 봐도 됩니다.** 도전 판은 상점 패시브가
 * 통째로 꺼진 저장본으로 열려서 그쪽은 애초에 아무것도 안 뽑습니다
 */
export function challengeStatBlocked(w: World, key: StatKey): boolean {
  if (w.challenge !== 'blackout') return false;
  return (CHALLENGE_RULES.blackout.blockedStats as readonly string[]).includes(key);
}

/** 점화된 자폭적의 이동속도 배율. 규칙이 없으면 null 이라 평소 값을 씁니다 */
export function challengeIgniteSpeedMul(w: World): number | null {
  return w.challenge === 'blackout' ? CHALLENGE_RULES.blackout.igniteSpeedMul : null;
}

/**
 * 인내가 끝난 겁쟁이적의 돌진 속도 배수. 규칙이 없는 판은 1 입니다 (2026-09-17).
 *
 * **인내가 끝난 개체에만 걸립니다.** 거리를 보고 달려드는 평소 돌진은 그대로입니다
 */
export function challengeCowardEnragedDashMul(w: World): number {
  return w.challenge === 'blackout' ? CHALLENGE_RULES.blackout.cowardEnragedDashMul : 1;
}

/** 겁쟁이적의 인내 시간(초). 규칙이 없으면 null 이라 평소 값을 씁니다 (2026-09-17) */
export function challengeCowardPatience(w: World): number | null {
  return w.challenge === 'blackout' ? CHALLENGE_RULES.blackout.cowardPatience : null;
}

/**
 * **이 적이 지금 어둠에 묻혀 있는가** (2026-09-17 사용자 지시).
 *
 * 참이면 플레이어의 공격이 아예 안 들어갑니다 (`World.damageEnemy`). 타겟팅만
 * 막아서는 부족했습니다. 레이저 · 오라 · 장판 · 폭발처럼 **자리로 때리는 공격**은
 * 겨누는 과정이 없어서 시야 밖 적을 그대로 맞혔고, 그래서 어둠 너머가 저절로
 * 정리되고 있었습니다.
 *
 * **적이 낸 피해는 이 검사를 안 탑니다** (`DamageOptions.fromEnemy`). 자폭적의
 * 시체 폭발이 옆의 적을 정리하는 것은 내 공격이 아니라 판이 하는 일입니다
 */
export function challengeHiddenFromPlayer(w: World, e: Enemy): boolean {
  const vision = challengeVisionRadius(w);
  if (vision <= 0) return false;
  return dist(e.x, e.y, w.player.x, w.player.y) > vision;
}

function spawnShield(w: World): void {
  const pos = edgePosition(w);
  const e = w.spawnEnemy('shield', pos.x, pos.y, { hpMul: CHALLENGE_RULES.shieldMarch.shieldHpMul });
  // 원문의 "이속 -70%". 스폰 직후 개체에 곱합니다
  e.speed *= CHALLENGE_RULES.shieldMarch.shieldSpeedMul;
}

/**
 * 정예 돌진적을 냅니다 (2026-09-16 사용자 지시 반영).
 *
 * **다른 적과 똑같이 가장자리에서 냅니다.** 한때 경기장 안쪽에 냈는데, 벽 근처
 * 예외를 피하려던 것이었지만 사용자가 가장자리 스폰을 원해서 되돌렸습니다.
 * 대신 그 예외 자체를 이 스테이지에서 끕니다 (`chargerIgnoresWall`).
 *
 * **쿨타임을 0 으로 둡니다.** 배회 단계(phase 0)는 `timer2` 가 다 돌아야 예고로
 * 넘어가는데, 0 이면 첫 프레임에 곧바로 준비에 들어갑니다.
 *
 * **체력은 평타 몇 대로 직접 잡습니다.** `rollDamage` 가 평타를 `stats.attack x 1`
 * 로 내므로(`skills/registry.ts:18-22`) 그 배수를 그대로 씁니다. 고정 숫자로 박으면
 * 레벨업으로 공격력이 오른 뒤에는 한 대에 죽습니다. 치명타가 뜨면 한 대에 죽는데,
 * 그건 치명타가 하는 일이라 그대로 둡니다
 */
function spawnCharger(w: World): void {
  const R = CHALLENGE_RULES.shieldMarch;
  const pos = edgePosition(w);
  const e = w.spawnEnemy('charger', pos.x, pos.y, { elite: true });
  e.state.timer2 = 0;
  e.maxHp = w.player.stats.attack * R.chargerHitsToKill;
  e.hp = e.maxHp;
  e.damage = R.chargerDamage;
}

/**
 * 이 판에서 방패가 안 깨지는가.
 *
 * `World.damageEnemy` 가 방패 내구도를 깎기 직전에 묻습니다. 참이면 피해는 그대로
 * 막히되 내구도가 안 줄어듭니다
 */
export function shieldUnbreakable(w: World): boolean {
  return w.challenge === 'shieldMarch';
}

/**
 * 돌진적이 벽 근처에서도 곧바로 예고를 시작하는가 (2026-09-16 사용자 지시).
 *
 * 평소에는 벽에서 `wallClearance` 만큼 떨어질 때까지 가운데로 걸어 나온 뒤에야
 * 준비에 들어갑니다. 가장자리에서 나오는 이 스테이지에서는 그러면 "바로 준비"가
 * 성립하지 않아서 끕니다
 */
export function chargerIgnoresWall(w: World): boolean {
  return w.challenge === 'shieldMarch';
}

/**
 * 이 스테이지에서 **도발하는 적의 종류** (2026-09-16 사용자 지시).
 *
 * 그 종류가 살아 있는 동안에는 **스킬이** 그쪽으로만 조준합니다. 방패 행진은
 * 방패적이 도발합니다.
 *
 * **기본공격은 면역입니다** (2026-09-16 사용자 지시). 기본공격까지 묶이면 방패적이
 * 사거리에 있는 동안 플레이어가 할 수 있는 일이 하나도 없습니다. 도발을 무시하는
 * 곳은 `player.ts` 의 기본공격 한 곳뿐이고, 유도탄 재조준을 포함한 스킬 전부와
 * 도탄의 피해 판정은 그대로 도발을 따릅니다
 *
 * **조준에만 걸고 피해 판정에는 안 겁니다.** `canTarget` 을 건드리면 도탄의
 * 피해 대상 선택(`projectile.ts` 의 `hitRicochet`)까지 같이 바뀌어서, 날아가던
 * 탄이 돌진적을 그냥 통과합니다. 도발은 "어디를 겨누는가"이지 무적이 아닙니다
 */
export function challengeTauntId(w: World): EnemyId | null {
  return w.challenge === 'shieldMarch' ? 'shield' : null;
}

/**
 * 이 적이 **맞은 횟수로 죽는가.** 0 이면 평소대로 체력으로 죽습니다 (2026-09-16).
 *
 * 방패 행진의 돌진적은 피해량과 무관하게 정해진 횟수를 맞으면 죽습니다.
 * 99 를 두 번 맞아도, 1 을 두 번 맞아도 같습니다
 */
export function challengeHitKill(w: World, e: Enemy): number {
  if (w.challenge !== 'shieldMarch' || e.defId !== 'charger') return 0;
  return CHALLENGE_RULES.shieldMarch.chargerHitsToKill;
}

/**
 * 이 적이 화상의 지속 피해에 면역인가 (2026-09-16 사용자 지시).
 *
 * 두 대면 죽는 적이라, 화상이 붙는 순간 손 안 대고 죽는 것과 같아집니다.
 * 횟수에 안 세는 것만으로는 부족하고 체력 피해까지 막아야 합니다
 */
export function challengeBurnImmune(w: World, e: Enemy): boolean {
  return challengeHitKill(w, e) > 0;
}

/** 돌진 속도 배율. 도전 스테이지가 아니면 1 입니다 */
export function chargerDashSpeedMul(w: World): number {
  return w.challenge === 'shieldMarch' ? CHALLENGE_RULES.shieldMarch.chargerDashSpeedMul : 1;
}

/**
 * 레벨업에서 오를 스탯을 스테이지가 못박는가 (2026-09-16 사용자 지시).
 *
 * null 이면 평소대로 서로 다른 스탯 둘을 추첨합니다. 값이 있으면 그 스탯 하나만
 * 그만큼 오릅니다. 방패 행진은 40마리 사이를 빠져나가는 판이라 성장이 곧
 * 기동성이어야 해서 이동속도로 고정합니다
 */
export function challengeStatOverride(w: World): { key: StatKey; step: number } | null {
  if (w.challenge !== 'shieldMarch') return null;
  return { key: 'moveSpeed', step: CHALLENGE_RULES.shieldMarch.levelMoveSpeedStep };
}
