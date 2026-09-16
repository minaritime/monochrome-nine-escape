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

export function challengeStage(id: ChallengeStageId): ChallengeStageDef {
  const def = CHALLENGE_STAGES.find((s) => s.id === id);
  if (!def) throw new Error(`도전 스테이지를 찾을 수 없습니다: ${id}`);
  return def;
}

/**
 * 판이 시작될 때 한 번.
 *
 * **평소 스폰 표를 통째로 끕니다.** 스테이지가 무엇을 낼지 직접 정하기 때문입니다.
 * `Spawner.enabled` 를 끄면 잡몹 · 웨이브 · 보스가 전부 멈춥니다 (`spawner.ts:50·129`)
 */
export function startChallenge(w: World): void {
  if (!w.challenge) return;
  w.spawner.enabled = false;
}

/** 매 프레임. `World.update` 가 부릅니다 */
export function updateChallenge(w: World): void {
  const id = w.challenge;
  if (!id) return;

  switch (id) {
    case 'shieldMarch':
      shieldMarch(w);
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
  // 방패와 돌진을 1:3 으로 나눠 채웁니다. 1 + 3 으로 시작해 180초에 10 + 30 이
  // 되고, 36번 늘어 정확히 상한에 닿습니다. 예전에는 고정이라 30초만 버티면
  // 그 뒤로 화면이 끝까지 똑같았습니다
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
 * 그 종류가 살아 있는 동안에는 기본공격과 스킬이 전부 그쪽으로만 조준합니다.
 * 방패 행진은 방패적이 도발합니다.
 *
 * **조준에만 걸고 피해 판정에는 안 겁니다.** `canTarget` 을 건드리면 도탄의
 * 피해 대상 선택(`projectile.ts` 의 `hitRicochet`)까지 같이 바뀌어서, 날아가던
 * 탄이 돌진적을 그냥 통과합니다. 도발은 "어디를 겨누는가"이지 무적이 아닙니다
 */
export function challengeTauntId(w: World): EnemyId | null {
  return w.challenge === 'shieldMarch' ? 'shield' : null;
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
