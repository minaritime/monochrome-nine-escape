import { CANVAS, ENEMY_BULLET, ENEMY_PARAMS } from '../../data/balance';
import { angleDiff, angleTo } from '../../core/math';
import { eliteHas, eliteMul, eliteValue } from '../elite';
import type { Enemy } from '../../game/types';
import { killerOf } from '../../game/killer';
import type { World } from '../../game/world';
import type { EnemyBehavior } from '../types';
import { mummyReviveDelay } from '../update';
import { moveToward } from './movement';

/** 기본 / 빠른 / 탱커: 플레이어를 그대로 추적 */
export const chase: EnemyBehavior = (e, w) => {
  moveToward(e, w.player.x, w.player.y);
};

/**
 * 바보적: 직진만 하고 벽에 닿으면 반사합니다.
 * 플레이어를 쫓지 않아서 오히려 예측이 어렵습니다.
 */
export const bounce: EnemyBehavior = (e, w, dt) => {
  if (!e.state.flag) {
    // 스폰 직후 한 번만 화면 안쪽을 향해 방향을 잡습니다
    e.state.flag = true;
    e.state.angle = angleTo(e.x, e.y, w.player.x, w.player.y) + w.rng.range(-0.5, 0.5);
  }
  const next = { x: e.x + Math.cos(e.state.angle) * e.speed * dt, y: e.y + Math.sin(e.state.angle) * e.speed * dt };
  let bounced = false;
  if (next.x < e.radius || next.x > CANVAS.w - e.radius) {
    e.state.angle = Math.PI - e.state.angle;
    bounced = true;
  }
  if (next.y < e.radius || next.y > CANVAS.h - e.radius) {
    e.state.angle = -e.state.angle;
    bounced = true;
  }
  if (bounced) {
    w.effects.burst(e.x, e.y, 4, e.def.accent, 90, 2, 0.2);
    foolShoot(e, w);
  }
  e.vx = Math.cos(e.state.angle) * e.speed;
  e.vy = Math.sin(e.state.angle) * e.speed;
  e.facing = e.state.angle;
};

/**
 * 벽에 튕길 때마다 플레이어 쪽으로 쏩니다.
 * 쫓아오지 않는 적이라 이게 없으면 그냥 지나다니는 장애물입니다.
 * 정예는 **같은 탄을** 세 갈래로 뿌립니다. 탄속은 일반과 같습니다
 * (이유는 `ENEMY_PARAMS.fool` 주석 참고).
 */
function foolShoot(e: Enemy, w: World): void {
  const P = ENEMY_PARAMS.fool;
  const strong = eliteHas(e, w, 'foolElite');
  const base = angleTo(e.x, e.y, w.player.x, w.player.y);

  // 난이도 15 는 갈래 수를 통째로 갈아끼웁니다. 이때는 부채꼴이 아니라 전방위입니다.
  // **무적 바보적만은 예외로 이 규칙에서 빠집니다** (`ENEMY_PARAMS.fool` 주석 참고).
  // 못 죽이는 적이 사방으로 뿌리면 피할 자리가 아니라 서 있을 자리가 없어집니다
  const dirs = e.immortal ? null : w.diff.foolShotDirs;
  const count = e.immortal
    ? P.immortalBulletCount
    : (dirs ?? (strong ? P.eliteBulletCount : P.bulletCount));
  const speed = P.bulletSpeed * (e.immortal ? P.immortalBulletSpeedMul : 1);
  const spread = e.immortal ? P.immortalSpread : P.eliteSpread;

  for (let i = 0; i < count; i++) {
    // 전방위일 때는 원을 균등하게 나누고, 아니면 플레이어 쪽 부채꼴로 폅니다
    const offset =
      dirs !== null
        ? ((Math.PI * 2) / dirs) * i
        : count === 1
          ? 0
          : (i - (count - 1) / 2) * spread;
    const a = base + offset;
    w.addProjectile({
      kind: 'enemy',
      friendly: false,
      x: e.x,
      y: e.y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      radius: P.bulletRadius,
      damage: e.damage,
      // 적탄은 쏜 적이 누구든 같은 빨강입니다 (ENEMY_BULLET 주석 참고)
      color: ENEMY_BULLET.color,
      life: 6,
      source: killerOf(e),
    });
  }
  w.effects.spray(e.x, e.y, base, 0.2, 5, ENEMY_BULLET.glow, 120);
}

/**
 * 미라: 그냥 쫓아옵니다. 특별한 것은 죽는 순간부터 시작됩니다 (`mummyOnLethal`).
 * 예전 유령적의 "다른 적을 통과한다"는 없앴습니다. 통과는 이 적의 성격이 아니고,
 * 통과하면 쓰러진 시체를 밀어낼 수도 없어 부활 자리가 겹칩니다.
 */
export const mummy: EnemyBehavior = (e, w) => {
  moveToward(e, w.player.x, w.player.y);
};

/**
 * 체력이 0 이 된 순간. **첫 죽음은 죽음이 아닙니다.**
 * 그 자리에 흐려진 채로 쓰러졌다가 되살아납니다 (되살리는 쪽은 `enemies/update.ts`).
 */
export function mummyOnLethal(e: Enemy, w: World): boolean {
  if (e.revived) return false; // 두 번째는 진짜 죽음입니다
  e.hp = 0;
  e.downed = mummyReviveDelay(e);
  e.targetable = false;
  e.alpha = ENEMY_PARAMS.mummy.downedAlpha;
  e.vx = 0;
  e.vy = 0;
  e.burnTime = 0;
  e.stun = 0;
  e.slow = 1;
  e.knockVx = 0;
  e.knockVy = 0;
  w.effects.burst(e.x, e.y, 12, e.def.color, 120, 3, 0.5);
  return true;
}

/**
 * 방패적: 항상 플레이어를 정면으로 보며 추적합니다.
 * 정면 피해는 방패 내구도가 대신 받고, 방패가 깨지면 무효화가 사라지는 대신 빨라집니다.
 * 내구도 처리는 world.damageEnemy 에 있습니다.
 */
export const shielded: EnemyBehavior = (e, w) => {
  moveToward(e, w.player.x, w.player.y);
};

export function shieldBlocks(e: Enemy, fromX: number, fromY: number): boolean {
  const incoming = angleTo(e.x, e.y, fromX, fromY);
  const half = (ENEMY_PARAMS.shield.arcDeg * Math.PI) / 180 / 2;
  return angleDiff(incoming, e.facing) <= half;
}

/** 장판적: 추적. 죽으면 그 자리에 감속 장판을 남깁니다 */
export const puddleChase: EnemyBehavior = (e, w) => {
  moveToward(e, w.player.x, w.player.y);
};

/**
 * 정예 장판은 두 배 넓고 덜 느려지는 대신, 1초 뒤부터 0.5초마다 아픕니다.
 * 감속만 있을 때는 "밟고 지나가면 그만"이었지만, 피해가 붙으면 잡을 자리를 고르게 됩니다.
 */
export function puddleOnDeath(e: Enemy, w: World): void {
  const p = ENEMY_PARAMS.puddle;
  const damageMul = eliteValue(e, 'hazardDamageMul', 0);
  w.addHazard({
    x: e.x,
    y: e.y,
    radius: p.hazardRadius * eliteMul(e, 'hazardRadiusMul') * w.diff.rangeMul,
    duration: p.hazardDuration,
    slow: eliteValue(e, 'hazardSlow', p.hazardSlow),
    arm: p.hazardArm,
    tickInterval: p.hazardTick,
    tickDamage: e.damage * damageMul,
    color: e.def.color,
    source: killerOf(e),
  });
  w.effects.burst(e.x, e.y, 18, e.def.color, 120, 4, 0.6);
}
