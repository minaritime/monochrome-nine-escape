import {
  ALL_BOSS_IDS,
  BOSS,
  BOSS_BOMBARD,
  BOSS_PREDATOR,
  BOSS_SWARM,
  CANVAS,
  ENEMY_BULLET,
  type BossId,
} from '../data/balance';
import { angleTo, clamp, dist } from '../core/math';
import { moveToward, stopMoving } from './behaviors/movement';
import { killerOf } from '../game/killer';
import type { Enemy } from '../game/types';
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
// ---------------------------------------------------------------------------
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
      e.vx = Math.cos(e.state.angle) * e.speed * P.chargeSpeedMul;
      e.vy = Math.sin(e.state.angle) * e.speed * P.chargeSpeedMul;
      const m = e.radius + 2;
      const hitWall =
        (e.x <= m && e.vx < 0) ||
        (e.x >= CANVAS.w - m && e.vx > 0) ||
        (e.y <= m && e.vy < 0) ||
        (e.y >= CANVAS.h - m && e.vy > 0);
      if (e.state.timer <= 0 || hitWall) {
        // 멈추는 자리에 충격파. 돌진 경로를 피해도 착지점에 서 있으면 맞습니다
        w.explode(e.x, e.y, P.slamRadius, e.damage * P.slamDamageMul, false, e.def.color, killerOf(e));
        e.state.phase = 3;
        e.state.timer2 = P.chargeInterval;
        if (hitWall) w.effects.addShake(10);
      }
      return;
    }
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

  e.state.timer -= dt;
  if (e.state.timer > 0) return;
  e.state.timer = B.volleyInterval;

  for (let i = 0; i < BOSS_BOMBARD.shots; i++) {
    // 첫 발은 지금 서 있는 자리입니다. 가만히 있으면 반드시 맞습니다
    const onPlayer = i === 0 && BOSS_BOMBARD.firstShotOnPlayer;
    const a = w.rng.angle();
    const d = onPlayer ? 0 : w.rng.range(40, BOSS_BOMBARD.spread);
    const x = clamp(w.player.x + Math.cos(a) * d, 30, CANVAS.w - 30);
    const y = clamp(w.player.y + Math.sin(a) * d, 30, CANVAS.h - 30);

    w.addTelegraph({
      kind: 'incoming',
      x,
      y,
      radius: BOSS_BOMBARD.blastRadius,
      life: BOSS_BOMBARD.warning,
      color: e.def.color,
    });
    w.addPendingBlast({
      x,
      y,
      radius: BOSS_BOMBARD.blastRadius,
      damage: e.damage * BOSS_BOMBARD.blastDamageMul,
      delay: BOSS_BOMBARD.warning,
      color: e.def.accent,
      source: killerOf(e),
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
