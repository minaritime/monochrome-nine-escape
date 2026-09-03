import { ARENA_X, CANVAS, PANEL, STAT_DEFS, VIEW } from '../data/balance';
import { formatStat } from '../game/stats';
import { UTILITY_KEY_LABEL } from '../game/player';
import { branchDef } from '../skills/branches';
import { getSkillDef, slotCooldown } from '../skills/registry';
import { nearestEnemy } from '../skills/targeting';
import type { SkillSlot } from '../game/types';
import type { World } from '../game/world';
import type { Renderer } from '../render/renderer';

const PANEL_BG = '#0a0d13';
const PANEL_LINE = '#1e2432';
const LABEL = '#6f7c93';

export function drawHud(r: Renderer, w: World): void {
  // 경기장 안에 그리는 것들
  r.begin(ARENA_X + w.effects.shakeX, w.effects.shakeY);
  drawTargetMarker(r, w);
  r.end();

  r.begin(ARENA_X, 0);
  drawHealth(r, w);
  drawXp(r, w);
  drawTopInfo(r, w);
  drawBossBar(r, w);
  r.end();

  drawStatPanel(r, w);
  drawSkillPanel(r, w);
}

/** 지금 기본공격이 노리고 있는 적을 표시합니다 (조준 조작이 없으므로 가독성이 중요합니다) */
function drawTargetMarker(r: Renderer, w: World): void {
  const p = w.player;
  if (!p.alive) return;
  const t = nearestEnemy(w, p.x, p.y, p.stats.range);
  if (!t) return;
  r.ring(t.x, t.y, t.radius + 5, '#ffe08a', 1.5, 0.55);
  r.line(t.x - t.radius - 10, t.y, t.x - t.radius - 4, t.y, '#ffe08a', 2, 0.7);
  r.line(t.x + t.radius + 4, t.y, t.x + t.radius + 10, t.y, '#ffe08a', 2, 0.7);
}

function drawHealth(r: Renderer, w: World): void {
  const p = w.player;
  const x = 18;
  const y = 18;
  const width = 260;
  const height = 20;
  const ratio = Math.max(0, p.hp / p.stats.maxHp);

  r.rect(x - 3, y - 3, width + 6, height + 6, 'rgba(13,16,23,0.72)');
  r.rect(x, y, width, height, '#2a1b1f');
  r.rect(x, y, width * ratio, height, ratio > 0.35 ? '#e05252' : '#ff2f2f');
  r.rectOutline(x, y, width, height, '#4a3038', 1);
  r.text(`${Math.ceil(p.hp)} / ${Math.round(p.stats.maxHp)}`, x + width / 2, y + height - 5, {
    size: 13,
    align: 'center',
    color: '#ffe6e6',
  });

  if (p.revives > 0) {
    r.text(`부활 ${p.revives}`, x + width + 12, y + height - 5, { size: 13, color: '#6ee7a0' });
  }
}

function drawXp(r: Renderer, w: World): void {
  const p = w.player;
  const x = 18;
  const y = 46;
  const width = 260;
  const height = 8;
  const ratio = Math.min(1, p.xp / p.xpToNext);

  r.rect(x, y, width, height, '#152030');
  r.rect(x, y, width * ratio, height, '#4dd2ff');
  r.text(`Lv.${p.level}`, x + width + 10, y + height, { size: 15, color: '#4dd2ff', weight: 800 });
}

function drawTopInfo(r: Renderer, w: World): void {
  const minutes = Math.floor(w.time / 60);
  const seconds = Math.floor(w.time % 60);
  const timeText = `${minutes}:${String(seconds).padStart(2, '0')}`;

  r.text(timeText, CANVAS.w / 2, 40, { size: 30, align: 'center', color: '#e6ebf5', weight: 800 });

  // 적은 처음부터 끝까지 같은 기울기로 계속 강해집니다. 그 사실을 숨기지 않고 보여줍니다.
  // 1분까지는 안 띄웁니다. 시작하자마자 "x1.1" 이 떠 있으면 경고가 아니라 장식이 됩니다
  const grow = w.timeMultiplier();
  if (grow >= 1.2) {
    r.text(`적 강화 x${grow.toFixed(1)} · 속도 x${w.lateSpeedMultiplier().toFixed(2)}`, CANVAS.w / 2, 60, {
      size: 14,
      align: 'center',
      color: '#ff8f6b',
      weight: 800,
    });
  }

  // 지금 어떤 난이도로 버티는 중인지 항상 보이게 둡니다
  if (w.difficulty > 0) {
    r.text(`난이도 ${w.difficulty}`, 18, 30, { size: 15, color: '#ff6b6b', weight: 800 });
  }

  r.text(`처치 ${w.stats.kills}`, CANVAS.w - 18, 30, { size: 15, align: 'right', color: '#8d99b0' });
  r.text(`코인 ${w.stats.coins}`, CANVAS.w - 18, 52, { size: 15, align: 'right', color: '#ffcc4d' });
  r.text(`적 ${w.enemies.length}`, CANVAS.w - 18, 74, { size: 13, align: 'right', color: '#5f6b80' });
}

function drawBossBar(r: Renderer, w: World): void {
  const boss = w.enemies.find((e) => e.boss && !e.dead);
  if (!boss) return;
  const width = 520;
  const x = CANVAS.w / 2 - width / 2;
  const y = 78;
  // 보스마다 색이 달라서 막대도 그 색을 씁니다. 어떤 보스인지 이름과 함께 알 수 있습니다
  r.rect(x, y, width, 12, '#2a1b1f');
  r.rect(x, y, width * Math.max(0, boss.hp / boss.maxHp), 12, boss.def.color);
  r.rectOutline(x, y, width, 12, '#5a2b36', 1);
  r.text(boss.def.name, CANVAS.w / 2, y - 4, { size: 13, align: 'center', color: boss.def.accent, weight: 800 });
}

// ---------------------------------------------------------------------------
// 좌측 패널: 플레이어 스탯
// ---------------------------------------------------------------------------

function drawStatPanel(r: Renderer, w: World): void {
  const p = w.player;
  r.rect(0, 0, PANEL.w, VIEW.h, PANEL_BG);
  r.line(PANEL.w - 0.5, 0, PANEL.w - 0.5, VIEW.h, PANEL_LINE, 1);

  let y = 34;
  r.text('스탯', 16, y, { size: 15, color: '#ffcc4d', weight: 800 });
  y += 10;
  r.line(16, y, PANEL.w - 16, y, PANEL_LINE, 1);
  y += 22;

  for (const def of STAT_DEFS) {
    r.text(def.name, 16, y, { size: 12.5, color: LABEL });
    r.text(formatStat(def.key, p.stats[def.key]), PANEL.w - 16, y, {
      size: 13,
      align: 'right',
      color: '#c3cddd',
      weight: 700,
    });
    y += 25;
  }

  y += 14;
  r.line(16, y - 14, PANEL.w - 16, y - 14, PANEL_LINE, 1);
  r.text('레벨', 16, y, { size: 12.5, color: LABEL });
  r.text(`${p.level}`, PANEL.w - 16, y, { size: 13, align: 'right', color: '#4dd2ff', weight: 700 });
  y += 25;
  r.text('경험치', 16, y, { size: 12.5, color: LABEL });
  r.text(`${Math.floor(p.xp)} / ${p.xpToNext}`, PANEL.w - 16, y, { size: 13, align: 'right', color: '#c3cddd', weight: 700 });

  if (p.rerolls > 0) {
    y += 25;
    r.text('리롤', 16, y, { size: 12.5, color: LABEL });
    r.text(`${p.rerolls}회`, PANEL.w - 16, y, { size: 13, align: 'right', color: '#ffcc4d', weight: 700 });
  }
}

// ---------------------------------------------------------------------------
// 우측 패널: 스킬 현황
// ---------------------------------------------------------------------------

function drawSkillPanel(r: Renderer, w: World): void {
  const p = w.player;
  const x0 = ARENA_X + CANVAS.w;
  r.rect(x0, 0, PANEL.w, VIEW.h, PANEL_BG);
  r.line(x0 + 0.5, 0, x0 + 0.5, VIEW.h, PANEL_LINE, 1);

  let y = 34;
  r.text('스킬', x0 + 16, y, { size: 15, color: '#ffcc4d', weight: 800 });
  y += 10;
  r.line(x0 + 16, y, x0 + PANEL.w - 16, y, PANEL_LINE, 1);
  y += 18;

  for (const slot of p.attacks) {
    drawSkillCard(r, w, x0, y, slot, '비어 있음');
    y += CARD_STEP;
  }
  drawSkillCard(r, w, x0, y, p.utility, '유틸 없음');
  y += CARD_STEP;

  // 타겟팅 규칙은 안 적습니다. 판마다 바뀌지 않는 고정 정보라 두세 판이면 외워지는데,
  // 그때부터는 30분 내내 안 읽는 글이 자리를 차지합니다. 확인이 필요하면 F1 오버레이에 있습니다
  r.text('기본공격', x0 + 16, y + 6, { size: 12.5, color: LABEL });
  r.text(`${p.stats.fireRate.toFixed(2)}발/초 · 사거리 ${Math.round(p.stats.range)}`, x0 + 16, y + 26, {
    size: 12,
    color: '#5f6b80',
  });
}

/**
 * 스킬 카드 한 장의 높이와 다음 장까지의 간격.
 *
 * 타겟팅 설명을 빼면서 134 → 92 로 줄었습니다. 카드 넷이 세로를 거의 다 채우고 있어서
 * 기본공격 칸이 바닥에 붙어 있었는데, 그만큼 여유가 생깁니다.
 */
const CARD_H = 92;
const CARD_STEP = CARD_H + 8;

function drawSkillCard(r: Renderer, w: World, x0: number, y: number, slot: SkillSlot | null, emptyText: string): void {
  const p = w.player;
  const left = x0 + 14;
  const width = PANEL.w - 28;

  r.rect(left, y, width, CARD_H, '#111621');
  r.rectOutline(left, y, width, CARD_H, slot ? '#2c3446' : '#1a2029', 1);

  if (!slot) {
    r.text(emptyText, left + width / 2, y + CARD_H / 2 + 5, { size: 13, align: 'center', color: '#394154' });
    return;
  }

  const def = getSkillDef(slot.id);
  const ready = slot.cooldown <= 0 && slot.active <= 0;

  r.circle(left + 22, y + 24, 10, def.color, ready ? 1 : 0.4);
  r.text(`${def.name}`, left + 40, y + 22, { size: 14, color: '#e6ebf5', weight: 800 });
  r.text(`Lv.${slot.level}`, left + width - 12, y + 22, { size: 12, align: 'right', color: '#8d99b0' });

  // 손으로 쓰는 것에만 키 상자를 답니다. 공격에 `자동` 이라고 적어봤자 공격은 언제나
  // 자동이라 아무것도 갈라주지 않고, 상자가 붙은 한 장이 곧 "이것만 손으로 쓴다"입니다
  if (def.kind === 'attack') {
    // 고른 갈래를 여기 적습니다. Lv.7 만 보이면 판 중간에 자기 빌드를 확인할 방법이 없습니다
    const branch = branchDef(slot.branch);
    if (branch) r.text(branch.name, left + 40, y + 40, { size: 11.5, color: def.color, weight: 700 });
  } else {
    r.rect(left + 38, y + 30, 20, 15, '#2a3346');
    r.text(UTILITY_KEY_LABEL, left + 48, y + 42, { size: 12, align: 'center', color: '#ffcc4d', weight: 800 });
  }

  // 쿨다운 막대
  const barY = y + 54;
  // 갈래가 쿨을 바꾸므로 `def.cooldown` 을 직접 읽으면 막대와 실제가 어긋납니다
  const maxCd = slotCooldown(p.stats, slot);
  r.rect(left + 12, barY, width - 24, 6, '#1c2331');
  if (slot.active > 0) {
    r.rect(left + 12, barY, width - 24, 6, def.color);
    r.text(`발동 중 ${slot.active.toFixed(1)}초`, left + 12, barY + 22, { size: 11.5, color: def.color });
  } else if (slot.cooldown > 0) {
    const filled = 1 - Math.min(1, slot.cooldown / Math.max(0.001, maxCd));
    r.rect(left + 12, barY, (width - 24) * filled, 6, '#3d4a66');
    r.text(`${slot.cooldown.toFixed(1)}초`, left + 12, barY + 22, { size: 11.5, color: '#8d99b0' });
  } else {
    r.rect(left + 12, barY, width - 24, 6, '#6ee7a0');
    r.text('준비됨', left + 12, barY + 22, { size: 11.5, color: '#6ee7a0', weight: 700 });
  }
  r.text(`쿨 ${maxCd.toFixed(1)}초`, left + width - 12, barY + 22, { size: 11.5, align: 'right', color: '#5f6b80' });
}
