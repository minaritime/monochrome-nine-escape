import { CANVAS, SKILLS } from '../data/balance';
import { angleTo, dist } from '../core/math';
import { clampToArena, isOutside } from '../game/collision';
import type { Enemy, Projectile } from '../game/types';
import type { World } from '../game/world';
import { canTarget, enemyById, isPick, nearestEnemy, tauntId } from './targeting';
import { challengeMinionGrazed, challengeShotPassThrough, challengeVisionRadius } from '../game/challenge';

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
  if (p.blast <= 0) return;

  // 지뢰와 유탄은 원래 "터지려고 만든 것"이라 폭발이 방패를 무시합니다 (폭발 계열)
  if (p.kind === 'mine' || p.kind === 'lob') {
    detonate(w, p);
    return;
  }

  // 수명이 다한 미사일은 그 자리에서 터집니다 (2026-09-09).
  // 끝까지 못 맞혔다고 아무 일도 없이 사라지면 유도가 빗나갔을 때의 손해가 0 이 됩니다.
  //
  // **방패는 그대로 존중합니다** (`p.ignoreShield`, 미사일은 false).
  // 무시하게 두면 "미사일은 방패에 막힌다"는 약점을 **수명이 다할 때까지 기다리는
  // 것만으로** 우회할 수 있습니다. 갈래로 약점을 지우지 않는다는 규칙과 같은 자리입니다.
  //
  // 도탄은 여기 안 옵니다. `blast` 가 0 이라 위에서 이미 빠져나갑니다
  if (p.kind === 'homing') detonate(w, p, p.damage, p.ignoreShield);
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

  // **어둠이 있는 판에서는 대상을 못 찾으면 그 자리에서 터집니다** (2026-09-16 사용자 지시).
  //
  // 안 그러면 마지막 방향으로 어둠 속을 날아가 화면 밖에서 조용히 사라집니다.
  // `onExpire` 를 그대로 부르므로 수명이 다했을 때와 **같은 규칙**으로 터집니다
  // (방패 존중 · 집속탄 · 장판까지 전부). 여기서 따로 터뜨리면 그 규칙이 갈립니다.
  //
  // **어둠이 없는 판은 그대로입니다.** 대상이 없으면 직진하다 수명이 다해 터지는
  // 지금 동작이 의도된 것이고, 로직 점검 3-6 이 그것을 재고 있습니다
  if (!target && challengeVisionRadius(w) > 0) {
    onExpire(w, p);
    return;
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
      // 도전 5번의 하수인은 지뢰를 안 밟습니다. 자폭병은 스치면 점화됩니다
      if (challengeShotPassThrough(w, e)) {
        challengeMinionGrazed(w, e);
        continue;
      }
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

  // **도탄도 도발을 따릅니다** (2026-09-16 사용자 지시). 방패적이 돌진적을 막아주는
  // 그림이라, 튕겨 다니는 탄이 뒤쪽 돌진적으로 새면 그 그림이 깨집니다.
  //
  // **거리를 안 봅니다.** 도탄은 사거리 없이 경기장을 돌아다니므로 "사거리 안에
  // 도발 대상이 있는가"를 물을 기준이 없습니다. 그래서 방패적이 살아 있기만 하면
  // 걸리고, 그동안 도탄은 돌진적을 사실상 못 때립니다
  // **어둠이 있는 판에서는 보이는 적이 없으면 사라집니다** (2026-09-16 사용자 지시).
  //
  // 도탄은 맞아야 없어지는 탄이라, 어둠 속으로 들어가면 보이지도 않는 곳에서
  // 계속 튕겨 다닙니다. `nearestEnemy` 가 이미 시야와 도발을 거치므로 그 결과가
  // 비면 곧 "보이는 적이 없다"입니다.
  //
  // **어둠이 없는 판은 그대로입니다.** 적이 없어도 명중 횟수가 남는 한 계속
  // 튕기는 것이 의도된 동작이고, 로직 점검 3-6 이 그것을 재고 있습니다
  if (challengeVisionRadius(w) > 0 && !nearestEnemy(w, p.x, p.y)) {
    p.dead = true;
    return;
  }

  const taunt = tauntId(w, p.x, p.y, Infinity);
  const near = w.grid.query(p.x, p.y, p.radius + 46, buf);
  for (const e of near) {
    if (e.dead) continue;
    // 도전 5번의 하수인은 통과합니다 (`isPick` 이 무적이라 어차피 거르지만, 그 전에
    // 스친 것을 알려야 자폭병이 점화됩니다)
    if (challengeShotPassThrough(w, e)) {
      if (dist(p.x, p.y, e.x, e.y) <= p.radius + e.radius) challengeMinionGrazed(w, e);
      continue;
    }
    // 방금 때린 적은 건너뜁니다. 안 그러면 붙어 있는 동안 몇 프레임에 걸쳐 다 소진됩니다
    if (!isPick(w, e, taunt) || e.id === p.targetId) continue;
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

    // **관통 도탄은 안 틉니다** (2026-09-10). 가던 방향 그대로 지나가므로 한 프레임에
    // 여러 마리를 꿰뚫습니다. `near` 는 적마다 한 번씩만 도므로 같은 적을 두 번 때리지
    // 않습니다. 다만 **보스처럼 큰 적은 지나가는 동안 여러 프레임에 걸쳐 여러 번** 맞습니다
    // (반지름 44 면 접촉이 3프레임쯤 이어집니다). 그만큼 명중 횟수를 빨리 쓰므로
    // 스스로 제한이 걸립니다. 의도한 동작입니다.
    //
    // **벽 튕김은 그대로입니다.** 위에서 이미 했고 여기서 안 건드립니다.
    // 빼면 `직선 + 전관통 + 초고속` 이 되어 레이저와 같은 스킬이 됩니다
    if (p.straight) continue;

    // 다음 대상 쪽으로 틉니다. 남은 적이 없으면 가던 방향 그대로 벽을 타고 돌아다닙니다
    let next: Enemy | null = null;
    let bestD = Infinity;
    for (const o of w.enemies) {
      // **조준 후보 규칙(`isPick`)을 거칩니다** (2026-09-22). `canTarget` 만 보던 때는
      // 도전 5번의 무적 하수인 쪽으로 틀어서, 맞지도 않는 적을 향해 날아갔습니다
      if (!isPick(w, o, taunt) || o.id === e.id) continue;
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
    const hpBefore = pl.hp;
    w.damagePlayer(p.damage, false, p.source);
    // 봉인은 **실제로 맞았을 때만** 겁니다 (봉인적, 하드 7).
    // 무적으로 튕겨낸 탄에도 걸면 대시 무적이 절반만 일하는 셈이 됩니다
    if (p.seal > 0 && pl.hp < hpBefore) w.sealRandomSkill(p.seal);
  }
}

/**
 * 명중한 자리에서 탄을 갈라냅니다 (분열 도탄·분열 미사일).
 *
 * **세대 예산제입니다.** 자식은 부모보다 한 세대 적게 들고 나가므로 0 이 되면
 * 거기서 끝납니다. 한 발에서 나오는 탄은 `count^0 + ... + count^generations` 로
 * 표만 보고 셀 수 있습니다. 안 두면 적이 몰린 곳에서 기하급수로 불어나 화면이
 * 탄으로 덮이고 프레임이 무너집니다.
 *
 * **치명타는 자식마다 다시 굴립니다** (2026-09-10). 그대로 물려주면 발사할 때
 * 한 번 굴린 치명타가 자식 전부에 복사되어, 치명타 배율 상한 4.0 과 곱한 판이
 * 통째로 널뜁니다. 갈라지는 탄이 많을수록 그 진폭이 커지므로 반드시 다시 굴립니다.
 */
function splitProjectile(w: World, p: Projectile, hit: Enemy): void {
  const rule = p.splitOnHit!;
  const left = p.splitsLeft - 1;
  const speed = Math.hypot(p.vx, p.vy) || 1;
  const base = Math.atan2(p.vy, p.vx);
  const st = w.player.stats;
  // 부모의 피해에서 치명타를 걷어낸 값. 자식은 여기서 다시 굴립니다
  const raw = p.crit && st.critMult > 0 ? p.damage / st.critMult : p.damage;

  for (let i = 0; i < rule.count; i++) {
    const a = base + (i - (rule.count - 1) / 2) * 0.7;
    // 다음 대상을 물고 있으면 유도탄은 그쪽으로 이어집니다
    const next = p.kind === 'homing' ? nearestEnemy(w, p.x, p.y) : null;
    const crit = w.rng.chance(st.critChance);
    w.addProjectile({
      kind: p.kind,
      x: p.x, y: p.y,
      vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
      radius: p.radius, damage: raw * (crit ? st.critMult : 1), crit, color: p.color,
      life: Math.max(0.6, p.life), blast: p.blast, turnRate: p.turnRate,
      targetId: next && next.id !== hit.id ? next.id : 0,
      pierce: p.pierce, ignoreShield: p.ignoreShield,
      splitOnHit: left > 0 ? rule : null,
      splitsLeft: left,
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
    // 도전 5번 소환의 하수인은 통과합니다. 자폭병은 스치면 점화됩니다
    if (challengeShotPassThrough(w, e)) {
      challengeMinionGrazed(w, e);
      continue;
    }

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
