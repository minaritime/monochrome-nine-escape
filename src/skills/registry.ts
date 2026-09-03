import { CANVAS, SKILLS, SKILL_MAX_LEVEL } from '../data/balance';
import type { SkillBranchId } from '../data/balance';
import { angleTo, clamp, dist, distToRay } from '../core/math';
import { clampToArena } from '../game/collision';
import { cooldownFor } from '../game/stats';
import type { Enemy, SkillSlot, StatBlock } from '../game/types';
import type { World } from '../game/world';
import { NEUTRAL_MODS, branchMods } from './branches';
import type { SkillDef, SkillId } from './types';
import { bestLineDirection, canTarget, densestDirection, densestPoint, farthestEnemy, highestHpEnemy, lowestHpEnemies, nearestEnemy } from './targeting';

/** 레벨 1 을 기준으로 레벨당 증가분을 더합니다 */
export function lv(base: number, perLevel: number, level: number): number {
  return base + perLevel * (level - 1);
}

/** 치명타를 굴려 최종 피해를 냅니다 */
export function rollDamage(w: World, mult: number): { damage: number; crit: boolean } {
  const s = w.player.stats;
  const crit = w.rng.chance(s.critChance);
  return { damage: s.attack * mult * (crit ? s.critMult : 1), crit };
}

const S = SKILLS;

/**
 * 화염방사기의 부채꼴 **반각**. 레벨당 1도씩 벌어집니다.
 * 조준·피해 판정·불티 그리기가 전부 이 값을 봐야 합니다. 한 곳이라도 상수를 직접 읽으면
 * 보이는 범위와 실제로 타는 범위가 어긋납니다.
 */
function flameSpread(level: number): number {
  return lv(S.flame.spread, S.flame.spreadPerLevel, level);
}

/**
 * 한 번에 까는 지뢰 개수. 5개에서 멈추고 그 뒤로는 위력만 오릅니다.
 * 개수가 계속 늘면 한 번 발동에 화면이 지뢰로 덮여서, 밟는 위치를 고르는 재미가 사라집니다.
 */
function mineCount(level: number): number {
  return Math.min(S.mine.countMax, Math.round(lv(S.mine.count, S.mine.countPerLevel, level)));
}

export const SKILL_DEFS: Record<SkillId, SkillDef> = {
  // -------------------------------------------------------------------------
  shotgun: {
    id: 'shotgun',
    kind: 'attack',
    family: 'bullet',
    name: '산탄',
    color: '#ffb457',
    targeting: 'densestDir',
    targetingLabel: '적이 가장 밀집한 방향',
    desc: '근거리 부채꼴로 여러 발을 뿌립니다',
    counters: '몰린 무리',
    sustained: false,
    cooldown: S.shotgun.cooldown,
    levelText: (l, m = NEUTRAL_MODS) =>
      `${Math.max(1, Math.round(lv(S.shotgun.pellets, S.shotgun.pelletsPerLevel, l) * m.countMul))}발`
      + ` · 발당 공격력 ${Math.round(lv(S.shotgun.damage, S.shotgun.damagePerLevel, l) * m.damageMul * 100)}%`
      + ` · 사거리 ${Math.round(S.shotgun.range * m.rangeMul)}`,
    activate: (w, slot) => {
      const p = w.player;
      const b = branchMods(slot);
      const spread = S.shotgun.spread * b.spreadMul;
      const range = S.shotgun.range * b.rangeMul;
      const dir = densestDirection(w, p.x, p.y, range, spread);
      if (dir === null) return false;
      const pellets = Math.max(1, Math.round(lv(S.shotgun.pellets, S.shotgun.pelletsPerLevel, slot.level) * b.countMul));
      const mult = lv(S.shotgun.damage, S.shotgun.damagePerLevel, slot.level) * b.damageMul;
      for (let i = 0; i < pellets; i++) {
        const t = pellets === 1 ? 0 : (i / (pellets - 1) - 0.5) * 2;
        const a = dir + t * spread + w.rng.range(-0.04, 0.04);
        const { damage, crit } = rollDamage(w, mult);
        const speed = S.shotgun.speed * w.rng.range(0.9, 1.1) * b.speedMul;
        w.addProjectile({
          x: p.x, y: p.y,
          vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
          radius: 4.5, damage, crit, color: '#ffb457',
          life: range / (S.shotgun.speed * b.speedMul),
          knockback: S.shotgun.knockback * b.knockbackMul,
          // 방패에 막히면 화상도 안 붙습니다 (`hitEnemies` 의 `dealt > 0`)
          burnDps: b.burn ? w.player.stats.attack * b.burn.dps : 0,
          burnTime: b.burn ? b.burn.time : 0,
        });
      }
      w.effects.spray(p.x, p.y, dir, spread, 10, '#ffb457', 220);
      w.effects.addShake(2.5);
      return true;
    },
  },

  // -------------------------------------------------------------------------
  sniper: {
    id: 'sniper',
    kind: 'attack',
    family: 'bullet',
    name: '스나이퍼',
    color: '#7ee0ff',
    targeting: 'highestHp',
    targetingLabel: '체력이 가장 많이 남은 적',
    desc: '가장 단단한 하나를 꿰뚫는 고위력 단발. 대상의 최대 체력에 비례해 더 아픕니다',
    counters: '탱커, 보스, 정예',
    sustained: false,
    cooldown: S.sniper.cooldown,
    levelText: (l, m = NEUTRAL_MODS) =>
      `공격력 ${Math.round(lv(S.sniper.damage, S.sniper.damagePerLevel, l) * m.damageMul * 100)}%`
      + ` + 대상 최대 체력 ${Math.round(lv(S.sniper.hpRatio, S.sniper.hpRatioPerLevel, l) * m.hpBonusMul * 100)}%`
      + (m.execute ? ` · 체력 ${Math.round(m.execute.hpRatio * 100)}% 이하 x${m.execute.mul}` : '')
      + ' · 단일 대상',
    activate: (w, slot) => {
      const p = w.player;
      const b = branchMods(slot);
      const target = highestHpEnemy(w);
      if (!target) return false;
      const a = angleTo(p.x, p.y, target.x, target.y);
      const { damage, crit } = rollDamage(w, lv(S.sniper.damage, S.sniper.damagePerLevel, slot.level) * b.damageMul);
      w.addProjectile({
        x: p.x, y: p.y,
        vx: Math.cos(a) * S.sniper.speed * b.speedMul, vy: Math.sin(a) * S.sniper.speed * b.speedMul,
        radius: S.sniper.radius, damage, crit, color: '#7ee0ff',
        life: 2, ignoreShield: true,
        hpBonus: lv(S.sniper.hpRatio, S.sniper.hpRatioPerLevel, slot.level) * b.hpBonusMul,
        execute: b.execute,
      });
      w.effects.spray(p.x, p.y, a, 0.08, 8, '#7ee0ff', 320);
      w.effects.addShake(3);
      return true;
    },
  },

  // -------------------------------------------------------------------------
  flame: {
    id: 'flame',
    kind: 'attack',
    family: 'overtime',
    name: '화염방사기',
    color: '#ff7a3d',
    targeting: 'densestDir',
    targetingLabel: '적이 가장 밀집한 방향',
    desc: '부채꼴로 지속 분사합니다. 화상 중에는 체력 재생이 멈추고 느려집니다',
    counters: '무리, 분열적, 정예 탱커',
    sustained: true,
    cooldown: S.flame.cooldown,
    levelText: (l, m = NEUTRAL_MODS) =>
      `초당 공격력 ${Math.round(lv(S.flame.damage, S.flame.damagePerLevel, l) * m.damageMul * 100)}%` +
      ` · ${(lv(S.flame.duration, S.flame.durationPerLevel, l) * m.durationMul).toFixed(1)}초` +
      ` · 사거리 ${Math.round(S.flame.range * m.rangeMul)}` +
      ` · 각도 ${Math.round((m.spread ?? flameSpread(l) * m.spreadMul) * 2 * 180 / Math.PI)}°`,
    activate: (_w, slot) => {
      slot.active = lv(S.flame.duration, S.flame.durationPerLevel, slot.level) * branchMods(slot).durationMul;
      slot.tick = 0;
      return true;
    },
    sustain: (w, slot, dt) => {
      const p = w.player;
      const b = branchMods(slot);
      // 갈래가 반각을 통째로 갈아끼울 수 있습니다 (가스 분출 = Math.PI = 전방위).
      // 조준·판정·불티가 전부 이 값 하나만 보므로 세 곳이 저절로 맞습니다
      const spread = b.spread ?? flameSpread(slot.level) * b.spreadMul;
      const range = S.flame.range * b.rangeMul;
      const dir = densestDirection(w, p.x, p.y, range, spread) ?? p.facing;
      // 사거리를 선으로 긋지 않고 불티만으로 보여줍니다.
      // 불티는 부채꼴 끝까지 닿되 경계는 흐릿하게 남습니다
      w.effects.coneJet(p.x, p.y, dir, spread, range, 9);
      slot.tick -= dt;
      if (slot.tick > 0) return;
      slot.tick = S.flame.tick;

      const dps = lv(S.flame.damage, S.flame.damagePerLevel, slot.level) * b.damageMul;
      const perTick = w.player.stats.attack * dps * S.flame.tick;
      for (const e of w.enemies) {
        if (!canTarget(e)) continue;
        const d = dist(p.x, p.y, e.x, e.y);
        if (d > range + e.radius) continue;
        const diff = Math.abs(((angleTo(p.x, p.y, e.x, e.y) - dir + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (diff > spread) continue;
        w.damageEnemy(e, perTick, { fromX: p.x, fromY: p.y, showNumber: false });
        // 화상이 붙어 있는 동안 재생이 멈추고 이동속도가 곱연산으로 깎입니다.
        // 둘 다 `enemies/update.ts` 에서 `burnTime > 0` 하나만 보고 처리합니다
        e.burnDps = Math.max(e.burnDps, w.player.stats.attack * S.flame.burnDps);
        e.burnTime = S.flame.burnTime;
      }
    },
  },

  // -------------------------------------------------------------------------
  laser: {
    id: 'laser',
    kind: 'attack',
    family: 'pierce',
    name: '레이저',
    color: '#c06bff',
    targeting: 'bestLine',
    targetingLabel: '일직선에 가장 많이 걸리는 방향',
    desc: '즉발로 화면 끝까지 전부 관통합니다',
    counters: '일렬 무리',
    sustained: false,
    cooldown: S.laser.cooldown,
    levelText: (l, m = NEUTRAL_MODS) =>
      `공격력 ${Math.round(lv(S.laser.damage, S.laser.damagePerLevel, l) * m.damageMul * 100)}%`
      + ` · 폭 ${Math.round(lv(S.laser.width, S.laser.widthPerLevel, l) * m.sizeMul)}`
      + (m.burn ? ` · 화상 초당 ${Math.round(m.burn.dps * 100)}%` : ''),
    activate: (w, slot) => {
      const p = w.player;
      const b = branchMods(slot);
      const width = lv(S.laser.width, S.laser.widthPerLevel, slot.level) * b.sizeMul;
      const dir = bestLineDirection(w, p.x, p.y, width);
      if (dir === null) return false;
      const mult = lv(S.laser.damage, S.laser.damagePerLevel, slot.level) * b.damageMul;
      const far = Math.hypot(CANVAS.w, CANVAS.h);
      for (const e of w.enemies) {
        if (!canTarget(e)) continue;
        if (distToRay(p.x, p.y, dir, e.x, e.y) <= width / 2 + e.radius) {
          const { damage, crit } = rollDamage(w, mult);
          const dealt = w.damageEnemy(e, damage, { crit, fromX: p.x, fromY: p.y, ignoreShield: true });
          // 화상은 합해지지 않고 가장 센 것 하나만 남습니다
          if (dealt > 0 && b.burn) {
            e.burnDps = Math.max(e.burnDps, w.player.stats.attack * b.burn.dps);
            e.burnTime = Math.max(e.burnTime, b.burn.time);
          }
        }
      }
      w.addTelegraph({
        kind: 'line', x: p.x, y: p.y,
        x2: p.x + Math.cos(dir) * far, y2: p.y + Math.sin(dir) * far,
        width, life: 0.22, color: '#c06bff',
      });
      w.effects.addShake(4);
      return true;
    },
  },

  // -------------------------------------------------------------------------
  grenade: {
    id: 'grenade',
    kind: 'attack',
    family: 'blast',
    name: '유탄',
    color: '#8fe36b',
    targeting: 'densestPoint',
    targetingLabel: '적이 가장 밀집한 지점',
    desc: '포물선으로 날아가 착탄 지점에서 폭발합니다',
    counters: '밀집 무리',
    sustained: false,
    cooldown: S.grenade.cooldown,
    levelText: (l, m = NEUTRAL_MODS) =>
      `공격력 ${Math.round(lv(S.grenade.damage, S.grenade.damagePerLevel, l) * m.damageMul * 100)}%`
      + ` · 반경 ${Math.round(lv(S.grenade.blast, S.grenade.blastPerLevel, l) * m.sizeMul)}`
      + (m.cluster ? ` · 자탄 ${m.cluster.count}발` : ''),
    activate: (w, slot) => {
      const p = w.player;
      const b = branchMods(slot);
      const blast = lv(S.grenade.blast, S.grenade.blastPerLevel, slot.level) * b.sizeMul;
      const point = densestPoint(w, p.x, p.y, 620, blast);
      if (!point) return false;
      const a = angleTo(p.x, p.y, point.x, point.y);
      const { damage, crit } = rollDamage(w, lv(S.grenade.damage, S.grenade.damagePerLevel, slot.level) * b.damageMul);
      w.addProjectile({
        kind: 'lob',
        x: p.x, y: p.y,
        vx: Math.cos(a) * S.grenade.travelSpeed, vy: Math.sin(a) * S.grenade.travelSpeed,
        destX: point.x, destY: point.y,
        radius: 7, damage, crit, color: '#8fe36b', blast, life: 4,
        cluster: b.cluster,
      });
      return true;
    },
  },

  // -------------------------------------------------------------------------
  missile: {
    id: 'missile',
    kind: 'attack',
    family: 'blast',
    name: '추적 미사일',
    color: '#ff8ab5',
    targeting: 'lowestHp',
    targetingLabel: '체력이 가장 적게 남은 적',
    desc: '유도되는 저위력 다발. 마무리에 강하지만 방패에 막힙니다',
    counters: '마무리',
    sustained: false,
    cooldown: S.missile.cooldown,
    levelText: (l, m = NEUTRAL_MODS) =>
      `${Math.max(1, Math.round(lv(S.missile.count, S.missile.countPerLevel, l) * m.countMul))}발`
      + ` · 발당 공격력 ${Math.round(lv(S.missile.damage, S.missile.damagePerLevel, l) * m.damageMul * 100)}%`
      + ` · 폭발 반경 ${Math.round(S.missile.blast * m.sizeMul)}`,
    activate: (w, slot) => {
      const p = w.player;
      const b = branchMods(slot);
      const count = Math.max(1, Math.round(lv(S.missile.count, S.missile.countPerLevel, slot.level) * b.countMul));
      const targets = lowestHpEnemies(w, count, p.x, p.y);
      if (targets.length === 0) return false;
      const mult = lv(S.missile.damage, S.missile.damagePerLevel, slot.level) * b.damageMul;
      for (let i = 0; i < count; i++) {
        const t = targets[i % targets.length];
        const a = w.rng.angle();
        const { damage, crit } = rollDamage(w, mult);
        w.addProjectile({
          kind: 'homing',
          x: p.x, y: p.y,
          vx: Math.cos(a) * S.missile.speed * 0.6, vy: Math.sin(a) * S.missile.speed * 0.6,
          radius: 5, damage, crit, color: '#ff8ab5',
          life: S.missile.life, targetId: t.id,
          turnRate: S.missile.turnRate * b.turnRateMul, blast: S.missile.blast * b.sizeMul,
          splitOnHit: b.splitOnHit,
          splitsLeft: b.splitOnHit ? b.splitOnHit.max : 0,
          // 방패를 뚫지 않습니다 (2026-08-12). 산탄·화염과 함께 셋뿐입니다.
          // 나머지가 전부 방패를 무시하면 방패적이라는 적 자체가 무의미해집니다
        });
      }
      return true;
    },
  },

  // -------------------------------------------------------------------------
  chain: {
    id: 'chain',
    kind: 'attack',
    family: 'pierce',
    name: '체인 라이트닝',
    color: '#7dd3fc',
    targeting: 'nearest',
    targetingLabel: '가장 가까운 적에서 시작해 거리 제한 없이 연쇄',
    desc: '연쇄 횟수만큼 반드시 때리고 잠시 마비시킵니다. 맞은 적에서 가장 가까운 다음 적으로 튑니다',
    counters: '무리',
    sustained: false,
    cooldown: S.chain.cooldown,
    levelText: (l, m = NEUTRAL_MODS) =>
      `공격력 ${Math.round(lv(S.chain.damage, S.chain.damagePerLevel, l) * m.damageMul * 100)}%` +
      ` · ${Math.max(1, Math.round(lv(S.chain.jumps, S.chain.jumpsPerLevel, l) * m.jumpsMul))}회 연쇄` +
      ` · 감쇠 ${((m.falloff ?? S.chain.falloff) * 100).toFixed(0)}%` +
      ` · 마비 ${(S.chain.stun * m.stunMul).toFixed(1)}초`,
    activate: (w, slot) => {
      const p = w.player;
      const b = branchMods(slot);
      let current = nearestEnemy(w, p.x, p.y);
      if (!current) return false;
      const jumps = Math.max(1, Math.round(lv(S.chain.jumps, S.chain.jumpsPerLevel, slot.level) * b.jumpsMul));
      let mult = lv(S.chain.damage, S.chain.damagePerLevel, slot.level) * b.damageMul;
      const hit = new Set<number>();
      let fromX = p.x;
      let fromY = p.y;

      for (let i = 0; i < jumps && current; i++) {
        hit.add(current.id);
        const { damage, crit } = rollDamage(w, mult);
        w.addTelegraph({ kind: 'line', x: fromX, y: fromY, x2: current.x, y2: current.y, width: 3, life: 0.16, color: '#7dd3fc' });
        w.effects.burst(current.x, current.y, 5, '#7dd3fc', 120, 2, 0.25);
        fromX = current.x;
        fromY = current.y;
        w.damageEnemy(current, damage, { crit, fromX: p.x, fromY: p.y, ignoreShield: true });
        // 보스 저항은 `stunEnemy` 가 알아서 겁니다. `e.stun` 을 직접 만지지 마십시오
        w.stunEnemy(current, S.chain.stun * b.stunMul);
        mult *= b.falloff ?? S.chain.falloff;

        // 방금 때린 적을 기준으로 가장 가까운 다음 적. 거리 제한은 없습니다.
        // 남은 대상이 없을 때만 끊깁니다 (balance.ts 의 chain 주석 참고)
        let next: Enemy | null = null;
        let bestD = Infinity;
        for (const e of w.enemies) {
          if (!canTarget(e) || hit.has(e.id)) continue;
          const d = dist(fromX, fromY, e.x, e.y);
          if (d < bestD) {
            bestD = d;
            next = e;
          }
        }
        current = next;
      }
      return true;
    },
  },

  // -------------------------------------------------------------------------
  ricochet: {
    id: 'ricochet',
    kind: 'attack',
    family: 'bullet',
    name: '도탄',
    color: '#ffd166',
    targeting: 'nearest',
    targetingLabel: '가장 가까운 적. 맞으면 다음 가까운 적으로 튕깁니다',
    desc: '벽과 적을 튕겨 다니는 탄 하나. 벽 튕김은 횟수를 쓰지 않습니다',
    counters: '흩어진 무리, 좁은 구석',
    sustained: false,
    cooldown: S.ricochet.cooldown,
    levelText: (l, m = NEUTRAL_MODS) =>
      `공격력 ${Math.round(lv(S.ricochet.damage, S.ricochet.damagePerLevel, l) * m.damageMul * 100)}%` +
      ` · ${Math.max(1, Math.round(lv(S.ricochet.bounces, S.ricochet.bouncesPerLevel, l) * m.pierceMul))}회 명중` +
      (m.splitOnHit ? ` · 맞을 때마다 ${m.splitOnHit.count}갈래` : ''),
    activate: (w, slot) => {
      const p = w.player;
      const b = branchMods(slot);
      const target = nearestEnemy(w, p.x, p.y);
      if (!target) return false;
      const a = angleTo(p.x, p.y, target.x, target.y);
      const speed = S.ricochet.speed * b.speedMul;
      const { damage, crit } = rollDamage(w, lv(S.ricochet.damage, S.ricochet.damagePerLevel, slot.level) * b.damageMul);
      w.addProjectile({
        kind: 'ricochet',
        x: p.x, y: p.y,
        vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
        radius: S.ricochet.radius, damage, crit, color: '#ffd166',
        // 남은 명중 횟수를 pierce 칸에 담습니다 (관통과 뜻이 같아서 칸을 나눌 이유가 없습니다)
        pierce: Math.max(1, Math.round(lv(S.ricochet.bounces, S.ricochet.bouncesPerLevel, slot.level) * b.pierceMul)),
        life: 6,
        ignoreShield: true,
        splitOnHit: b.splitOnHit,
        splitsLeft: b.splitOnHit ? b.splitOnHit.max : 0,
      });
      return true;
    },
  },

  // -------------------------------------------------------------------------
  harpoon: {
    id: 'harpoon',
    kind: 'attack',
    family: 'pierce',
    name: '작살',
    color: '#9be7c4',
    targeting: 'farthest',
    targetingLabel: '가장 먼 적',
    desc: '직선상의 적을 전부 꿰뚫고 끌어당깁니다. 피해보다 모으는 것이 목적입니다',
    counters: '소환적, 원거리적, 겁쟁이',
    sustained: false,
    cooldown: S.harpoon.cooldown,
    levelText: (l, m = NEUTRAL_MODS) =>
      `공격력 ${Math.round(lv(S.harpoon.damage, S.harpoon.damagePerLevel, l) * m.damageMul * 100)}%` +
      ` · 폭 ${Math.round(lv(S.harpoon.width, S.harpoon.widthPerLevel, l) * m.sizeMul)}` +
      (m.stunOnHit ? ` · 기절 ${m.stunOnHit.toFixed(1)}초` : ' · 끌어당김'),
    activate: (w, slot) => {
      const p = w.player;
      const b = branchMods(slot);
      const target = farthestEnemy(w, p.x, p.y);
      if (!target) return false;
      const a = angleTo(p.x, p.y, target.x, target.y);
      const width = lv(S.harpoon.width, S.harpoon.widthPerLevel, slot.level) * b.sizeMul;
      const mult = lv(S.harpoon.damage, S.harpoon.damagePerLevel, slot.level) * b.damageMul;
      const far = dist(p.x, p.y, target.x, target.y);

      for (const e of w.enemies) {
        if (!canTarget(e)) continue;
        if (distToRay(p.x, p.y, a, e.x, e.y) > width / 2 + e.radius) continue;
        // 작살 뒤쪽(반대 방향)의 적은 안 걸립니다. 선이 아니라 **던진 방향**이라야 말이 됩니다
        if ((e.x - p.x) * Math.cos(a) + (e.y - p.y) * Math.sin(a) < 0) continue;
        const { damage, crit } = rollDamage(w, mult);
        // knockback 에 음수를 주면 밀어내는 대신 끌어옵니다. 보스는 원래 안 밀리므로 안 끌려옵니다
        const dealt = w.damageEnemy(e, damage, { crit, fromX: p.x, fromY: p.y, knockback: -S.harpoon.pull * b.pullMul, ignoreShield: true });
        // 보스 저항은 `stunEnemy` 가 알아서 겁니다
        if (dealt > 0 && b.stunOnHit) w.stunEnemy(e, b.stunOnHit);
      }

      w.addTelegraph({
        kind: 'line', x: p.x, y: p.y,
        x2: p.x + Math.cos(a) * far, y2: p.y + Math.sin(a) * far,
        width, life: 0.26, color: '#9be7c4',
      });
      w.effects.spray(p.x, p.y, a, 0.06, 6, '#9be7c4', 300);
      w.effects.addShake(3);
      return true;
    },
  },

  // -------------------------------------------------------------------------
  orbit: {
    id: 'orbit',
    kind: 'attack',
    family: 'overtime',
    name: '회전 궤도',
    color: '#ffe08a',
    targeting: 'none',
    targetingLabel: '없음 (자기 중심)',
    desc: '주위를 도는 구체가 닿는 적을 계속 때립니다. 항상 켜져 있습니다',
    counters: '겁쟁이적, 자폭적',
    sustained: false,
    cooldown: S.orbit.cooldown,
    levelText: (l, m = NEUTRAL_MODS) =>
      `구체 ${Math.max(1, Math.round(lv(S.orbit.count, S.orbit.countPerLevel, l) * m.countMul))}개`
      + ` · 공격력 ${Math.round(lv(S.orbit.damage, S.orbit.damagePerLevel, l) * m.damageMul * 100)}%`
      + ` · 크기 ${Math.round(S.orbit.bodyRadius * m.sizeMul)}`
      + (m.orbFragment ? ' · 스칠 때마다 폭발' : ' · 항상 유지'),
    /**
     * 쿨다운이 0 이라 매 프레임 불립니다. 그래서 "필요하면 맞춘다"만 합니다.
     * 개수가 맞으면 아무것도 하지 않고 false 를 돌려주므로 구체가 쌓이지 않습니다.
     * 공격력은 매번 갱신합니다. 안 그러면 레벨업으로 공격력이 올라도 처음 값 그대로 돕니다.
     */
    activate: (w, slot) => {
      const p = w.player;
      const b = branchMods(slot);
      const count = Math.max(1, Math.round(lv(S.orbit.count, S.orbit.countPerLevel, slot.level) * b.countMul));
      const mult = lv(S.orbit.damage, S.orbit.damagePerLevel, slot.level) * b.damageMul;
      const damage = p.stats.attack * mult;

      const orbs = w.projectiles.filter((o) => o.kind === 'orbit' && !o.dead);
      if (orbs.length === count) {
        for (const o of orbs) o.damage = damage;
        return false;
      }

      // 개수가 다르면(첫 배치 · 레벨업 · 갈래 선택) 통째로 다시 깝니다
      for (const o of orbs) o.dead = true;
      for (let i = 0; i < count; i++) {
        w.addProjectile({
          kind: 'orbit',
          x: p.x, y: p.y,
          // sizeMul 은 **구체 크기**입니다. 공전 반경(orbitRadius)이 아닙니다.
          // 공전 반경을 건드리면 타격 간격도 `0.32 x 70/반경` 으로 같이 맞춰야 합니다
          radius: S.orbit.bodyRadius * b.sizeMul,
          damage,
          color: '#ffe08a',
          life: Infinity,
          orbitAngle: (i / count) * Math.PI * 2,
          orbitRadius: S.orbit.radius,
          orbitSpeed: S.orbit.angularSpeed,
          pierce: 9999,
          arm: 0,
          ignoreShield: true,
          orbFragment: b.orbFragment,
        });
      }
      return false;
    },
  },

  // -------------------------------------------------------------------------
  mine: {
    id: 'mine',
    kind: 'attack',
    family: 'blast',
    name: '지뢰',
    color: '#ff6b6b',
    targeting: 'none',
    targetingLabel: '없음 (발밑 설치)',
    desc: '밟으면 터집니다. 추격자를 떼어낼 때 씁니다',
    counters: '추격자',
    sustained: false,
    cooldown: S.mine.cooldown,
    levelText: (l, m = NEUTRAL_MODS) =>
      `${Math.max(1, Math.round(mineCount(l) * m.countMul))}개`
      + ` · 공격력 ${Math.round(lv(S.mine.damage, S.mine.damagePerLevel, l) * m.damageMul * 100)}%`
      + ` · 반경 ${Math.round(S.mine.blast * m.sizeMul)}`,
    activate: (w, slot) => {
      const p = w.player;
      const b = branchMods(slot);
      const count = Math.max(1, Math.round(mineCount(slot.level) * b.countMul));
      const mult = lv(S.mine.damage, S.mine.damagePerLevel, slot.level) * b.damageMul;
      const blast = S.mine.blast * b.sizeMul;

      for (let i = 0; i < count; i++) {
        // 첫 한 개는 반드시 발밑입니다. "지나온 자리에 남긴다"가 이 스킬의 정체라,
        // 그것까지 흩어지면 쫓기면서 뒤에 두고 가는 사용법이 사라집니다
        const pos = { x: p.x, y: p.y };
        if (i > 0) {
          const a = w.rng.angle();
          // sqrt 를 씌워야 원 안이 고르게 찹니다. 그냥 곱하면 가운데로 몰립니다
          const r = S.mine.spread * Math.sqrt(w.rng.range(0, 1));
          pos.x += Math.cos(a) * r;
          pos.y += Math.sin(a) * r;
          // 경기장 밖에 깔리면 밟히지도 보이지도 않습니다
          clampToArena(pos, S.mine.radius, 0);
        }
        const { damage, crit } = rollDamage(w, mult);
        w.addProjectile({
          kind: 'mine',
          x: pos.x, y: pos.y,
          radius: S.mine.radius, damage, crit, color: '#ff6b6b',
          life: S.mine.life, blast, arm: S.mine.arm,
          // 터지는 시점에는 슬롯이 없으므로 결과물을 지금 실어 보냅니다
          blastHazard: b.blastHazard,
        });
      }
      return true;
    },
  },

  // -------------------------------------------------------------------------
  aura: {
    id: 'aura',
    kind: 'attack',
    family: 'overtime',
    name: '오라',
    color: '#9be7c4',
    targeting: 'none',
    targetingLabel: '없음 (주변 전체)',
    desc: '주변 적에게 지속 피해를 주고 느리게 만듭니다',
    counters: '근접 전반',
    sustained: true,
    cooldown: S.aura.cooldown,
    levelText: (l, m = NEUTRAL_MODS) =>
      `초당 공격력 ${Math.round(lv(S.aura.damage, S.aura.damagePerLevel, l) * m.damageMul * 100)}%`
      + ` · 반경 ${Math.round(lv(S.aura.radius, S.aura.radiusPerLevel, l) * m.sizeMul)}`
      + ` · ${(lv(S.aura.duration, S.aura.durationPerLevel, l) * m.durationMul).toFixed(1)}초`
      + (m.endBlast ? ' · 꺼질 때 폭발' : ''),
    activate: (_w, slot) => {
      slot.active = lv(S.aura.duration, S.aura.durationPerLevel, slot.level) * branchMods(slot).durationMul;
      slot.tick = 0;
      return true;
    },
    sustain: (w, slot, dt) => {
      const player = w.player;
      const b = branchMods(slot);
      const radius = lv(S.aura.radius, S.aura.radiusPerLevel, slot.level) * b.sizeMul;
      // 반경을 원으로 그리지 않고 흩어지는 기운으로만 보여줍니다
      w.effects.auraMotes(player.x, player.y, radius, 2, '#9be7c4');

      const dps = lv(S.aura.damage, S.aura.damagePerLevel, slot.level) * b.damageMul;

      // 파열: 꺼지는 순간 반경 전체가 통째로 터집니다.
      // `slot.active` 는 `tickSlot` 이 먼저 깎으므로 여기서 0 이하면 이번이 마지막 프레임입니다
      if (b.endBlast && slot.active <= 0) {
        w.explode(player.x, player.y, radius, w.player.stats.attack * dps * b.endBlast.damageMul, true, '#9be7c4');
      }

      slot.tick -= dt;
      if (slot.tick > 0) return;
      slot.tick = S.aura.tick;
      const p = w.player;
      const perTick = w.player.stats.attack * dps * S.aura.tick;
      for (const e of w.enemies) {
        if (!canTarget(e)) continue;
        if (dist(p.x, p.y, e.x, e.y) > radius + e.radius) continue;
        w.damageEnemy(e, perTick, { fromX: p.x, fromY: p.y, showNumber: false, ignoreShield: true });
        w.slowEnemy(e, b.slow ?? S.aura.slow, S.aura.tick * 1.5);
      }
    },
  },

  // -------------------------------------------------------------------------
  dash: {
    id: 'dash',
    kind: 'utility',
    name: '대시',
    color: '#a3b8ff',
    targeting: 'none',
    targetingLabel: '없음 (이동 방향)',
    desc: '짧게 무적으로 치고 나갑니다',
    counters: '회피',
    sustained: false,
    cooldown: S.dash.cooldown,
    levelText: (l) => `거리 ${Math.round(lv(S.dash.distance, S.dash.distancePerLevel, l))} · 무적`,
    activate: (w, slot) => {
      const p = w.player;
      const distance = lv(S.dash.distance, S.dash.distancePerLevel, slot.level);
      p.dashTime = S.dash.time;
      p.dashAngle = p.facing;
      p.dashSpeed = distance / S.dash.time;
      p.invuln = Math.max(p.invuln, S.dash.time + S.dash.invulnAfter);
      w.effects.spray(p.x, p.y, p.facing + Math.PI, 0.5, 14, '#a3b8ff', 200, 3);
      return true;
    },
  },

  // -------------------------------------------------------------------------
  knockback: {
    id: 'knockback',
    kind: 'utility',
    name: '넉백 폭발',
    color: '#ffd166',
    targeting: 'none',
    targetingLabel: '없음 (주변 전체)',
    desc: '주변 적을 강하게 밀어내고 오래 기절시킵니다. 대가로 내 최대 체력을 깎습니다',
    counters: '포위 탈출',
    sustained: false,
    cooldown: S.knockback.cooldown,
    levelText: (l) =>
      `반경 ${Math.round(lv(S.knockback.radius, S.knockback.radiusPerLevel, l))}` +
      ` · 공격력 ${Math.round(lv(S.knockback.damage, S.knockback.damagePerLevel, l) * 100)}%` +
      ` · 기절 ${S.knockback.stun.toFixed(1)}초 · 내 체력 ${Math.round(S.knockback.selfDamageRatio * 100)}% 소모`,
    activate: (w, slot) => {
      const p = w.player;
      const radius = lv(S.knockback.radius, S.knockback.radiusPerLevel, slot.level);
      const mult = lv(S.knockback.damage, S.knockback.damagePerLevel, slot.level);
      for (const e of w.enemies) {
        if (e.dead) continue; // 은신적도 밀려납니다 (타겟팅이 아니라 물리력이므로)
        if (dist(p.x, p.y, e.x, e.y) > radius + e.radius) continue;
        const { damage, crit } = rollDamage(w, mult);
        w.damageEnemy(e, damage, { crit, fromX: p.x, fromY: p.y, knockback: S.knockback.force, ignoreShield: true });
        w.stunEnemy(e, S.knockback.stun);
      }
      w.addTelegraph({ kind: 'blast', x: p.x, y: p.y, radius, life: 0.3, color: '#ffd166' });
      w.effects.burst(p.x, p.y, 26, '#ffd166', 300, 4, 0.45);
      w.effects.addShake(9);
      // 대가는 맨 마지막에 치릅니다. 이걸로 죽으면 판이 끝나는데, 먼저 깎으면
      // 죽은 뒤에 폭발이 일어나는 순서가 되어 마지막 한 방이 사라집니다.
      // **최대 체력** 기준이라 쓸수록 진짜로 죽음에 가까워집니다 (현재 체력 기준이면 절대 안 죽습니다)
      w.spendHp(p.stats.maxHp * S.knockback.selfDamageRatio);
      return true;
    },
  },

  // -------------------------------------------------------------------------
  timeslow: {
    id: 'timeslow',
    kind: 'utility',
    name: '시간 감속',
    color: '#c8d6ff',
    targeting: 'none',
    targetingLabel: '없음 (전체)',
    desc: '잠깐 모든 적과 적탄을 느리게 만듭니다',
    counters: '위기 탈출',
    sustained: false,
    cooldown: S.timeslow.cooldown,
    levelText: (l) => `${lv(S.timeslow.duration, S.timeslow.durationPerLevel, l).toFixed(1)}초 · 적과 적탄 속도 ${Math.round(S.timeslow.scale * 100)}%`,
    activate: (w, slot) => {
      w.applyTimeSlow(S.timeslow.scale, lv(S.timeslow.duration, S.timeslow.durationPerLevel, slot.level));
      w.effects.addShake(4);
      return true;
    },
  },

  // -------------------------------------------------------------------------
  medkit: {
    id: 'medkit',
    kind: 'utility',
    name: '긴급 의약품',
    color: '#6ee7a0',
    targeting: 'none',
    targetingLabel: '없음 (자신)',
    desc: '최대 체력의 일부를 즉시 회복합니다',
    counters: '버티기',
    sustained: false,
    cooldown: S.medkit.cooldown,
    levelText: (l) => `최대 체력 ${Math.round(lv(S.medkit.heal, S.medkit.healPerLevel, l) * 100)}% 회복`,
    /**
     * 체력이 가득 차 있으면 false 를 돌려 쿨다운을 태우지 않습니다.
     * 20초짜리를 잘못 눌러 통째로 날리면 그 뒤 20초가 순전히 실수의 대가가 됩니다.
     */
    activate: (w, slot) => {
      const p = w.player;
      if (p.hp >= p.stats.maxHp) return false;
      const ratio = lv(S.medkit.heal, S.medkit.healPerLevel, slot.level);
      w.healPlayer(p.stats.maxHp * ratio);
      w.effects.burst(p.x, p.y, 18, '#6ee7a0', 190, 3, 0.5);
      return true;
    },
  },
};

export const ALL_SKILL_IDS = Object.keys(SKILL_DEFS) as SkillId[];
export const ATTACK_SKILL_IDS = ALL_SKILL_IDS.filter((id) => SKILL_DEFS[id].kind === 'attack');
export const UTILITY_SKILL_IDS = ALL_SKILL_IDS.filter((id) => SKILL_DEFS[id].kind === 'utility');

export function getSkillDef(id: SkillId): SkillDef {
  return SKILL_DEFS[id];
}

export function makeSlot(id: SkillId, level = 1, branch: SkillBranchId | null = null): SkillSlot {
  return { id, level: clamp(level, 1, SKILL_MAX_LEVEL), cooldown: 0, active: 0, tick: 0, branch };
}

/**
 * 이 슬롯의 실제 재사용 대기. **쿨다운을 재는 곳은 여기 하나뿐입니다.**
 *
 * 갈래 배율과 쿨다운 감소 스탯이 둘 다 여기서 걸립니다. 예전에는 `player.ts` 와
 * `hud.ts` 가 `def.cooldown` 을 따로 읽었는데, 갈래가 쿨을 바꾸는데 한 곳만 고치면
 * **막대가 엉뚱한 길이로 차오릅니다.** 게임은 안 멈추고 화면만 거짓말을 합니다.
 */
export function slotCooldown(stats: StatBlock, slot: SkillSlot): number {
  return cooldownFor(stats, getSkillDef(slot.id).cooldown * branchMods(slot).cooldownMul);
}
