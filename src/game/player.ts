import { BASIC_ATTACK, CANVAS, LEVEL, MAX_ATTACK_SKILLS, PLAYER } from '../data/balance';
import { angleTo } from '../core/math';
import { clampToArena } from './collision';
import { createStats } from './stats';
import { getSkillDef, makeSlot, rollDamage, slotCooldown } from '../skills/registry';
import { nearestEnemy } from '../skills/targeting';
import { skipCount } from '../meta/shop';
import type { SaveData } from '../meta/save';
import type { Player, SkillSlot } from './types';
import type { World } from './world';

/**
 * 손으로 쓰는 스킬은 유틸 1개뿐이라 키도 Q 하나입니다.
 * 숫자키를 쓰면 스킬을 연타하다가 레벨업 선택 화면에서 실수로 골라버립니다.
 */
export const UTILITY_KEY = 'KeyQ';
export const UTILITY_KEY_LABEL = 'Q';

/** 공격 3칸 + 유틸 1칸을 한 줄로 훑을 때 씁니다 (HUD, 도감 기록, 디버그) */
export function ownedSlots(p: Player): SkillSlot[] {
  const out = p.attacks.filter((s): s is SkillSlot => s !== null);
  if (p.utility) out.push(p.utility);
  return out;
}

export function createPlayer(save: SaveData): Player {
  const stats = createStats(save.perm);
  const player: Player = {
    x: CANVAS.w / 2,
    y: CANVAS.h / 2,
    vx: 0,
    vy: 0,
    radius: PLAYER.radius,
    hp: stats.maxHp,
    stats,
    level: 1,
    xp: 0,
    xpToNext: LEVEL.xpToNext(1),
    attackTimer: 0,
    invuln: 1.2,
    dashTime: 0,
    dashAngle: 0,
    dashSpeed: 0,
    facing: -Math.PI / 2,
    slow: 1,
    slowTime: 0,
    attacks: new Array(MAX_ATTACK_SKILLS).fill(null),
    utility: null,
    revives: save.perm.revive ?? 0,
    rerolls: save.perm.reroll ?? 0,
    skips: skipCount(save),
    alive: true,
  };

  // 상점에서 산 시작 스킬은 항상 1레벨로 들어갑니다 (기획.md 8장).
  // 공격은 빈 칸에 차례로, 유틸은 하나뿐인 칸에 들어갑니다
  for (const id of save.equippedStartSkills) {
    if (getSkillDef(id).kind === 'utility') {
      player.utility = makeSlot(id, 1);
      continue;
    }
    const empty = player.attacks.indexOf(null);
    if (empty >= 0) player.attacks[empty] = makeSlot(id, 1);
  }

  return player;
}

export function updatePlayer(w: World, dt: number): void {
  const p = w.player;
  if (!p.alive) return;

  updateMovement(w, p, dt);
  updateSkills(w, dt);
  updateBasicAttack(w, dt);

  if (p.invuln > 0) p.invuln -= dt;
  if (p.stats.regen > 0 && p.hp < p.stats.maxHp) {
    p.hp = Math.min(p.stats.maxHp, p.hp + p.stats.regen * dt);
  }
}

function updateMovement(w: World, p: Player, dt: number): void {
  if (p.dashTime > 0) {
    p.dashTime -= dt;
    p.x += Math.cos(p.dashAngle) * p.dashSpeed * dt;
    p.y += Math.sin(p.dashAngle) * p.dashSpeed * dt;
    w.effects.spray(p.x, p.y, p.dashAngle + Math.PI, 0.3, 2, '#a3b8ff', 90, 3);
    clampToArena(p, p.radius, PLAYER.wallMargin);
    return;
  }

  const move = w.input.moveVector();
  const speed = p.stats.moveSpeed * p.slow;
  p.vx = move.x * speed;
  p.vy = move.y * speed;
  if (move.x !== 0 || move.y !== 0) p.facing = Math.atan2(move.y, move.x);
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  clampToArena(p, p.radius, PLAYER.wallMargin);
}

function updateSkills(w: World, dt: number): void {
  const p = w.player;
  // 공격형은 쿨이 돌면 알아서 나가고, 유틸형만 Q 로 씁니다
  for (const slot of p.attacks) tickSlot(w, slot, dt, true);
  tickSlot(w, p.utility, dt, w.input.wasPressed(UTILITY_KEY));
}

function tickSlot(w: World, slot: SkillSlot | null, dt: number, fire: boolean): void {
  if (!slot) return;
  const def = getSkillDef(slot.id);

  if (slot.active > 0) {
    slot.active -= dt;
    def.sustain?.(w, slot, dt);
    return;
  }
  if (slot.cooldown > 0) {
    slot.cooldown -= dt;
    return;
  }
  if (fire && def.activate(w, slot)) {
    // 갈래 배율까지 여기서 걸립니다. `def.cooldown` 을 직접 읽지 마십시오
    slot.cooldown = slotCooldown(w.player.stats, slot);
  }
}

/** 가장 가까운 적을 자동 조준하는 기본공격 */
function updateBasicAttack(w: World, dt: number): void {
  const p = w.player;
  p.attackTimer -= dt;
  if (p.attackTimer > 0) return;

  const target = nearestEnemy(w, p.x, p.y, p.stats.range);
  if (!target) return;

  const a = angleTo(p.x, p.y, target.x, target.y);
  const { damage, crit } = rollDamage(w, 1);
  w.addProjectile({
    x: p.x,
    y: p.y,
    vx: Math.cos(a) * p.stats.projSpeed,
    vy: Math.sin(a) * p.stats.projSpeed,
    radius: BASIC_ATTACK.bulletRadius,
    damage,
    crit,
    color: BASIC_ATTACK.color,
    pierce: BASIC_ATTACK.pierce,
    life: p.stats.range / p.stats.projSpeed + 0.15,
  });

  p.attackTimer = 1 / p.stats.fireRate;
}
