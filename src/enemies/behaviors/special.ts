import { CANVAS, ENEMY_BULLET, ENEMY_PARAMS } from '../../data/balance';
import { angleTo, dist } from '../../core/math';
import type { Enemy } from '../../game/types';
import { killerOf } from '../../game/killer';
import { eliteHas, eliteMul } from '../elite';
import type { World } from '../../game/world';
import type { EnemyBehavior } from '../types';
import { avoidWalls, moveToward, stopMoving, wander } from './movement';

// ---------------------------------------------------------------------------
// 원거리적: 사거리에 들어오면 멈춰 2초 조준한 뒤 느린 투사체를 쏩니다.
// 조준선을 미리 보여주므로 "보고 피할 수 있는" 위협입니다.
// ---------------------------------------------------------------------------
/** 플레이어보다 조금 긴 사거리. 난이도의 사거리 배율이 여기에 곱해집니다 */
export function rangedAttackRange(w: World): number {
  const P = ENEMY_PARAMS.ranged;
  return Math.max(P.baseRange, w.player.stats.range * P.playerRangeMul) * w.diff.rangeMul;
}

/** 이 개체의 실제 조준 시간. 정예는 절반입니다 (그리기 쪽도 이 값을 써야 합니다) */
export function rangedAimTime(e: Enemy): number {
  return ENEMY_PARAMS.ranged.aimTime * eliteMul(e, 'aimTimeMul');
}

export const ranged: EnemyBehavior = (e, w, dt) => {
  const P = ENEMY_PARAMS.ranged;
  const attackRange = rangedAttackRange(w);
  const d = dist(e.x, e.y, w.player.x, w.player.y);

  if (e.state.phase === 0) {
    // 접근
    if (d > attackRange) {
      moveToward(e, w.player.x, w.player.y);
    } else {
      e.state.phase = 1;
      e.state.timer = rangedAimTime(e);
      e.state.angle = angleTo(e.x, e.y, w.player.x, w.player.y);
      // 조준선은 render/scene.ts 가 매 프레임 그립니다.
      // 정적 텔레그래프로 만들면 조준을 시작한 순간의 위치에 선이 고정되는데,
      // 실제 발사각은 계속 갱신되므로 보이는 것과 날아오는 것이 어긋납니다.
    }
    return;
  }

  if (e.state.phase === 1) {
    // 조준 (정지)
    stopMoving(e);
    e.state.timer -= dt;
    e.state.angle = angleTo(e.x, e.y, w.player.x, w.player.y);
    e.facing = e.state.angle;
    if (e.state.timer <= 0) {
      w.addProjectile({
        kind: 'enemy',
        friendly: false,
        x: e.x,
        y: e.y,
        vx: Math.cos(e.state.angle) * P.bulletSpeed,
        vy: Math.sin(e.state.angle) * P.bulletSpeed,
        radius: P.bulletRadius,
        damage: e.damage,
        // 적탄은 쏜 적이 누구든 같은 빨강입니다 (ENEMY_BULLET 주석 참고)
        color: ENEMY_BULLET.color,
        life: 6,
        source: killerOf(e),
      });
      w.effects.spray(e.x, e.y, e.state.angle, 0.2, 5, ENEMY_BULLET.glow, 120);
      e.state.phase = 2;
      e.state.timer = P.cooldown;
    }
    return;
  }

  // 재장전하며 거리 유지
  e.state.timer -= dt;
  if (d < attackRange * 0.7) {
    moveToward(e, w.player.x, w.player.y, -0.6);
  } else {
    moveToward(e, w.player.x, w.player.y, 0.35);
  }
  if (e.state.timer <= 0) e.state.phase = 0;
};

// ---------------------------------------------------------------------------
// 겁쟁이적: 느리게 배회하다가 플레이어가 가까워지면 급가속으로 달려듭니다.
// 30초를 살아남으면 인내가 끝나서, 거리와 상관없이 계속 달려듭니다.
// ---------------------------------------------------------------------------

/** 이 판의 실제 인내 시간. 난이도 15 에서 절반이 됩니다 */
export function cowardPatienceTime(w: World): number {
  return ENEMY_PARAMS.coward.patienceTime * w.diff.cowardPatienceMul;
}

/** 인내가 끝나 거리와 무관하게 달려드는 상태인가. 그리기 쪽도 이 함수를 씁니다 */
export function cowardEnraged(e: Enemy, w: World): boolean {
  return e.state.timer3 >= cowardPatienceTime(w);
}

export const coward: EnemyBehavior = (e, w, dt) => {
  const P = ENEMY_PARAMS.coward;
  const d = dist(e.x, e.y, w.player.x, w.player.y);

  // 살아 있는 시간을 셉니다. 무시당한 채로 방치되는 것에 대한 대가입니다
  const wasCalm = !cowardEnraged(e, w);
  e.state.timer3 += dt;
  if (wasCalm && cowardEnraged(e, w)) w.effects.burst(e.x, e.y, 14, e.def.accent, 160, 3, 0.45);

  switch (e.state.phase) {
    case 0: {
      // 아주 느리게 배회합니다
      wander(e, w, dt, P.wanderChange, 1);
      avoidWalls(e, CANVAS.w, CANVAS.h);
      if (cowardEnraged(e, w) || d < P.triggerRange * eliteMul(e, 'triggerRangeMul') * w.diff.rangeMul) {
        e.state.phase = 1;
        e.state.timer2 = P.windup;
        e.state.angle = angleTo(e.x, e.y, w.player.x, w.player.y);
        w.effects.burst(e.x, e.y, 8, e.def.accent, 110, 2, 0.25);
      }
      return;
    }
    case 1: {
      // 아주 짧은 준비 동작. 이 동안에도 방향은 계속 갱신됩니다
      stopMoving(e);
      e.state.timer2 -= dt;
      e.state.angle = angleTo(e.x, e.y, w.player.x, w.player.y);
      e.facing = e.state.angle;
      if (e.state.timer2 <= 0) {
        e.state.phase = 2;
        e.state.timer2 = P.dashTime;
        w.effects.spray(e.x, e.y, e.state.angle + Math.PI, 0.5, 12, e.def.accent, 240);
      }
      return;
    }
    case 2: {
      // 돌진. 배회 속도의 배수가 아니라 절대 속도입니다 (정예는 여기에 1.5배)
      e.state.timer2 -= dt;
      const dashSpeed = P.dashSpeed * eliteMul(e, 'dashSpeedMul');
      e.vx = Math.cos(e.state.angle) * dashSpeed;
      e.vy = Math.sin(e.state.angle) * dashSpeed;
      e.facing = e.state.angle;
      if (w.rng.chance(0.4)) w.effects.burst(e.x, e.y, 1, e.def.accent, 40, 2, 0.2);
      // 돌진이 끝나면 곧바로 다시 배회합니다 (멈추는 구간 없음)
      if (e.state.timer2 <= 0) {
        e.state.phase = 0;
        e.state.timer = 0;
        e.state.angle = w.rng.angle();
      }
      return;
    }
    default: {
      e.state.phase = 0;
      return;
    }
  }
};

// ---------------------------------------------------------------------------
// 자폭적: 스폰 후 잠시 제자리에 섰다가 추적합니다.
// 맞으면 점화되어 빨라지고 4초 뒤 터집니다. 바로 앞까지 붙어도 점화되며 이때는 0.8초입니다.
// 처치하면 시체가 2초 뒤에 터지고, 그 폭발만은 적과 플레이어를 가리지 않습니다.
// ---------------------------------------------------------------------------

/** 자폭으로 스스로 소멸한 개체. 시체 폭발을 한 번 더 예약하지 않으려고 표시해 둡니다 */
const PHASE_SELF_DESTRUCT = 1;

/** 스폰 직후의 대기 시간을 담아둡니다. timer 는 도화선이 쓰므로 timer2 를 씁니다 */
export function bomberInit(e: Enemy): void {
  e.state.timer2 = ENEMY_PARAMS.bomber.spawnDelay;
}

export const bomber: EnemyBehavior = (e, w, dt) => {
  const P = ENEMY_PARAMS.bomber;

  // 점화됨: 도화선이 타는 동안에도 계속 따라옵니다 (속도 보정은 없습니다)
  if (e.state.flag) {
    e.state.timer -= dt;
    moveToward(e, w.player.x, w.player.y, P.igniteSpeedMul);
    if (w.rng.chance(0.5)) w.effects.burst(e.x, e.y, 1, '#ff9a3c', 40, 2, 0.25);
    if (e.state.timer <= 0) {
      e.state.phase = PHASE_SELF_DESTRUCT;
      bomberBlastPlayer(e, w);
      w.killEnemy(e);
    }
    return;
  }

  // 스폰 직후 대기. 화면 가장자리에서 나오자마자 붙으면 피할 방법이 없습니다
  if (e.state.timer2 > 0) {
    e.state.timer2 -= dt;
    e.vx = 0;
    e.vy = 0;
    return;
  }

  moveToward(e, w.player.x, w.player.y);

  // 바로 앞까지 붙어도 점화됩니다. 이쪽은 이미 코앞이라 도화선이 짧습니다
  const gap = dist(e.x, e.y, w.player.x, w.player.y) - e.radius - w.player.radius;
  if (gap <= P.triggerRange) bomberIgnite(e, w, P.contactFuse);
};

/** fuse 를 넘기지 않으면 피격 점화(4초)입니다 */
export function bomberIgnite(e: Enemy, w: World, fuse: number = ENEMY_PARAMS.bomber.fuse): void {
  if (e.state.flag) return;
  e.state.flag = true;
  // 점화되면 스폰 대기는 취소됩니다
  e.state.timer2 = 0;
  e.state.timer = fuse;
  w.effects.burst(e.x, e.y, 8, '#ff9a3c', 110, 3, 0.3);
}

/** 이 개체의 실제 폭발 반경. 정예는 1.5배입니다 (그리기 쪽도 이 값을 써야 합니다) */
export function bomberBlastRadius(e: Enemy, w: World): number {
  return ENEMY_PARAMS.bomber.blastRadius * eliteMul(e, 'blastRadiusMul') * w.diff.rangeMul;
}

/** 도화선이 다 탄 자폭. 플레이어만 맞습니다 */
function bomberBlastPlayer(e: Enemy, w: World): void {
  const P = ENEMY_PARAMS.bomber;
  w.explode(e.x, e.y, bomberBlastRadius(e, w), e.damage * P.blastDamageMul, false, '#ff9a3c', killerOf(e));
}

/**
 * 처치되면 시체가 남아 2초 뒤에 터집니다.
 * 예고 원을 같이 띄웁니다. 안 보이면 잡은 보상이 아니라 억울한 죽음이 됩니다.
 */
export function bomberOnDeath(e: Enemy, w: World): void {
  if (e.state.phase === PHASE_SELF_DESTRUCT) return;
  const P = ENEMY_PARAMS.bomber;
  const radius = bomberBlastRadius(e, w);
  // 정예는 절반 시간에 터집니다. 넓어진 범위와 겹쳐서 치울 여유가 확 줄어듭니다
  const delay = P.corpseDelay * eliteMul(e, 'corpseDelayMul');
  w.addTelegraph({ kind: 'incoming', x: e.x, y: e.y, radius, life: delay, color: '#ff9a3c' });
  w.addPendingBlast({
    x: e.x,
    y: e.y,
    radius,
    damage: e.damage * P.blastDamageMul,
    delay,
    color: '#ff9a3c',
    source: killerOf(e),
    hitsAll: true,
  });
}

// ---------------------------------------------------------------------------
// 분열적: 죽으면 작은 개체 3마리로 나뉩니다. 분열체는 다시 분열하지 않습니다.
// ---------------------------------------------------------------------------
export const splitter: EnemyBehavior = (e, w) => {
  moveToward(e, w.player.x, w.player.y);
};

export function splitterOnDeath(e: Enemy, w: World): void {
  // 정예는 분열체가 한 번 더 나뉩니다 (1 → 3 → 9). 손자 세대에서 멈춥니다
  if (e.child && !(e.elite && eliteHas(e, w, 'splitAgain') && e.state.phase === 0)) return;
  const P = ENEMY_PARAMS.splitter;

  // 난이도 14: 나뉘는 순간 사방으로 탄을 뿌립니다.
  // 분열체를 피해 물러나는 자리가 곧 탄이 오는 자리라, 잡는 위치를 고르게 만듭니다
  if (w.diff.splitterShoot) splitterBurst(e, w);

  for (let i = 0; i < P.children; i++) {
    const a = (i / P.children) * Math.PI * 2 + w.rng.range(-0.3, 0.3);
    const child = w.spawnEnemy('splitter', e.x + Math.cos(a) * 18, e.y + Math.sin(a) * 18, {
      child: true,
      scale: P.childScale * (e.child ? P.childScale : 1),
      hpMul: P.childHpMul * (e.child ? P.childHpMul : 1),
      elite: e.elite,
    });
    // 손자는 더 이상 나뉘지 않습니다. phase 로 세대를 표시합니다
    child.state.phase = e.child ? 1 : 0;
    child.speed *= P.childSpeedMul;
    child.vx = Math.cos(a) * child.speed;
    child.vy = Math.sin(a) * child.speed;
  }
  w.effects.burst(e.x, e.y, 12, e.def.color, 170, 3, 0.4);
}

/** 난이도 14: 나뉘는 순간의 방사 탄막. 자식이 흩어지는 각과 어긋나게 반 칸 돌려서 쏩니다 */
function splitterBurst(e: Enemy, w: World): void {
  const P = ENEMY_PARAMS.splitter;
  const step = (Math.PI * 2) / P.burstCount;
  const base = w.rng.angle();
  for (let i = 0; i < P.burstCount; i++) {
    const a = base + step * i;
    w.addProjectile({
      kind: 'enemy',
      friendly: false,
      x: e.x,
      y: e.y,
      vx: Math.cos(a) * P.burstSpeed,
      vy: Math.sin(a) * P.burstSpeed,
      radius: P.burstRadius,
      damage: e.damage * P.burstDamageMul,
      color: ENEMY_BULLET.color,
      life: 4,
      source: killerOf(e),
    });
  }
  w.effects.burst(e.x, e.y, 10, ENEMY_BULLET.glow, 200, 3, 0.35);
}
