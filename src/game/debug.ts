import { ARENA_X, BOSS, DEBUG, ENEMY_TABLE, SPAWN, VIEW, type EnemyId } from '../data/balance';
import { eliteRatio } from '../enemies/elite';
import { ALL_ENEMY_IDS, getEnemyDef } from '../enemies/registry';
import { formatStat } from './stats';
import { ownedSlots } from './player';
import { STAT_DEFS } from '../data/balance';
import { branchDef } from '../skills/branches';
import { getSkillDef } from '../skills/registry';
import { nearestEnemy } from '../skills/targeting';
import { killerOf } from './killer';
import type { Renderer } from '../render/renderer';
import type { World } from './world';

/**
 * F1 디버그 오버레이와 적 단독 소환 모드.
 * 적 14종의 이동 패턴을 개별 검증하려면 이게 반드시 필요합니다 (기획.md 10장).
 */
export class Debug {
  enabled = false;
  godMode = false;
  soloIndex = 0;

  get selected(): EnemyId {
    return ALL_ENEMY_IDS[this.soloIndex % ALL_ENEMY_IDS.length];
  }

  handleKeys(w: World): void {
    const input = w.input;

    if (input.wasPressed('F1')) {
      this.enabled = !this.enabled;
      return;
    }
    if (!this.enabled) return;

    if (input.wasPressed('F2')) {
      this.soloIndex = (this.soloIndex + 1) % ALL_ENEMY_IDS.length;
    }
    if (input.wasPressed('F3')) {
      w.spawner.spawnNow(w, this.selected, input.isDown('ShiftLeft') || input.isDown('ShiftRight'));
    }
    if (input.wasPressed('F4')) {
      w.spawner.enabled = !w.spawner.enabled;
    }
    if (input.wasPressed('KeyB')) {
      w.spawnBoss();
    }
    if (input.wasPressed('KeyK')) {
      for (const e of w.enemies) w.killEnemy(e);
    }
    if (input.wasPressed('KeyP')) {
      for (let i = 0; i < DEBUG.stressSpawnCount; i++) w.spawner.spawnNow(w, 'basic');
    }
    if (input.wasPressed('KeyL')) {
      w.gainXp(w.player.xpToNext - w.player.xp);
    }
    if (input.wasPressed('KeyG')) {
      this.godMode = !this.godMode;
    }
    if (input.wasPressed('KeyH')) {
      w.player.hp = w.player.stats.maxHp;
    }
    if (input.wasPressed('KeyT')) {
      w.time += 60;
    }
    // 즉사. 부팅 점검이 게임오버 화면까지 닿는 길입니다 (`scripts/boot.ts` 6번).
    //
    // 예전에는 적을 200마리씩 쏟아붓고 죽기를 기다렸는데, **그 처치로 들어오는
    // 경험치가 플레이어를 같이 키웁니다.** 8천 마리를 잡아 Lv.45 가 되면 안 죽어서
    // 판마다 결과가 갈렸고, 실제로 그 탓에 점검이 되다 말다 했습니다. 압박을 키우려고
    // 더 부으면 오히려 반대로 갑니다. **싸움의 승패에 점검을 매달지 마십시오.**
    //
    // **부활은 그대로 태웁니다.** 남아 있으면 한 번 되살아나므로 판을 끝내려면 남은
    // 횟수만큼 더 눌러야 합니다. 여기서 부활을 지우면 그 경로를 영영 못 밟습니다
    if (input.wasPressed('KeyX')) {
      // 무적을 켜둔 채 누르면 아래에서 체력만 되돌아와 죽은 채로 체력이 가득 찹니다
      this.godMode = false;
      const killer = nearestEnemy(w, w.player.x, w.player.y);
      w.damagePlayer(w.player.stats.maxHp + 1, true, killer ? killerOf(killer) : null);
    }

    // 무적은 체력까지 되돌립니다. 무적 시간만 켜면 **스스로 치르는 대가**를 못 막습니다.
    // 넉백 폭발이 최대 체력의 20% 를 태우는데 그건 무적을 일부러 무시하므로(`spendHp`),
    // 무적을 켜두고도 넉백을 몇 번 쓰면 그냥 죽습니다
    if (this.godMode) {
      w.player.invuln = Math.max(w.player.invuln, 0.5);
      w.player.hp = w.player.stats.maxHp;
    }
  }

  draw(r: Renderer, w: World, fps: number): void {
    if (!this.enabled) return;

    const x = ARENA_X + 18;
    let y = 100;
    const line = (text: string, color = '#8d99b0', size = 12) => {
      r.text(text, x, y, { size, color });
      y += size + 4;
    };

    r.rect(x - 8, y - 18, 300, 470, 'rgba(5,7,11,0.82)');

    r.text('디버그 (F1 로 닫기)', x, y, { size: 13, color: '#ffcc4d', weight: 800 });
    y += 20;

    line(`fps ${fps.toFixed(0)} · seed ${w.rng.seed}`);
    line(`적 ${w.enemies.length} · 투사체 ${w.projectiles.length} · 파티클 ${w.effects.particles.length}`);
    const rate = w.spawner.currentRate(w) / (w.bossesAlive > 0 ? BOSS.spawnSlow : 1);
    const elitePct = eliteRatio(w.time, w.diff.eliteRatioMul) * 100;
    line(`스폰 ${rate.toFixed(2)}마리/초 · 상한 ${SPAWN.maxAlive + w.diff.maxAliveAdd} · 정예 ${elitePct.toFixed(0)}% · 시간 강화 x${w.timeMultiplier().toFixed(2)} (속도 x${w.lateSpeedMultiplier().toFixed(2)})`);
    line(`난이도 ${w.difficulty} · 체력 x${w.diff.hpMul.toFixed(2)} · 공격력 x${w.diff.damageMul.toFixed(2)} · 속도 x${w.diff.speedMul.toFixed(2)} · 사거리 x${w.diff.rangeMul.toFixed(2)}`);
    line(`자동 스폰 ${w.spawner.enabled ? 'ON' : 'OFF'} (F4) · 무적 ${this.godMode ? 'ON' : 'OFF'} (G)`);
    y += 4;

    r.text(`단독 소환 대상: ${getEnemyDef(this.selected).name} (F2 변경 / F3 소환 / Shift+F3 정예)`, x, y, {
      size: 12,
      color: '#4dd2ff',
    });
    y += 18;

    const counts = new Map<string, number>();
    for (const e of w.enemies) {
      if (e.dead) continue;
      counts.set(e.defId, (counts.get(e.defId) ?? 0) + 1);
    }
    const parts: string[] = [];
    for (const [id, n] of counts) parts.push(`${getEnemyDef(id as EnemyId).name} ${n}`);
    line(parts.length ? parts.join(' · ') : '적 없음', '#c3cddd');
    y += 4;

    r.text('플레이어 스탯', x, y, { size: 12, color: '#ffcc4d' });
    y += 16;
    for (const def of STAT_DEFS) {
      line(`${def.name} ${formatStat(def.key, w.player.stats[def.key])}`, '#7f8ca3', 11);
    }

    y += 4;
    r.text('스킬', x, y, { size: 12, color: '#ffcc4d' });
    y += 16;
    const slots = ownedSlots(w.player);
    if (slots.length === 0) line('(없음)', '#5f6b80', 11);
    for (const slot of slots) {
      const def = getSkillDef(slot.id);
      const tag = def.kind === 'utility' ? '[Q] ' : '';
      const branch = branchDef(slot.branch);
      const bt = branch ? `·${branch.name}` : '';
      line(`${tag}${def.name}${bt} Lv.${slot.level} · 쿨 ${slot.cooldown.toFixed(1)} · ${def.targetingLabel}`, '#7f8ca3', 11);
    }

    // 타겟 표시는 경기장 좌표라 좌측 패널 폭만큼 밀어서 그립니다
    const target = nearestEnemy(w, w.player.x, w.player.y, w.player.stats.range);
    if (target) {
      r.begin(ARENA_X + w.effects.shakeX, w.effects.shakeY);
      r.ring(target.x, target.y, target.radius + 12, '#00ff88', 1.5, 0.8);
      r.text(
        `타겟: ${target.def.name}${target.elite ? ' (정예)' : ''} hp ${Math.ceil(target.hp)}/${Math.round(target.maxHp)}`,
        target.x,
        target.y - target.radius - 18,
        { size: 11, color: '#00ff88', align: 'center' },
      );
      r.end();
    }

    r.text(
      '단축키: B 보스 · K 전멸 · P 200마리 · L 레벨업 · T +60초 · H 회복 · X 즉사',
      VIEW.w - 18,
      VIEW.h - 8,
      { size: 11, color: '#5f6b80', align: 'right' },
    );

    // 해금 상태
    const locked = ALL_ENEMY_IDS.filter((id) => {
      const bal = ENEMY_TABLE[id];
      return w.time < bal.unlockTime && !(bal.unlockSkills > 0 && w.skillsTaken >= bal.unlockSkills);
    });
    r.text(
      locked.length ? `미해금: ${locked.map((id) => getEnemyDef(id).name).join(', ')}` : '전 종류 해금됨',
      x,
      VIEW.h - 26,
      { size: 11, color: '#5f6b80' },
    );
  }
}
