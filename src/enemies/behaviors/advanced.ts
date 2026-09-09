import { CANVAS, ENEMY_PARAMS } from '../../data/balance';
import { angleTo, dist } from '../../core/math';
import { eliteHas, eliteMul, eliteValue } from '../elite';
import type { Enemy } from '../../game/types';
import type { World } from '../../game/world';
import type { EnemyBehavior } from '../types';
import { avoidWalls, moveAway, moveToward, stopMoving, wander } from './movement';

// ---------------------------------------------------------------------------
// 돌진적: 배회 → 돌진 경로를 띄우고 머리 위 막대가 차는 동안 정지 → 순식간에 돌진
//        → 벽에 부딪히면 기절
// ---------------------------------------------------------------------------

/** 이 개체의 실제 예고 시간. 정예는 더 짧습니다 (그리기 쪽도 이 값을 써야 합니다) */
export function chargerTelegraphTime(e: Enemy): number {
  return ENEMY_PARAMS.charger.telegraph * eliteMul(e, 'telegraphMul');
}

/**
 * 돌진이 끝나고 다음 예고까지의 대기.
 * 난이도 13 에서 0 이 됩니다. 예고 시간은 건드리지 않으므로 "보고 피할 여지"는 남습니다.
 * 벽에서 떨어지는 동안은 어차피 예고를 시작하지 않으므로 완전한 무한 연타는 아닙니다
 */
function chargerCooldown(w: World): number {
  return w.diff.chargerNoCooldown ? 0 : ENEMY_PARAMS.charger.wanderChange * 2;
}

/**
 * (x, y) 에서 각도 a 로 나아갈 때 **경기장 벽에 닿기까지의 거리.**
 *
 * 예고 통로를 이 길이로 그어야 합니다. 예전에는 화면 대각선(약 1612px)만큼 그었는데,
 * 눈에 보이는 것은 벽까지 잘린 부분뿐이라 **차오르는 앞머리가 벽에 닿는 순간 통로가
 * 꽉 차 보였습니다.** 벽이 400px 앞이면 0.75초 만에 다 차 보이고 나머지 2.25초는
 * 그대로 서 있는 셈이라, "다 차면 튀어나온다"는 약속이 지켜지지 않았습니다.
 *
 * 돌진은 몸이 벽에서 `radius + 2` 만큼 떨어진 지점에서 멈추므로 그만큼 뺍니다.
 */
function wallDistance(e: Enemy, a: number): number {
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  let d = Number.POSITIVE_INFINITY;
  if (cos > 1e-6) d = Math.min(d, (CANVAS.w - e.x) / cos);
  else if (cos < -1e-6) d = Math.min(d, -e.x / cos);
  if (sin > 1e-6) d = Math.min(d, (CANVAS.h - e.y) / sin);
  else if (sin < -1e-6) d = Math.min(d, -e.y / sin);
  if (!Number.isFinite(d)) return 0;
  return Math.max(0, d - (e.radius + 2));
}

/** 벽에서 margin 안쪽에 있는가 */
function nearWall(e: Enemy, margin: number): boolean {
  const m = e.radius + margin;
  return e.x < m || e.x > CANVAS.w - m || e.y < m || e.y > CANVAS.h - m;
}

export const charger: EnemyBehavior = (e, w, dt) => {
  const P = ENEMY_PARAMS.charger;

  switch (e.state.phase) {
    case 0: {
      e.state.timer2 -= dt;

      // 벽에 붙은 채로 예고를 시작하면 돌진 거리가 몇 픽셀도 안 나옵니다.
      // 예고 3초를 다 보여주고 벽에 박아 기절하면 플레이어 입장에서는 아무 일도 안 일어난
      // 셈이라, 준비가 됐어도 벽에서 떨어질 때까지는 시작하지 않고 안쪽으로 걸어 나옵니다
      if (nearWall(e, P.wallClearance)) {
        moveToward(e, CANVAS.w / 2, CANVAS.h / 2, 0.8);
        break;
      }

      // 배회하며 기회를 봅니다
      wander(e, w, dt, P.wanderChange, 0.8);
      avoidWalls(e, CANVAS.w, CANVAS.h);
      // 인식 사거리는 없습니다. 쿨만 돌면 화면 어디에서든 예고를 시작합니다
      if (e.state.timer2 <= 0) {
        const telegraph = chargerTelegraphTime(e);
        e.state.phase = 1;
        e.state.timer = telegraph;
        // 막대 진행도를 계산하려면 시작 시점의 예고 시간을 들고 있어야 합니다.
        // 정예는 예고가 짧아서 P.telegraph 를 그대로 쓰면 막대가 끝까지 차지 않습니다
        e.state.timer3 = telegraph;
        e.state.angle = angleTo(e.x, e.y, w.player.x, w.player.y);
        // 실제로 몸이 멈추는 지점까지만 긋습니다 (`wallDistance` 주석 참고)
        const far = wallDistance(e, e.state.angle);
        w.addTelegraph({
          kind: 'line',
          x: e.x,
          y: e.y,
          x2: e.x + Math.cos(e.state.angle) * far,
          y2: e.y + Math.sin(e.state.angle) * far,
          // 실제로 몸이 지나가는 폭 그대로입니다. 예고보다 넓게 지나가면 속은 기분이 듭니다
          width: e.radius * 2,
          life: telegraph,
          color: e.def.color,
          // 차지 도중에 죽으면 이 경로도 같이 사라집니다
          owner: e.id,
        });
      }
      break;
    }
    case 1: {
      // 예고 (정지). 이 동안은 자동공격에 그대로 맞습니다
      stopMoving(e);
      e.state.timer -= dt;
      e.facing = e.state.angle;
      if (e.state.timer <= 0) {
        e.state.phase = 2;
        // 달리는 동안은 상태이상을 안 받습니다. 이미 걸려 있던 것도 여기서 걷어냅니다.
        // 3초를 예고하고 튀어나가는 한 번을 기절이나 감속으로 지울 수 있으면
        // "예고를 보고 자리를 비킨다"는 대응 자체가 필요 없어집니다
        e.statusImmune = true;
        e.stun = 0;
        e.slow = 1;
        e.slowTime = 0;
        e.knockVx = 0;
        e.knockVy = 0;
        // 예고만 하고 죽으면 0 으로 남습니다 ("너는 식물이다" 업적이 이 값을 봅니다)
        e.dashes++;
        w.effects.spray(e.x, e.y, e.state.angle + Math.PI, 0.4, 14, e.def.accent, 260);
        w.effects.addShake(3);
      }
      break;
    }
    case 2: {
      // 돌진. 배회 속도의 배수가 아니라 절대 속도입니다 (balance.ts 주석 참고)
      const speed = P.dashSpeed * w.diff.speedMul;
      e.vx = Math.cos(e.state.angle) * speed;
      e.vy = Math.sin(e.state.angle) * speed;
      // 벽에 "붙어 있는가"가 아니라 "벽 쪽으로 가고 있는가"로 판정합니다.
      // 방향을 안 보면 벽에 닿은 채로 예고를 마친 개체가 반대쪽으로 튀어나가는 순간
      // 곧바로 자기 기절에 걸려서, 벽 근처의 돌진적은 아무것도 못 하고 끝났습니다
      const m = e.radius + 2;
      const hitWall =
        (e.x <= m && e.vx < 0) ||
        (e.x >= CANVAS.w - m && e.vx > 0) ||
        (e.y <= m && e.vy < 0) ||
        (e.y >= CANVAS.h - m && e.vy > 0);
      if (hitWall) {
        w.effects.burst(e.x, e.y, 18, e.def.color, 240, 3, 0.5);
        w.effects.addShake(6);
        // 난이도 13: 기절하지 않고 곧바로 배회로 돌아갑니다.
        // 쿨타임까지 없으면 다음 프레임에 바로 다시 예고를 시작합니다
        // 돌진이 끝나는 순간 면역도 같이 끝납니다
        e.statusImmune = false;
        if (w.diff.chargerNoStun) {
          e.state.phase = 0;
          e.state.timer2 = chargerCooldown(w);
          break;
        }
        // 기절은 phase 3 에서 직접 처리합니다 (e.stun 을 쓰면 행동 자체가 멈춰
        // 기절 타이머가 흐르지 않습니다)
        e.state.phase = 3;
        e.state.timer = P.stun;
      }
      break;
    }
    default: {
      // 기절
      stopMoving(e);
      e.state.timer -= dt;
      if (e.state.timer <= 0) {
        e.state.phase = 0;
        e.state.timer2 = chargerCooldown(w);
      }
      break;
    }
  }
};

// ---------------------------------------------------------------------------
// 소환적: 도주하며 하수인을 부릅니다 (2026-09-09 재설계).
//
// 하수인은 평범하게 맞고 죽지만 **잡아도 아무것도 안 나옵니다** (경험치 · 처치
// 통계 · 코인 전부 없음, `World.killEnemy` 의 하수인 갈래). 5초마다 무한히 다시
// 채워지는 적이라 보상을 붙이면 소환적 하나가 무한 경험치 공급기가 됩니다.
//
// 보상은 전부 본체 쪽에 있습니다. 본체를 잡으면 하수인이 한꺼번에 사라지면서
// 그 수만큼 코인이 떨어집니다 (`World.despawnMinions`). 치우고 다니면 그 몫이
// 줄어드니 모아둔 채 근원을 끊는 쪽이 이득입니다.
// ---------------------------------------------------------------------------
export const summoner: EnemyBehavior = (e, w, dt) => {
  const P = ENEMY_PARAMS.summoner;

  const d = dist(e.x, e.y, w.player.x, w.player.y);
  if (d < P.fleeRange) {
    moveAway(e, w.player.x, w.player.y);
  } else {
    wander(e, w, dt, 1.5, 0.5);
  }
  avoidWalls(e, CANVAS.w, CANVAS.h, 60);

  // 소환 간격은 timer3 입니다. timer 를 쓰면 wander 와 같은 칸을 두고 다투는데,
  // wander 가 1.5초마다 timer 를 다시 채워버려서 **멀리 있는 소환적은 영영 소환하지 않았습니다.**
  // 플레이어가 도주 사거리 안에 들어왔을 때만 소환하던 셈입니다
  e.state.timer3 -= dt;
  if (e.state.timer3 > 0) return;
  e.state.timer3 = P.summonInterval;

  if (minionCount(e, w) >= P.maxMinions) return;

  // 종류는 스폰할 때 이미 정해져 있습니다. 매번 다른 것이 나오면 대비할 수가 없습니다
  const kind = e.summonKind ?? P.minionPool[0];
  const a = w.rng.angle();
  w.spawnEnemy(kind, e.x + Math.cos(a) * 30, e.y + Math.sin(a) * 30, {
    ownerId: e.id,
    // 정예 소환적의 유일한 차이입니다. 그 외 행동은 일반과 똑같습니다
    elite: eliteHas(e, w, 'summonElite'),
  });
  w.effects.burst(e.x, e.y, 14, e.def.accent, 170, 3, 0.5);
};

/** 이 소환적이 지금 유지하고 있는 하수인 수 */
function minionCount(e: Enemy, w: World): number {
  let n = 0;
  for (const o of w.enemies) {
    if (!o.dead && o.ownerId === e.id) n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// 은신적: **가까이 왔을 때만** 모습을 드러냅니다.
// 드러난 동안에만 타겟팅 가능합니다. 이걸 어기면 은신의 의미가 사라집니다.
// ---------------------------------------------------------------------------
export const stealth: EnemyBehavior = (e, w) => {
  const P = ENEMY_PARAMS.stealth;
  // 정예는 절반 거리까지 붙어야 보입니다
  const range = P.revealRange * eliteMul(e, 'revealRangeMul');
  const revealed = dist(e.x, e.y, w.player.x, w.player.y) <= range;

  // 드러나는 순간에만 한 번 튑니다. 매 프레임 내면 상시 파티클이 됩니다.
  // 드러난 시각을 timer 에 적어둡니다 ("찰나" 업적이 이 값을 봅니다)
  if (revealed && !e.state.flag) {
    e.state.timer = w.time;
    w.effects.burst(e.x, e.y, 8, e.def.accent, 110, 2, 0.35);
  }
  e.state.flag = revealed;

  e.targetable = revealed;
  // 하드 3: 숨어 있는 동안 완전히 투명해집니다
  e.alpha = revealed ? 1 : w.diff.stealthDeep ? 0 : P.hiddenAlpha;

  // 숨어 있는 동안에도 바닥에 흔적을 남겨 단서를 줍니다
  if (!revealed && w.rng.chance(0.12)) {
    w.effects.burst(e.x, e.y + e.radius * 0.6, 1, '#5b6a86', 20, 2, 0.5);
  }

  moveToward(e, w.player.x, w.player.y);
};

// ---------------------------------------------------------------------------
// 사제 (하드 3): 배회하다 플레이어가 가까워지면 도망갑니다.
//   10초마다 주변의 적에게 3초짜리 재생을 겁니다. 자기 자신은 안 걸립니다.
// ---------------------------------------------------------------------------

/** 이 개체의 능력 반경. 정예는 1.5배입니다 (그리기 쪽도 이 값을 써야 합니다) */
export function priestRadius(e: Enemy, w: World): number {
  return ENEMY_PARAMS.priest.radius * eliteMul(e, 'auraRadiusMul') * w.diff.rangeMul;
}

export const priest: EnemyBehavior = (e, w, dt) => {
  const P = ENEMY_PARAMS.priest;

  if (dist(e.x, e.y, w.player.x, w.player.y) < P.fleeRange) {
    moveAway(e, w.player.x, w.player.y);
  } else {
    wander(e, w, dt, 1.5, 0.5);
  }
  avoidWalls(e, CANVAS.w, CANVAS.h, 60);

  // 소환적과 같은 이유로 timer3 입니다. wander 가 timer 를 1.5초마다 다시 채우기 때문에
  // timer 를 쓰면 멀리 있는 사제는 능력을 영영 안 씁니다
  e.state.timer3 -= dt;
  if (e.state.timer3 > 0) return;
  e.state.timer3 = P.cooldown;

  const radius = priestRadius(e, w);
  const instant = eliteValue(e, 'instantHealRatio', 0);
  let touched = 0;
  for (const o of w.enemies) {
    // **자기 자신은 안 걸립니다.** 스스로 회복하면 도망 다니는 적이 혼자 안 죽는 적이
    // 되어 성격이 통째로 바뀝니다
    if (o === e || o.dead || o.downed > 0) continue;
    if (dist(e.x, e.y, o.x, o.y) > radius + o.radius) continue;
    // 중첩되지 않고 **시간만 갱신**됩니다
    o.regenTime = P.regenTime;
    // 정예는 거는 순간 잃은 체력의 일부를 즉시 되찾아 줍니다
    if (instant > 0 && o.hp < o.maxHp) o.hp = Math.min(o.maxHp, o.hp + (o.maxHp - o.hp) * instant);
    touched++;
  }

  w.effects.burst(e.x, e.y, 10, e.def.accent, 150, 3, 0.5);
  if (touched > 0) w.effects.text(e.x, e.y - e.radius - 8, '재생', e.def.accent, 14);
};
