import { CANVAS, SKILL_BRANCH_LEVEL, SKILL_MAX_LEVEL, SPAWN, DEBUG_MAP, type EnemyId } from '../data/balance';
import { clamp, TAU } from '../core/math';
import { hasBranches } from '../skills/branches';
import { getSkillDef, makeSlot } from '../skills/registry';
import type { SkillId } from '../skills/types';
import { randomEdge } from './spawner';
import type { World } from './world';

/**
 * 디버그 맵의 조작 (2026-09-13).
 *
 * **화면(`ui/sandboxPanel.ts`)과 갈라 둡니다.** 여기는 World 만 만지므로 브라우저 없이
 * `scripts/smoke.ts` 가 그대로 잽니다. 버튼 쪽에 로직을 두면 그 시험을 할 수가 없습니다.
 *
 * 전부 **디버그 맵 판에서만 부릅니다.** 기록을 남기는 판에서 부르면 그 판의 결과가
 * 거짓이 되므로, 부르는 쪽(`main.ts`)이 `world.sandbox` 로 막습니다.
 */

export type SpawnPlace = 'edge' | 'near' | 'random';

export const SPAWN_PLACES: readonly { id: SpawnPlace; name: string }[] = [
  { id: 'edge', name: '가장자리' },
  { id: 'near', name: '내 주변' },
  { id: 'random', name: '무작위' },
];

/**
 * 디버그 맵의 출발 상태. **조용한 경기장에서 시작합니다.**
 * 무엇을 시험하든 먼저 비워 두고 필요한 것만 꺼내는 편이, 켜진 것을 찾아 끄는 것보다 빠릅니다
 */
export function prepareSandbox(w: World): void {
  w.spawner.enabled = false;
  w.spawner.bossEnabled = false;
}

/** 곧바로 냅니다. 예고(`spawn` 텔레그래프)를 거치지 않습니다 */
export function spawnEnemies(w: World, id: EnemyId, count: number, elite: boolean, place: SpawnPlace): number {
  for (let i = 0; i < count; i++) {
    const pos = placeFor(w, place);
    w.spawnEnemy(id, pos.x, pos.y, { elite });
  }
  return count;
}

function placeFor(w: World, place: SpawnPlace): { x: number; y: number } {
  const inset = SPAWN.edgeInset;
  if (place === 'edge') return randomEdge(w);
  if (place === 'near') {
    const a = w.rng.range(0, TAU);
    return {
      x: clamp(w.player.x + Math.cos(a) * DEBUG_MAP.nearDistance, inset, CANVAS.w - inset),
      y: clamp(w.player.y + Math.sin(a) * DEBUG_MAP.nearDistance, inset, CANVAS.h - inset),
    };
  }
  return { x: w.rng.range(inset, CANVAS.w - inset), y: w.rng.range(inset, CANVAS.h - inset) };
}

/** 적을 전부 처치합니다. 무적 바보적은 남깁니다 (못 죽인다는 것이 그 적의 규칙입니다) */
export function killAllEnemies(w: World): number {
  let n = 0;
  // 복사해서 돕니다. 분열적이 죽으면서 목록에 자식을 밀어 넣습니다
  for (const e of [...w.enemies]) {
    if (e.dead || e.immortal) continue;
    w.killEnemy(e);
    n++;
  }
  return n;
}

/** 나를 때리는 것만 걷습니다: 적탄 · 적 장판 · 예고 · 예약 폭발 · 레이저 */
export function clearHostiles(w: World): void {
  for (const p of w.projectiles) if (!p.friendly) p.dead = true;
  // `side: 'player'` 가 플레이어에게 닿는 장판입니다. 내 화염 지뢰(`'enemy'`)는 남깁니다
  for (const h of w.hazards) if (h.side === 'player') h.dead = true;
  for (const t of w.telegraphs) t.dead = true;
  for (const b of w.pendingBlasts) b.dead = true;
  for (const l of w.lasers) l.dead = true;
}

/**
 * 시계를 옮깁니다. **0 아래로는 안 갑니다.**
 *
 * 클리어 시간을 넘기면 정규 판과 똑같이 타이머가 멈추고 클리어 보스가 나옵니다.
 * 그 흐름 자체가 시험할 대상이라 여기서 따로 막지 않습니다.
 */
export function setClock(w: World, seconds: number): void {
  w.time = Math.max(0, seconds);
}

/**
 * 보스를 안 잡고 클리어 상태로 넘깁니다. 급상승(`OVERTIME`)을 보려는 용도입니다.
 * 보너스 코인은 안 줍니다 (디버그 맵은 어차피 아무것도 저장하지 않습니다)
 */
export function forceClear(w: World): boolean {
  if (w.cleared) return false;
  w.cleared = true;
  w.clearBossId = 0;
  if (w.time < w.diff.clearTime) w.time = w.diff.clearTime;
  return true;
}

/** 레벨을 올립니다. 스킬 선택 레벨이면 정규 판처럼 선택창이 뜹니다 */
export function levelUp(w: World, count: number): void {
  for (let i = 0; i < count; i++) {
    const p = w.player;
    w.gainXp(p.xpToNext - p.xp, true);
  }
}

/**
 * 스킬을 줍니다. 없으면 1레벨로, 있으면 한 레벨(또는 만렙까지) 올립니다.
 *
 * **6레벨을 지나가면 갈래 선택을 똑같이 띄웁니다.** 여기서 갈래를 건너뛰면 디버그 맵에서
 * 만든 만렙 스킬은 갈래가 없는 스킬이 되어, 정작 갈래를 시험할 수가 없습니다.
 *
 * 결과를 한 줄로 돌려줍니다. 화면이 그대로 띄웁니다.
 */
export function grantSkill(w: World, id: SkillId, toMax: boolean): string {
  const def = getSkillDef(id);
  const p = w.player;

  let slot = def.kind === 'utility'
    ? (p.utility?.id === id ? p.utility : null)
    : p.attacks.find((s) => s?.id === id) ?? null;

  if (!slot) {
    if (def.kind === 'utility') {
      const replaced = p.utility !== null;
      p.utility = makeSlot(id, 1);
      slot = p.utility;
      w.skillsTaken++;
      if (!toMax) return `${def.name} 획득${replaced ? ' (유틸 교체)' : ''}`;
    } else {
      const empty = p.attacks.indexOf(null);
      if (empty < 0) return `공격 칸이 가득 찼습니다 (${p.attacks.length}칸)`;
      slot = makeSlot(id, 1);
      p.attacks[empty] = slot;
      w.skillsTaken++;
      if (!toMax) return `${def.name} 획득`;
    }
  }

  const before = slot.level;
  slot.level = toMax ? SKILL_MAX_LEVEL : Math.min(SKILL_MAX_LEVEL, slot.level + 1);
  if (
    def.kind === 'attack'
    && before < SKILL_BRANCH_LEVEL
    && slot.level >= SKILL_BRANCH_LEVEL
    && slot.branch === null
    && hasBranches(id)
  ) {
    w.pendingBranchChoices.push(id);
  }
  return `${def.name} Lv.${slot.level}`;
}

/**
 * 스킬을 전부 뺍니다. **내 투사체도 같이 걷습니다.** 회전 궤도처럼 수명이 무한인
 * 것이 슬롯 없이 남으면 뺀 스킬이 계속 일합니다
 */
export function clearSkills(w: World): void {
  const p = w.player;
  p.attacks = p.attacks.map(() => null);
  p.utility = null;
  for (const proj of w.projectiles) if (proj.friendly) proj.dead = true;
}
