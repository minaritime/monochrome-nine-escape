import { CANVAS, SKILLS } from '../data/balance';
import { angleTo, dist } from '../core/math';
import { clampToArena, isOutside } from '../game/collision';
import type { Enemy, Projectile } from '../game/types';
import type { World } from '../game/world';
import { canTarget, enemyById, nearestEnemy } from './targeting';

const OUT_MARGIN = 60;
const buf: Enemy[] = [];

/** 투사체 종류별 갱신 */
export function updateProjectiles(w: World, dt: number): void {
  for (const p of w.projectiles) {
    if (p.dead) continue;

    // 시간 감속은 **적탄에도 걸립니다** (2026-08-12).
    // 예전에는 `enemyTimeScale` 이 적 행동에만 걸려서, 시간을 늦춰도 이미 날아온 탄은
    // 그대로 왔습니다. 화면을 파랗게 물들여놓고 정작 제일 피하고 싶은 것만 안 느려지면
    // 스킬을 쓴 보람이 없습니다. 수명도 같이 늦춰야 날아가는 거리가 안 짧아집니다.
    const edt = p.friendly ? dt : dt * w.enemyTimeScale;

    p.life -= edt;
    if (p.life <= 0) {
      onExpire(w, p);
      continue;
    }

    switch (p.kind) {
      case 'bullet':
      case 'pierce':
        moveStraight(w, p, dt);
        break;
      case 'homing':
        moveHoming(w, p, dt);
        break;
      case 'lob':
        moveLob(w, p, dt);
        break;
      case 'mine':
        updateMine(w, p, dt);
        break;
      case 'orbit':
        updateOrbit(w, p, dt);
        break;
      case 'ricochet':
        updateRicochet(w, p, dt);
        break;
      case 'enemy':
        moveEnemyBullet(w, p, edt);
        break;
    }
  }
}

/**
 * 투사체를 터뜨립니다. **폭발이 일어나는 모든 자리가 이 함수를 지납니다.**
 *
 * 지뢰만 해도 밟혀서 터지는 길과 수명이 다해 터지는 길 둘이라, 한 곳만 고치면
 * "수명이 다한 화염 지뢰는 불을 안 남기는" 식으로 반쪽만 동작합니다.
 *
 * `blastHazard` 는 쏠 때 실어 보낸 것입니다. 여기서는 슬롯이 없어서 갈래를
 * 되물을 수 없고, 그래서 이 파일에는 분기라는 개념이 등장하지 않습니다.
 */
function detonate(w: World, p: Projectile, damage = p.damage, ignoreShield = true): void {
  w.explode(p.x, p.y, p.blast, damage, true, p.color, null, ignoreShield);

  // 자탄 (집속탄). 본체가 터진 자리 주변에 흩어져 한 번 더 터집니다
  const cl = p.cluster;
  if (cl) {
    for (let i = 0; i < cl.count; i++) {
      const a = (i / cl.count) * Math.PI * 2 + w.rng.range(-0.4, 0.4);
      const r = p.blast * cl.spreadMul * Math.sqrt(w.rng.range(0.2, 1));
      const pos = { x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r };
      clampToArena(pos, p.blast * cl.radiusMul, 0);
      w.explode(pos.x, pos.y, p.blast * cl.radiusMul, damage * cl.damageMul, true, p.color, null, ignoreShield);
    }
  }

  const hz = p.blastHazard;
  if (!hz) return;
  w.addHazard({
    x: p.x, y: p.y,
    radius: p.blast * hz.radiusMul,
    duration: hz.duration,
    // 감속은 안 겁니다. 불이 느리게 만들 이유가 없고, 감속은 오라의 몫입니다
    slow: 1,
    tickInterval: hz.tickInterval,
    tickDamage: damage * hz.damageRatio,
    // 유예가 없습니다. 폭발이 이미 "여기 뭔가 생긴다"는 예고를 했습니다
    arm: 0,
    burnDps: damage * hz.burnRatio,
    burnTime: hz.burnTime,
    color: hz.color,
    side: 'enemy',
  });
}

function onExpire(w: World, p: Projectile): void {
  p.dead = true;
  if (p.kind === 'mine' || p.kind === 'lob') {
    if (p.blast > 0) detonate(w, p);
  }
}

function moveStraight(w: World, p: Projectile, dt: number): void {
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  if (isOutside(p.x, p.y, OUT_MARGIN)) {
    p.dead = true;
    return;
  }
  hitEnemies(w, p);
}

function moveHoming(w: World, p: Projectile, dt: number): void {
  let target = enemyById(w, p.targetId);
  if (!target || !canTarget(target)) {
    target = nearestEnemy(w, p.x, p.y);
    p.targetId = target ? target.id : 0;
  }
  if (target) {
    const desired = angleTo(p.x, p.y, target.x, target.y);
    const current = Math.atan2(p.vy, p.vx);
    let diff = ((desired - current + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const maxTurn = p.turnRate * dt;
    if (diff > maxTurn) diff = maxTurn;
    if (diff < -maxTurn) diff = -maxTurn;
    const a = current + diff;
    const speed = SKILLS.missile.speed;
    p.vx = Math.cos(a) * speed;
    p.vy = Math.sin(a) * speed;
  }
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  w.effects.spray(p.x, p.y, Math.atan2(p.vy, p.vx) + Math.PI, 0.2, 1, p.color, 40, 2);
  if (isOutside(p.x, p.y, OUT_MARGIN * 3)) {
    p.dead = true;
    return;
  }
  hitEnemies(w, p);
}

function moveLob(w: World, p: Projectile, dt: number): void {
  const remaining = dist(p.x, p.y, p.destX, p.destY);
  const step = Math.hypot(p.vx, p.vy) * dt;
  if (remaining <= step) {
    p.x = p.destX;
    p.y = p.destY;
    p.dead = true;
    detonate(w, p);
    return;
  }
  p.x += p.vx * dt;
  p.y += p.vy * dt;
}

function updateMine(w: World, p: Projectile, dt: number): void {
  if (p.arm > 0) {
    p.arm -= dt;
    return;
  }
  const near = w.grid.query(p.x, p.y, p.radius + 40, buf);
  for (const e of near) {
    if (e.dead) continue;
    if (dist(p.x, p.y, e.x, e.y) <= p.radius + e.radius) {
      p.dead = true;
      detonate(w, p);
      return;
    }
  }
}

function updateOrbit(w: World, p: Projectile, dt: number): void {
  const pl = w.player;
  p.orbitAngle += p.orbitSpeed * dt;
  p.x = pl.x + Math.cos(p.orbitAngle) * p.orbitRadius;
  p.y = pl.y + Math.sin(p.orbitAngle) * p.orbitRadius;

  // 같은 적을 매 프레임 때리지 않도록 일정 간격마다 명중 기록을 비웁니다
  p.arm -= dt;
  if (p.arm <= 0) {
    p.arm = SKILLS.orbit.hitInterval;
    p.hits?.clear();
  }
  hitEnemies(w, p);
}

/**
 * 도탄. 벽에 튕기고, 적을 맞히면 다음 가까운 적으로 방향을 틉니다.
 *
 * **벽 튕김은 명중 횟수를 안 씁니다** (`SKILLS.ricochet` 주석 참고).
 * 남은 명중 횟수는 `pierce` 칸에 담습니다. "앞으로 몇 번 더 때릴 수 있는가"라는 뜻이
 * 관통과 같아서 칸을 새로 만들 이유가 없습니다.
 */
function updateRicochet(w: World, p: Projectile, dt: number): void {
  p.x += p.vx * dt;
  p.y += p.vy * dt;

  // 벽 반사. 위치를 안쪽으로 되돌려 놓지 않으면 다음 프레임에 또 뒤집혀서 벽에 붙어 떱니다
  const r = p.radius;
  if (p.x < r) {
    p.x = r;
    p.vx = Math.abs(p.vx);
  } else if (p.x > CANVAS.w - r) {
    p.x = CANVAS.w - r;
    p.vx = -Math.abs(p.vx);
  }
  if (p.y < r) {
    p.y = r;
    p.vy = Math.abs(p.vy);
  } else if (p.y > CANVAS.h - r) {
    p.y = CANVAS.h - r;
    p.vy = -Math.abs(p.vy);
  }

  const near = w.grid.query(p.x, p.y, p.radius + 46, buf);
  for (const e of near) {
    // 방금 때린 적은 건너뜁니다. 안 그러면 붙어 있는 동안 몇 프레임에 걸쳐 다 소진됩니다
    if (e.dead || !canTarget(e) || e.id === p.targetId) continue;
    if (dist(p.x, p.y, e.x, e.y) > p.radius + e.radius) continue;

    w.damageEnemy(e, p.damage, { crit: p.crit, fromX: p.x, fromY: p.y, ignoreShield: p.ignoreShield });
    w.effects.burst(p.x, p.y, 4, p.color, 130, 2, 0.25);
    p.targetId = e.id;
    p.pierce -= 1;
    // 도탄은 hitEnemies 를 안 타므로 분열도 여기서 따로 해야 합니다
    if (p.splitOnHit && p.splitsLeft > 0) splitProjectile(w, p, e);
    if (p.pierce <= 0) {
      p.dead = true;
      return;
    }

    // 다음 대상 쪽으로 틉니다. 남은 적이 없으면 가던 방향 그대로 벽을 타고 돌아다닙니다
    let next: Enemy | null = null;
    let bestD = Infinity;
    for (const o of w.enemies) {
      if (!canTarget(o) || o.id === e.id) continue;
      const d = dist(p.x, p.y, o.x, o.y);
      if (d < bestD) {
        bestD = d;
        next = o;
      }
    }
    if (next) {
      const a = angleTo(p.x, p.y, next.x, next.y);
      const speed = Math.hypot(p.vx, p.vy);
      p.vx = Math.cos(a) * speed;
      p.vy = Math.sin(a) * speed;
    }
    return;
  }
}

function moveEnemyBullet(w: World, p: Projectile, dt: number): void {
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  if (isOutside(p.x, p.y, OUT_MARGIN)) {
    p.dead = true;
    return;
  }
  const pl = w.player;
  if (!pl.alive) return;
  if (dist(p.x, p.y, pl.x, pl.y) <= p.radius + pl.radius) {
    p.dead = true;
    w.damagePlayer(p.damage, false, p.source);
  }
}

/**
 * 명중한 자리에서 탄을 갈라냅니다 (분열 도탄·분열 미사일).
 *
 * **예산제입니다.** 부모의 남은 분열 횟수를 자식들이 나눠 가지므로, 적이 아무리
 * 많아도 한 발에서 나오는 탄이 `max` 를 못 넘습니다. 예산이 없으면 적이 몰린 곳에서
 * 기하급수로 불어나 화면이 탄으로 덮이고 프레임이 무너집니다.
 */
function splitProjectile(w: World, p: Projectile, hit: Enemy): void {
  const rule = p.splitOnHit!;
  const budget = Math.floor(p.splitsLeft / rule.count);
  const speed = Math.hypot(p.vx, p.vy) || 1;
  const base = Math.atan2(p.vy, p.vx);

  for (let i = 0; i < rule.count; i++) {
    const a = base + (i - (rule.count - 1) / 2) * 0.7;
    // 다음 대상을 물고 있으면 유도탄은 그쪽으로 이어집니다
    const next = p.kind === 'homing' ? nearestEnemy(w, p.x, p.y) : null;
    w.addProjectile({
      kind: p.kind,
      x: p.x, y: p.y,
      vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
      radius: p.radius, damage: p.damage, crit: p.crit, color: p.color,
      life: Math.max(0.6, p.life), blast: p.blast, turnRate: p.turnRate,
      targetId: next && next.id !== hit.id ? next.id : 0,
      pierce: p.pierce, ignoreShield: p.ignoreShield,
      splitOnHit: budget > 0 ? rule : null,
      splitsLeft: budget,
    });
  }
  p.splitsLeft = 0;
}

/** 적과의 충돌 처리. 관통 여부와 부가 효과를 반영합니다 */
function hitEnemies(w: World, p: Projectile): void {
  const near = w.grid.query(p.x, p.y, p.radius + 46, buf);
  for (const e of near) {
    if (e.dead) continue;
    if (!e.targetable && p.kind !== 'orbit') continue; // 은신 중인 적은 통과합니다
    if (p.hits && p.hits.has(e.id)) continue;
    if (dist(p.x, p.y, e.x, e.y) > p.radius + e.radius) continue;

    // 최대 체력 비례 추가 피해는 **맞은 적** 기준입니다 (`Projectile.hpBonus` 주석 참고)
    let amount = p.hpBonus > 0 ? p.damage + e.maxHp * p.hpBonus : p.damage;
    // 처형. 빈사 상태의 적에게만 곱합니다
    if (p.execute && e.hp <= e.maxHp * p.execute.hpRatio) amount *= p.execute.mul;

    const dealt = w.damageEnemy(e, amount, {
      crit: p.crit,
      fromX: p.x,
      fromY: p.y,
      knockback: p.knockback,
      ignoreShield: p.ignoreShield,
    });

    if (dealt > 0) {
      if (p.burnTime > 0) {
        e.burnDps = Math.max(e.burnDps, p.burnDps);
        e.burnTime = Math.max(e.burnTime, p.burnTime);
      }
      // **`e.slow` 를 직접 건드리면 안 됩니다.** 보스 저항(`STATUS.bossStatusResist`)과
      // 돌진 중 상태이상 면역(`statusImmune`)이 통째로 빠집니다
      if (p.slowFactor < 1) w.slowEnemy(e, p.slowFactor, p.slowTime);
    }

    // 파편 궤도. 구체가 스칠 때마다 그 자리에 작게 터집니다
    if (p.orbFragment) {
      w.explode(p.x, p.y, p.orbFragment.radius, p.damage * p.orbFragment.damageMul, true, p.color);
    }

    w.effects.burst(p.x, p.y, 3, p.color, 90, 2, 0.2);

    if (p.hits) p.hits.add(e.id);

    // 분열. 갈라진 자식이 예산을 나눠 가지므로 총 개수가 상한을 안 넘습니다
    if (p.splitOnHit && p.splitsLeft > 0) splitProjectile(w, p, e);

    if (p.pierce > 0) {
      if (p.kind !== 'orbit') p.pierce--;
    } else {
      p.dead = true;
      // 착탄 폭발도 본체와 같은 방패 규칙을 따릅니다. 여기서 무조건 뚫어버리면
      // 추적 미사일이 "방패에 막히는 스킬"인데 피해는 그대로 들어갑니다
      if (p.blast > 0) detonate(w, p, p.damage * 0.6, p.ignoreShield);
      return;
    }
  }
}
