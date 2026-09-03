import { ENEMY_BASE, ENEMY_PARAMS, SKILLS, STATUS } from '../data/balance';
import { eliteMul, eliteRegenRatio } from './elite';
import { clampToArena } from '../game/collision';
import type { Enemy } from '../game/types';
import type { World } from '../game/world';

const neighbors: Enemy[] = [];

/** 적 전체 갱신: 상태이상 → 행동 → 분리 → 이동 */
export function updateEnemies(w: World, dt: number): void {
  const scale = w.enemyTimeScale;

  for (const e of w.enemies) {
    if (e.dead) continue;
    const edt = dt * scale;

    if (e.hitFlash > 0) e.hitFlash -= dt;
    if (e.invuln > 0) e.invuln -= dt;

    // 쓰러진 미라는 아무것도 하지 않고 되살아날 때만 기다립니다.
    // 행동 · 접촉 · 피격 · 분리 전부 멈춥니다
    if (e.downed > 0) {
      e.vx = 0;
      e.vy = 0;
      e.downed -= edt;
      if (e.downed <= 0) revive(e, w);
      continue;
    }

    // 되살아난 미라는 매초 최대 체력의 일정 비율을 잃습니다.
    // 가만히 둬도 스스로 무너지므로 "지금 정리할까 버틸까"의 판단이 됩니다
    if (e.hpDrainRatio > 0) {
      w.damageEnemy(e, e.maxHp * e.hpDrainRatio * edt, { showNumber: false });
      if (e.dead) continue;
    }

    // 부활 직후의 속도 폭증은 매초 깎여 원래 속도로 돌아옵니다
    if (e.speedDecay > 0) {
      e.speed = Math.max(e.speedFloor, e.speed - e.speedDecay * edt);
      if (e.speed <= e.speedFloor) e.speedDecay = 0;
    }

    if (e.burnTime > 0) {
      e.burnTime -= edt;
      e.burnTick -= edt;
      if (e.burnTick <= 0) {
        e.burnTick = STATUS.burnTickInterval;
        w.damageEnemy(e, e.burnDps * STATUS.burnTickInterval, { showNumber: false });
        if (w.rng.chance(0.5)) w.effects.burst(e.x, e.y, 1, '#ff9a3c', 30, 2, 0.3);
      }
      if (e.burnTime <= 0) e.burnDps = 0;
      if (e.dead) continue;
    }

    if (e.slowTime > 0) {
      e.slowTime -= edt;
      if (e.slowTime <= 0) e.slow = 1;
    }

    // 체력 재생 (정예 탱커). 화력이 재생을 못 넘기면 영영 못 죽는다는 것이 요점입니다.
    // **화상 중에는 재생이 멈춥니다.** 지금 재생하는 적이 정예 탱커뿐이라
    // 사실상 화염방사기가 정예 탱커의 카운터가 됩니다 (그것이 의도입니다)
    const regen = e.burnTime > 0 ? 0 : eliteRegenRatio(e);
    if (regen > 0 && e.hp < e.maxHp) {
      e.hp = Math.min(e.maxHp, e.hp + e.maxHp * regen * edt);
      if (w.rng.chance(0.06)) w.effects.burst(e.x, e.y, 1, '#6ee7a0', 34, 2, 0.35);
    }

    if (e.stun > 0) {
      e.stun -= edt;
      e.vx = 0;
      e.vy = 0;
    } else {
      e.def.behavior(e, w, edt);
    }

    if (!e.phasing && !e.boss) applySeparation(w, e, edt);

    // 넉백은 감쇠하며 사라집니다
    if (e.knockVx !== 0 || e.knockVy !== 0) {
      const decay = Math.max(0, 1 - 7 * edt);
      e.knockVx *= decay;
      e.knockVy *= decay;
      if (Math.abs(e.knockVx) < 1) e.knockVx = 0;
      if (Math.abs(e.knockVy) < 1) e.knockVy = 0;
    }

    // 감속은 **더합니다** (`STATUS.slowCap` 주석 참고).
    // 오라 45% + 화상 10% = 55% 감속입니다. 곱하면 49.5% 라 표의 숫자와 어긋납니다.
    // 돌진 중에는 화상이 주는 감속까지 포함해 전부 무시합니다. 화상의 지속 피해는
    // 그대로 들어갑니다 (위 화상 처리는 이 갈래를 안 탑니다)
    const slowAmount = e.statusImmune ? 0 : (1 - e.slow) + (e.burnTime > 0 ? SKILLS.flame.burnSlow : 0);
    const move = 1 - Math.min(slowAmount, STATUS.slowCap);
    e.x += (e.vx * move + e.knockVx) * edt;
    e.y += (e.vy * move + e.knockVy) * edt;
    clampToArena(e, e.radius, 0);
  }
}

/** 적끼리 겹쳐서 한 덩어리로 보이는 것을 막습니다 */
function applySeparation(w: World, e: Enemy, dt: number): void {
  const list = w.grid.query(e.x, e.y, e.radius * 2 + 24, neighbors);
  let px = 0;
  let py = 0;
  for (const o of list) {
    if (o === e || o.dead || o.phasing || o.downed > 0) continue;
    const dx = e.x - o.x;
    const dy = e.y - o.y;
    const minD = e.radius + o.radius;
    const d2 = dx * dx + dy * dy;
    if (d2 >= minD * minD || d2 === 0) continue;
    const d = Math.sqrt(d2);
    const push = (minD - d) / minD;
    px += (dx / d) * push;
    py += (dy / d) * push;
  }
  if (px !== 0 || py !== 0) {
    e.x += px * ENEMY_BASE.separation * dt;
    e.y += py * ENEMY_BASE.separation * dt;
  }
}

/**
 * 미라 부활.
 *
 * 되살아난 순간이 가장 위험하고, 그 뒤로는 스스로 약해집니다.
 * 체력 · 공격력은 그 자리에서 배로 뛰고, 이동속도만 시간을 두고 원래대로 돌아옵니다.
 */
function revive(e: Enemy, w: World): void {
  const P = ENEMY_PARAMS.mummy;
  e.downed = 0;
  e.revived = true;
  e.targetable = true;
  e.alpha = 1;
  e.maxHp *= P.hpMul;
  e.hp = e.maxHp;
  e.damage *= P.damageMul;
  // 지금 속도가 곧 "원래 속도"입니다. 시간 강화도 난이도 배율도 이미 반영된 값이라
  // 표를 다시 읽어 계산하면 그것들이 통째로 빠집니다
  e.speedFloor = e.speed;
  e.speed *= P.speedMul;
  e.speedDecay = e.speedFloor * P.speedDecayPerSec;
  e.hpDrainRatio = P.hpDrainPerSec;
  w.effects.burst(e.x, e.y, 22, e.def.accent, 220, 3, 0.6);
  w.effects.text(e.x, e.y - e.radius - 10, '부활', e.def.accent, 17);
  w.effects.addShake(4);
}

/** 이 개체가 되살아나기까지 걸리는 시간. 정예는 절반입니다 */
export function mummyReviveDelay(e: Enemy): number {
  return ENEMY_PARAMS.mummy.reviveDelay * eliteMul(e, 'reviveDelayMul');
}
