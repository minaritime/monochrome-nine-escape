import {
  ALL_BOSS_IDS,
  BOSS,
  BOSS_BOMBARD,
  BOSS_BOMBARD_HARD,
  BOSS_PREDATOR,
  BOSS_PREDATOR_HARD,
  BOSS_SWARM,
  CANVAS,
  ENEMY_BULLET,
  type BossId,
} from '../data/balance';
import { angleTo, clamp, dist } from '../core/math';
import { moveToward, stopMoving } from './behaviors/movement';
import { killerOf } from '../game/killer';
import type { BossSweep, Enemy } from '../game/types';
import type { World } from '../game/world';
import type { EnemyBehavior, EnemyDef } from './types';

/**
 * 보스 3종.
 *
 * 셋 다 등장 연출(화면 안으로 걸어 들어오는 phase 0)을 공유하고, 그 뒤 패턴이 갈립니다.
 * 종류별 수치는 data/balance.ts 의 BOSS_VARIANTS · BOSS_BOMBARD · BOSS_SWARM 에 있습니다.
 */

/** 등장 연출. 아직 화면 위쪽이면 true 를 돌려주고 행동을 넘깁니다 */
function entering(e: Enemy): boolean {
  if (e.state.phase === 0 && e.y < 110) {
    moveToward(e, CANVAS.w / 2, 140, 2.2);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 1. 포식자: 근접 위주. 짧은 예고로 계속 돌진하고 멈추는 자리에 충격파를 냅니다.
//    탄막은 가끔만 씁니다. 붙지 않고 거리를 유지하는 것이 대응입니다.
//
//    하드 1 부터는 **거대 포식자**가 됩니다. 몸통 접촉이 x5 가 되고 돌진이 두 배로
//    빨라지며, 돌진 세 번마다 한 번은 특수 패턴(절반 훑기 → 낙하 → 기절)을 씁니다.
//    수치와 규칙은 `BOSS_PREDATOR_HARD` 에 있습니다.
// ---------------------------------------------------------------------------

/** 하드 1 의 돌진 속도. 일반과 거대 포식자가 다릅니다 */
function chargeSpeedMul(w: World): number {
  return w.diff.bossPredatorHard ? BOSS_PREDATOR_HARD.chargeSpeedMul : BOSS_PREDATOR.chargeSpeedMul;
}

/** 슬램 충격파 반경. 몸이 커진 만큼 같이 넓힙니다 */
function slamRadius(w: World): number {
  return w.diff.bossPredatorHard ? BOSS_PREDATOR_HARD.slamRadius : BOSS_PREDATOR.slamRadius;
}

const predatorBehavior: EnemyBehavior = (e, w, dt) => {
  if (entering(e)) return;

  const P = BOSS_PREDATOR;
  const p = w.player;

  switch (e.state.phase) {
    case 1: {
      // 돌진 예고
      stopMoving(e);
      e.state.timer -= dt;
      if (e.state.timer <= 0) {
        e.state.phase = 2;
        e.state.timer = P.chargeTime;
        w.effects.addShake(6);
      }
      return;
    }
    case 2: {
      // 돌진
      e.state.timer -= dt;
      const mul = chargeSpeedMul(w);
      e.vx = Math.cos(e.state.angle) * e.speed * mul;
      e.vy = Math.sin(e.state.angle) * e.speed * mul;
      const m = e.radius + 2;
      const hitWall =
        (e.x <= m && e.vx < 0) ||
        (e.x >= CANVAS.w - m && e.vx > 0) ||
        (e.y <= m && e.vy < 0) ||
        (e.y >= CANVAS.h - m && e.vy > 0);
      if (e.state.timer <= 0 || hitWall) {
        // 멈추는 자리에 충격파. 돌진 경로를 피해도 착지점에 서 있으면 맞습니다.
        // **`contactMul` 을 안 곱합니다.** 거대 포식자는 몸통만 치명적입니다
        w.explode(e.x, e.y, slamRadius(w), e.damage * P.slamDamageMul, false, e.def.color, killerOf(e));
        e.state.phase = 3;
        e.state.timer2 = P.chargeInterval;
        if (hitWall) w.effects.addShake(10);
      }
      return;
    }
    case PHASE_EXIT:
    case PHASE_SWEEP_TELE:
    case PHASE_SWEEP:
    case PHASE_FALL_TELE:
    case PHASE_STUN:
      predatorSpecial(e, w, dt);
      return;
    default:
      break;
  }

  e.state.phase = 3;
  moveToward(e, p.x, p.y);

  // 방사형 탄막 (드물게)
  e.state.timer -= dt;
  if (e.state.timer <= 0) {
    e.state.timer = P.burstInterval;
    radialBurst(e, w, P.burstCount, w.rng.angle(), BOSS.burstSpeed, BOSS.burstDamage);
  }

  // 돌진 준비
  e.state.timer2 -= dt;
  if (e.state.timer2 <= 0) {
    // 하드 1: 돌진 세 번 중 세 번째는 돌진 대신 특수 패턴입니다.
    // `dashes` 를 세는 이유는 예고만 하고 끝난 경우까지 세면 주기가 흔들려서입니다
    if (w.diff.bossPredatorHard) {
      e.dashes++;
      if (e.dashes % BOSS_PREDATOR_HARD.specialEveryCharges === 0) {
        startPredatorSpecial(e, w);
        return;
      }
    }
    e.state.phase = 1;
    e.state.timer = P.chargeTelegraph;
    e.state.angle = angleTo(e.x, e.y, p.x, p.y);
    const far = Math.hypot(CANVAS.w, CANVAS.h);
    w.addTelegraph({
      kind: 'line',
      x: e.x,
      y: e.y,
      x2: e.x + Math.cos(e.state.angle) * far,
      y2: e.y + Math.sin(e.state.angle) * far,
      width: e.radius * 2,
      life: P.chargeTelegraph,
      color: e.def.color,
      owner: e.id,
    });
    return;
  }

  // 잡몹 소환
  e.state.timer3 -= dt;
  if (e.state.timer3 <= 0) {
    e.state.timer3 = P.summonInterval;
    summonAround(e, w, P.summonCount);
  }
};

// --- 하드 1: 거대 포식자의 특수 패턴 ----------------------------------------
//
// 이탈 → 절반 훑기 x2 → 낙하 → 기절. 자세한 설계 근거는 `BOSS_PREDATOR_HARD` 주석에
// 있습니다. 여기서는 순서만 다룹니다.

const PHASE_EXIT = 10;
const PHASE_SWEEP_TELE = 11;
const PHASE_SWEEP = 12;
const PHASE_FALL_TELE = 13;
const PHASE_STUN = 14;

/**
 * 화면 밖으로 물러난 상태.
 *
 * **몸을 캔버스 밖에 둡니다.** 자리에 남겨두고 안 보이게만 하면 보이지도 않는 보스에
 * 몸이 닿아 죽습니다. 무적은 카운트다운이라 매 프레임 다시 채웁니다.
 */
function hideOffscreen(e: Enemy): void {
  e.x = CANVAS.w / 2;
  e.y = -CANVAS.h;
  e.vx = 0;
  e.vy = 0;
  e.alpha = 0;
  // 화면 밖의 무적 대상을 자동 조준이 물면 그동안 나가는 화력이 통째로 버려집니다.
  // 조준 조작이 없어서 플레이어가 대상을 바꿀 방법도 없습니다
  e.targetable = false;
  e.invuln = 0.2;
}

/** 이번 훑기가 덮는 절반의 크기와 중심 */
function sweepGeometry(sweep: BossSweep): { halfW: number; halfH: number; cx: number; cy: number } {
  const half = BOSS_PREDATOR_HARD.sweepThickness / 2;
  if (sweep.axis === 'lr') {
    // 좌/우 절반을 세로로 훑습니다. 벽이 절반의 가로 폭을 통째로 덮습니다
    return {
      halfW: CANVAS.w / 4,
      halfH: half,
      cx: sweep.side === 0 ? CANVAS.w / 4 : (CANVAS.w * 3) / 4,
      cy: 0,
    };
  }
  return {
    halfW: half,
    halfH: CANVAS.h / 4,
    cx: 0,
    cy: sweep.side === 0 ? CANVAS.h / 4 : (CANVAS.h * 3) / 4,
  };
}

function startPredatorSpecial(e: Enemy, w: World): void {
  e.state.phase = PHASE_EXIT;
  e.state.timer = BOSS_PREDATOR_HARD.exitTime;
  // 아직 1차입니다. 2차로 넘어갈 때 true 가 됩니다
  e.state.flag = false;
  e.sweep = {
    axis: w.rng.chance(0.5) ? 'lr' : 'tb',
    side: w.rng.chance(0.5) ? 0 : 1,
    dir: w.rng.chance(0.5) ? 1 : -1,
    active: false,
    halfW: 0,
    halfH: 0,
  };
  stopMoving(e);
  w.effects.addShake(8);
}

/** 위험한 절반을 진행 방향으로 채우는 예고를 띄웁니다 */
function beginSweepTelegraph(e: Enemy, w: World): void {
  const H = BOSS_PREDATOR_HARD;
  const s = e.sweep;
  if (!s) return;
  s.active = false;
  e.state.phase = PHASE_SWEEP_TELE;
  e.state.timer = H.sweepTelegraph;
  hideOffscreen(e);

  const g = sweepGeometry(s);
  const horiz = s.axis === 'tb';
  w.addTelegraph({
    kind: 'sweep',
    x: horiz ? (s.dir > 0 ? 0 : CANVAS.w) : g.cx,
    y: horiz ? g.cy : s.dir > 0 ? 0 : CANVAS.h,
    x2: horiz ? (s.dir > 0 ? CANVAS.w : 0) : g.cx,
    y2: horiz ? g.cy : s.dir > 0 ? CANVAS.h : 0,
    width: horiz ? CANVAS.h / 2 : CANVAS.w / 2,
    life: H.sweepTelegraph,
    color: e.def.color,
    owner: e.id,
  });
}

function beginSweep(e: Enemy, w: World): void {
  const H = BOSS_PREDATOR_HARD;
  const s = e.sweep;
  if (!s) return;
  const g = sweepGeometry(s);
  s.halfW = g.halfW;
  s.halfH = g.halfH;
  s.active = true;
  e.state.phase = PHASE_SWEEP;
  e.alpha = 1;
  // 훑는 동안은 무적이 아닙니다. 다만 초당 2400 이라 자동 조준으로 맞추기는 어렵고
  // 실질적인 딜 타임은 패턴 끝의 기절 3초입니다
  e.targetable = true;
  e.invuln = 0;
  if (s.axis === 'lr') {
    e.x = g.cx;
    e.y = s.dir > 0 ? -g.halfH : CANVAS.h + g.halfH;
    e.vx = 0;
    e.vy = s.dir * H.sweepSpeed;
  } else {
    e.y = g.cy;
    e.x = s.dir > 0 ? -g.halfW : CANVAS.w + g.halfW;
    e.vx = s.dir * H.sweepSpeed;
    e.vy = 0;
  }
  w.effects.addShake(10);
}

/** 벽이 경기장을 완전히 지나갔는가 */
function sweepFinished(e: Enemy): boolean {
  const s = e.sweep;
  if (!s) return true;
  if (s.axis === 'lr') {
    return s.dir > 0 ? e.y > CANVAS.h + s.halfH : e.y < -s.halfH;
  }
  return s.dir > 0 ? e.x > CANVAS.w + s.halfW : e.x < -s.halfW;
}

/** 벽은 원이 아니라 사각형입니다. 격자 질의로는 안 잡히므로 여기서 직접 봅니다 */
function sweepHitsPlayer(e: Enemy, w: World): boolean {
  const s = e.sweep;
  if (!s || !s.active) return false;
  const p = w.player;
  return (
    Math.abs(p.x - e.x) < s.halfW + p.radius && Math.abs(p.y - e.y) < s.halfH + p.radius
  );
}

function beginFallTelegraph(e: Enemy, w: World): void {
  const H = BOSS_PREDATOR_HARD;
  e.state.phase = PHASE_FALL_TELE;
  e.state.timer = H.fallTelegraph;
  hideOffscreen(e);
  if (e.sweep) e.sweep.active = false;

  // **떨어질 자리는 예고가 뜨는 순간의 플레이어 자리로 굳힙니다.**
  // 끝까지 따라오면 피할 방법이 아예 없어집니다 (폭격기의 firstShotOnPlayer 와 같은 규칙)
  e.state.targetX = w.player.x;
  e.state.targetY = w.player.y;
  w.addTelegraph({
    kind: 'incoming',
    x: e.state.targetX,
    y: e.state.targetY,
    radius: H.fallRadius,
    life: H.fallTelegraph,
    color: e.def.color,
    owner: e.id,
  });
}

/** 예고가 다 찬 순간. 떨어지는 연출 없이 그 자리에 즉시 나타나 즉시 때립니다 */
function landFall(e: Enemy, w: World): void {
  const H = BOSS_PREDATOR_HARD;
  e.sweep = null;
  e.state.phase = PHASE_STUN;
  e.state.timer = H.stunTime;
  e.x = e.state.targetX;
  e.y = e.state.targetY;
  e.vx = 0;
  e.vy = 0;
  e.alpha = 1;
  e.targetable = true;
  e.invuln = 0;
  // **몸통 접촉 피해의 두 배입니다.** 폭발이지만 규칙은 접촉을 그대로 따라갑니다
  // (몸이 떨어져 깔리는 것이라 성질이 접촉입니다). 그래서 난이도의 접촉 배율도
  // 같이 곱합니다. 탄·장판처럼 `damageMul` 만 타면 "접촉 x2" 라는 약속이 어긋납니다
  w.explode(
    e.x,
    e.y,
    H.fallRadius,
    e.damage * e.contactMul * w.diff.contactDamageMul * H.fallDamageMul,
    false,
    e.def.color,
    killerOf(e),
  );
  w.effects.addShake(18);
}

function predatorSpecial(e: Enemy, w: World, dt: number): void {
  // 하드 규칙이 꺼진 채로 이 단계에 남아 있으면 평소 행동으로 돌려보냅니다
  if (!e.sweep && e.state.phase !== PHASE_STUN) {
    e.state.phase = 3;
    return;
  }

  e.state.timer -= dt;

  switch (e.state.phase) {
    case PHASE_EXIT: {
      // 몸이 옅어지며 물러납니다. 아직 자리에 있으므로 몸통 접촉은 그대로입니다
      stopMoving(e);
      e.alpha = Math.max(0, e.state.timer / BOSS_PREDATOR_HARD.exitTime);
      e.targetable = false;
      e.invuln = 0.2;
      if (e.state.timer <= 0) beginSweepTelegraph(e, w);
      return;
    }
    case PHASE_SWEEP_TELE: {
      hideOffscreen(e);
      if (e.state.timer <= 0) beginSweep(e, w);
      return;
    }
    case PHASE_SWEEP: {
      if (sweepHitsPlayer(e, w)) {
        w.damagePlayer(e.damage * e.contactMul * w.diff.contactDamageMul, false, killerOf(e));
      }
      if (!sweepFinished(e)) return;
      const s = e.sweep;
      if (s && !e.state.flag) {
        // 2차는 **반드시 반대편 절반**입니다. 여기를 무작위로 바꾸면 배울 것이
        // 없는 패턴이 됩니다 (1차가 어느 쪽인지는 이미 무작위입니다)
        e.state.flag = true;
        s.side = s.side === 0 ? 1 : 0;
        s.dir = w.rng.chance(0.5) ? 1 : -1;
        beginSweepTelegraph(e, w);
      } else {
        beginFallTelegraph(e, w);
      }
      return;
    }
    case PHASE_FALL_TELE: {
      hideOffscreen(e);
      if (e.state.timer <= 0) landFall(e, w);
      return;
    }
    case PHASE_STUN: {
      stopMoving(e);
      if (e.state.timer <= 0) {
        e.state.phase = 3;
        e.state.timer2 = BOSS_PREDATOR.chargeInterval;
      }
      return;
    }
    default:
      e.state.phase = 3;
  }
}

// ---------------------------------------------------------------------------
// 2. 폭격기: 탄막 위주. 바닥 폭격으로 자리를 뺏고, 옮기는 동안 맞을 탄을 뿌립니다.
//    폭격만 있으면 "옮기면 끝"이라 셋 중 가장 단조로웠습니다.
// ---------------------------------------------------------------------------
const bombardBehavior: EnemyBehavior = (e, w, dt) => {
  if (entering(e)) return;

  const B = BOSS_BOMBARD;
  e.state.phase = 3;
  moveToward(e, w.player.x, w.player.y);

  // 사방 탄막. 한 번 걸러 각도를 반 칸 어긋나게 쏴서 같은 자리로 계속 피할 수 없게 합니다
  e.state.timer2 -= dt;
  if (e.state.timer2 <= 0) {
    e.state.timer2 = B.burstInterval;
    e.state.flag = !e.state.flag;
    const offset = B.burstOffsetAlternate && e.state.flag ? Math.PI / B.burstCount : 0;
    radialBurst(e, w, B.burstCount, offset, BOSS.burstSpeed, BOSS.burstDamage);
  }

  // 플레이어를 정조준하는 빠른 세 갈래
  e.state.timer3 -= dt;
  if (e.state.timer3 <= 0) {
    e.state.timer3 = B.aimedInterval;
    const base = angleTo(e.x, e.y, w.player.x, w.player.y);
    for (let i = 0; i < B.aimedCount; i++) {
      const a = base + (i - (B.aimedCount - 1) / 2) * B.aimedSpread;
      shoot(e, w, a, BOSS.burstSpeed * B.aimedSpeedMul, BOSS.burstDamage, 6);
    }
    w.effects.spray(e.x, e.y, base, 0.3, 8, ENEMY_BULLET.glow, 160);
  }

  // 하드 4 부터는 폭격이 두 배로 늘고, 넓게 흩어지고, 간격이 벌어지고,
  // 적에게도 들어가고, 터진 자리에 착화지점을 남깁니다. 표는 BOSS_BOMBARD_HARD 입니다
  const H = w.diff.bossBombardHard ? BOSS_BOMBARD_HARD : null;

  e.state.timer -= dt;
  if (e.state.timer > 0) return;
  e.state.timer = B.volleyInterval * (H ? H.volleyIntervalMul : 1);

  const shots = H ? H.shots : B.shots;
  const spread = H ? H.spread : B.spread;
  // 착화지점은 폭발이 아니라 폭발이 끝난 자리에 남는 불입니다.
  // 자리는 폭발과 같으므로 예약에 실어 보내고 world 가 터질 때 깝니다
  const scorch = H
    ? {
        radius: B.blastRadius * H.scorchRadiusMul,
        duration: H.scorchDuration,
        arm: H.scorchArm,
        tickInterval: H.scorchTickInterval,
        tickDamage: e.damage * H.scorchTickMul,
        color: e.def.color,
      }
    : null;

  for (let i = 0; i < shots; i++) {
    // 첫 발은 지금 서 있는 자리입니다. 가만히 있으면 반드시 맞습니다
    const onPlayer = i === 0 && B.firstShotOnPlayer;
    const a = w.rng.angle();
    const d = onPlayer ? 0 : w.rng.range(40, spread);
    const x = clamp(w.player.x + Math.cos(a) * d, 30, CANVAS.w - 30);
    const y = clamp(w.player.y + Math.sin(a) * d, 30, CANVAS.h - 30);

    w.addTelegraph({
      kind: 'incoming',
      x,
      y,
      radius: B.blastRadius,
      life: B.warning,
      color: e.def.color,
    });
    w.addPendingBlast({
      x,
      y,
      radius: B.blastRadius,
      damage: e.damage * B.blastDamageMul,
      delay: B.warning,
      color: e.def.accent,
      source: killerOf(e),
      // 적에게도 들어가되 그 처치에는 보상이 없습니다. 보스는 아예 안 맞습니다
      hitsAll: H ? H.hitsEnemies : undefined,
      noReward: H ? true : undefined,
      scorch,
    });
  }

  w.effects.burst(e.x, e.y, 14, e.def.accent, 150, 3, 0.4);
  w.effects.addShake(4);
};

// ---------------------------------------------------------------------------
// 3. 군체왕: 잡몹 위주. 근접도 탄막도 약한 대신 화면의 잡몹 수가 곧 이 보스의 세기입니다.
//    잡몹이 쌓이면 나선 갈래가 늘고, 일정 수를 넘기면 삼켜서 대형 탄막으로 뱉습니다.
//    체력 절반에서 한 번, 무적이 되며 자기 자리에 잡몹을 쏟아냅니다.
// ---------------------------------------------------------------------------
const swarmBehavior: EnemyBehavior = (e, w, dt) => {
  if (entering(e)) return;

  const S = BOSS_SWARM;
  const minions = countMinions(w);

  // 분노: 체력 절반에서 한 번만. 무적인 동안 잡몹이 쏟아지므로 스킬이 전부 터집니다
  if (!e.state.flag && e.hp <= e.maxHp * S.enrageHpRatio) {
    e.state.flag = true;
    e.invuln = S.enrageInvuln;
    summonAround(e, w, S.enrageSummonCount);
    w.effects.burst(e.x, e.y, 40, e.def.color, 280, 5, 0.8);
    w.effects.addShake(14);
    w.effects.text(e.x, e.y - e.radius - 20, '군체 소집', e.def.accent, 22);
  }

  // 삼키기 예고 중에는 멈춰 있습니다
  if (e.state.phase === 4) {
    stopMoving(e);
    e.state.timer2 -= dt;
    if (e.state.timer2 <= 0) {
      devour(e, w);
      e.state.phase = 3;
      e.state.timer2 = S.devourInterval;
    }
    return;
  }

  e.state.phase = 3;
  moveToward(e, w.player.x, w.player.y);

  // 나선 탄막: 잡몹이 많을수록 갈래가 늘어납니다
  e.state.timer -= dt;
  if (e.state.timer <= 0) {
    e.state.timer = S.spiralInterval;
    e.state.angle += S.spiralStep;
    const arms = Math.min(S.maxSpiralArms, S.spiralArms + Math.floor(minions / S.armsPerMinions));
    for (let i = 0; i < arms; i++) {
      const a = e.state.angle + (i / arms) * Math.PI * 2;
      shoot(e, w, a, S.spiralSpeed, BOSS.burstDamage * S.spiralDamageMul, 6);
    }
  }

  // 삼키기 준비: 잡몹이 임계치를 넘고 쿨이 돌면 예고를 띄웁니다
  e.state.timer2 -= dt;
  if (e.state.timer2 <= 0 && minions >= S.devourThreshold) {
    e.state.phase = 4;
    e.state.timer2 = S.devourTelegraph;
    w.addTelegraph({
      kind: 'incoming',
      x: e.x,
      y: e.y,
      radius: S.devourRadius,
      life: S.devourTelegraph,
      color: e.def.color,
      owner: e.id,
    });
  }

  e.state.timer3 -= dt;
  if (e.state.timer3 <= 0) {
    e.state.timer3 = S.summonInterval;
    summonAround(e, w, S.summonCount);
  }
};

/** 보스를 뺀 화면 위의 적 수 */
function countMinions(w: World): number {
  let n = 0;
  for (const o of w.enemies) {
    if (!o.dead && !o.boss) n++;
  }
  return n;
}

/**
 * 주변 잡몹을 삼켜 없애고, 삼킨 수만큼 사방으로 탄을 뱉습니다.
 * 화면은 정리되지만 그 대가를 탄막으로 치릅니다.
 * 삼켜진 잡몹은 경험치도 코인도 남기지 않습니다 (killEnemy 를 거치지 않습니다).
 */
function devour(e: Enemy, w: World): void {
  const S = BOSS_SWARM;
  let eaten = 0;
  for (const o of w.enemies) {
    if (o.dead || o.boss) continue;
    if (dist(e.x, e.y, o.x, o.y) > S.devourRadius) continue;
    o.dead = true;
    w.effects.burst(o.x, o.y, 4, e.def.accent, 120, 2, 0.3);
    if (++eaten >= S.devourMax) break;
  }
  if (eaten === 0) return;

  const shots = eaten * S.shotsPerDevoured;
  radialBurst(e, w, shots, w.rng.angle(), S.devourBulletSpeed, BOSS.burstDamage * S.devourDamageMul);
  w.effects.burst(e.x, e.y, 30, e.def.color, 260, 5, 0.7);
  w.effects.addShake(10);
  w.effects.text(e.x, e.y - e.radius - 20, `${eaten}마리 흡수`, e.def.accent, 20);
}

// ---------------------------------------------------------------------------
// 공용 도구
// ---------------------------------------------------------------------------

/** 사방으로 고르게 뿌리는 탄막 */
function radialBurst(e: Enemy, w: World, count: number, offset: number, speed: number, damage: number): void {
  for (let i = 0; i < count; i++) {
    shoot(e, w, offset + (i / count) * Math.PI * 2, speed, damage, 7);
  }
  w.effects.burst(e.x, e.y, 20, e.def.color, 220, 4, 0.4);
  w.effects.addShake(5);
}

function shoot(e: Enemy, w: World, angle: number, speed: number, damage: number, radius: number): void {
  w.addProjectile({
    kind: 'enemy',
    friendly: false,
    x: e.x,
    y: e.y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    radius,
    damage,
    // 적탄은 쏜 적이 누구든 같은 빨강입니다 (ENEMY_BULLET 주석 참고)
    color: ENEMY_BULLET.color,
    life: 8,
    source: killerOf(e),
  });
}

function summonAround(e: Enemy, w: World, count: number): void {
  for (let i = 0; i < count; i++) {
    const a = w.rng.angle();
    const id = w.rng.chance(0.5) ? 'fast' : 'basic';
    w.spawnEnemy(id, e.x + Math.cos(a) * (e.radius + 20), e.y + Math.sin(a) * (e.radius + 20), {});
  }
  w.effects.burst(e.x, e.y, 16, e.def.accent, 160, 3, 0.5);
}

/** 종류마다 쓰는 타이머가 달라서 등장 시점에 여기서 채웁니다 */
function initTimers(id: BossId): (e: Enemy) => void {
  return (e) => {
    switch (id) {
      case 'bombard':
        e.state.timer = BOSS_BOMBARD.volleyInterval * 0.5;
        e.state.timer2 = BOSS_BOMBARD.burstInterval;
        e.state.timer3 = BOSS_BOMBARD.aimedInterval;
        break;
      case 'swarm':
        e.state.timer = BOSS_SWARM.spiralInterval;
        e.state.timer2 = BOSS_SWARM.devourInterval;
        e.state.timer3 = BOSS_SWARM.summonInterval;
        break;
      default:
        e.state.timer = BOSS_PREDATOR.burstInterval;
        e.state.timer2 = BOSS_PREDATOR.chargeInterval;
        e.state.timer3 = BOSS_PREDATOR.summonInterval;
        break;
    }
  };
}

export const BOSS_DEFS: Record<BossId, EnemyDef> = {
  boss: {
    id: 'boss',
    name: '거대 포식자',
    color: '#ff3355',
    accent: '#ffd0d8',
    sides: 8,
    faceMove: false,
    pattern: '3초마다 짧은 예고 뒤 돌진하고, 멈추는 자리에 충격파를 냅니다. 탄막은 가끔만 씁니다',
    behavior: predatorBehavior,
    init: initTimers('boss'),
    extraDraw: 'boss',
  },
  bombard: {
    id: 'bombard',
    name: '폭격기',
    color: '#ff7a1a',
    accent: '#ffd9a8',
    sides: 6,
    faceMove: false,
    pattern: '아주 느리게 따라오면서 바닥에 폭격을 예고하고, 그 사이 사방 탄막과 정조준 세 갈래를 뿌립니다',
    behavior: bombardBehavior,
    init: initTimers('bombard'),
    extraDraw: 'boss',
  },
  swarm: {
    id: 'swarm',
    name: '군체왕',
    color: '#ff2d8f',
    accent: '#ffc2e2',
    sides: 5,
    faceMove: false,
    pattern: '잡몹이 많을수록 나선이 굵어지고, 20마리를 넘으면 삼켜서 탄막으로 뱉습니다. 체력 절반에서 무적이 되며 군체를 소집합니다',
    behavior: swarmBehavior,
    init: initTimers('swarm'),
    extraDraw: 'boss',
  },
};

/** 등장 순서대로 돌아가며 나옵니다 */
export function bossIdForSpawn(index: number): BossId {
  return ALL_BOSS_IDS[index % ALL_BOSS_IDS.length];
}

export function isBossId(id: string): id is BossId {
  return id in BOSS_DEFS;
}
