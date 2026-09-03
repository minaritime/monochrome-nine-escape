import { ARENA_X, CANVAS, DEATH_BURST, ELITE, ENEMY_BULLET, ENEMY_PARAMS, PLAYER } from '../data/balance';
import { TAU } from '../core/math';
import { bomberBlastRadius, cowardEnraged, rangedAimTime } from '../enemies/behaviors/special';
import { eliteMul } from '../enemies/elite';
import { mummyReviveDelay } from '../enemies/update';
import type { Enemy, Projectile } from '../game/types';
import type { World } from '../game/world';
import type { Renderer } from './renderer';

const BG = '#0d1017';
const GRID = '#151b26';

/** 월드 전체를 그립니다. HUD 는 ui/hud.ts 가 따로 그립니다 */
export function drawWorld(r: Renderer, w: World): void {
  r.clear(BG);
  // 게임 좌표는 경기장 기준(0,0 ~ 1280,720)이라 좌측 패널 폭만큼 밀어서 그립니다
  r.begin(ARENA_X + w.effects.shakeX, w.effects.shakeY);

  drawArena(r);
  drawHazards(r, w);
  drawTelegraphs(r, w);
  drawCoins(r, w);
  drawProjectiles(r, w, false);
  drawEnemies(r, w);
  drawPlayer(r, w);
  drawShards(r, w);
  drawProjectiles(r, w, true);
  drawParticles(r, w);

  r.end();

  if (w.effects.hurtFlash > 0) r.fullscreenTint('#ff2a2a', w.effects.hurtFlash * 0.16);
  if (w.enemyTimeScale < 1) r.fullscreenTint('#7ea8ff', 0.07);
}

/** 메뉴 화면 뒤에 깔리는 빈 배경 */
export function drawIdleBackground(r: Renderer): void {
  r.clear(BG);
  r.begin(ARENA_X, 0);
  drawArena(r);
  r.end();
}

function drawArena(r: Renderer): void {
  const step = 80;
  for (let x = step; x < CANVAS.w; x += step) r.line(x, 0, x, CANVAS.h, GRID, 1, 1);
  for (let y = step; y < CANVAS.h; y += step) r.line(0, y, CANVAS.w, y, GRID, 1, 1);
  r.rectOutline(1, 1, CANVAS.w - 2, CANVAS.h - 2, '#2c3446', 2);
}

function drawHazards(r: Renderer, w: World): void {
  for (const h of w.hazards) {
    const t = h.life / h.maxLife;
    const fade = Math.min(1, t * 3);
    r.circle(h.x, h.y, h.radius, h.color, 0.18 * fade);
    r.ring(h.x, h.y, h.radius, h.color, 2, 0.5 * fade);

    // 아픈 장판은 다르게 보여야 합니다. 감속만 하는 장판과 같이 생기면
    // 밟아보기 전에는 구분이 안 됩니다
    if (h.tickDamage <= 0) continue;
    if (h.arm > 0) {
      // 아직 유예 중. 안쪽 원이 차오르는 동안이 물러날 시간입니다.
      // 장판마다 유예가 다르므로 상수를 직접 읽으면 주인이 바뀔 때 계산이 깨집니다.
      // maxArm 이 0 이면 나눗셈이 NaN 이 되어 캔버스가 조용히 그리기를 멈춥니다
      const arm = h.maxArm > 0 ? 1 - h.arm / h.maxArm : 1;
      r.circle(h.x, h.y, h.radius * arm, h.color, 0.14);
      r.ring(h.x, h.y, h.radius * arm, h.color, 1.5, 0.5);
    } else {
      const pulse = 0.5 + 0.5 * Math.sin(w.time * 9);
      r.circle(h.x, h.y, h.radius, h.color, (0.1 + pulse * 0.1) * fade);
      r.ring(h.x, h.y, h.radius - 5, h.color, 1.5, (0.3 + pulse * 0.4) * fade);
    }
  }
}

function drawTelegraphs(r: Renderer, w: World): void {
  for (const t of w.telegraphs) {
    const k = t.life / t.maxLife;
    switch (t.kind) {
      case 'spawn': {
        const pulse = 1 - k;
        r.ring(t.x, t.y, t.radius * (0.5 + pulse * 0.8), t.color, 2.5, 0.85);
        r.circle(t.x, t.y, 4, t.color, 0.9);
        break;
      }
      case 'line': {
        // 지나갈 범위를 띄웁니다. 실제 몸이 닿는 폭 그대로입니다.
        // 진하기로 시점을 알리면 "조금 진해졌다"를 매번 눈으로 견줘야 해서 읽히지 않습니다.
        // 대신 통로가 적 쪽에서부터 실제로 차오르고, 다 차는 순간 튀어나옵니다
        const fill = 1 - k;
        const a = Math.atan2(t.y2 - t.y, t.x2 - t.x);
        const nx = Math.cos(a + Math.PI / 2) * (t.width / 2);
        const ny = Math.sin(a + Math.PI / 2) * (t.width / 2);
        const fx = t.x + (t.x2 - t.x) * fill;
        const fy = t.y + (t.y2 - t.y) * fill;

        // 통로 전체 (연하게) → 차오른 부분 (진하게) → 가장자리 → 차오른 끝의 선
        r.line(t.x, t.y, t.x2, t.y2, t.color, t.width, 0.09);
        if (fill > 0) r.line(t.x, t.y, fx, fy, t.color, t.width, 0.3);
        r.line(t.x + nx, t.y + ny, t.x2 + nx, t.y2 + ny, t.color, 1.5, 0.5);
        r.line(t.x - nx, t.y - ny, t.x2 - nx, t.y2 - ny, t.color, 1.5, 0.5);
        if (fill > 0.02) r.line(fx + nx, fy + ny, fx - nx, fy - ny, t.color, 2, 0.85);
        break;
      }
      case 'blast':
        r.ring(t.x, t.y, t.radius * (1.05 - k * 0.35), t.color, 3, k * 0.9);
        break;
      case 'incoming': {
        // 곧 터질 자리. 안쪽이 차오르고 테두리가 진해집니다.
        // 다 차는 순간 터지므로 언제 자리를 떠야 하는지가 눈에 보입니다
        const fill = 1 - k;
        r.circle(t.x, t.y, t.radius, t.color, 0.06 + 0.12 * fill);
        r.circle(t.x, t.y, t.radius * fill, t.color, 0.16);
        r.ring(t.x, t.y, t.radius, t.color, 2, 0.35 + 0.5 * fill);
        break;
      }
    }
  }
}

function drawCoins(r: Renderer, w: World): void {
  for (const c of w.coins) {
    r.circle(c.x, c.y, 7, '#ffcc4d');
    r.circle(c.x - 2, c.y - 2, 2.4, '#fff2c4');
  }
}

function drawProjectiles(r: Renderer, w: World, friendlyLayer: boolean): void {
  for (const p of w.projectiles) {
    if (p.dead) continue;
    if (p.friendly !== friendlyLayer) continue;
    drawProjectile(r, p);
  }
}

function drawProjectile(r: Renderer, p: Projectile): void {
  switch (p.kind) {
    case 'mine': {
      const armed = p.arm <= 0;
      r.circle(p.x, p.y, p.radius, armed ? p.color : '#7a4a4a', 0.9);
      r.ring(p.x, p.y, p.radius + 3, p.color, 1.5, armed ? 0.9 : 0.4);
      break;
    }
    case 'orbit':
      r.circle(p.x, p.y, p.radius, p.color, 0.95);
      r.ring(p.x, p.y, p.radius + 3, '#fff6d8', 1.5, 0.6);
      break;
    case 'pierce': {
      const a = Math.atan2(p.vy, p.vx);
      r.line(p.x - Math.cos(a) * 22, p.y - Math.sin(a) * 22, p.x, p.y, p.color, p.radius * 1.4, 0.75);
      r.circle(p.x, p.y, p.radius, '#ffffff', 0.95);
      break;
    }
    case 'lob':
      // 착탄 지점의 폭발 반경은 미리 그리지 않습니다. 터질 때 눈으로 확인하는 것이 맞습니다
      r.circle(p.x, p.y, p.radius, p.color);
      r.circle(p.x, p.y, p.radius + 3, p.color, 0.25);
      break;
    case 'ricochet': {
      // 남은 명중 횟수를 링으로 보여줍니다. 도탄은 화면을 오래 돌아다니므로
      // "아직 몇 번 더 때리는가"가 안 보이면 그냥 굴러다니는 점으로 보입니다
      const a = Math.atan2(p.vy, p.vx);
      r.line(p.x - Math.cos(a) * 16, p.y - Math.sin(a) * 16, p.x, p.y, p.color, p.radius * 1.1, 0.5);
      r.circle(p.x, p.y, p.radius, p.color);
      r.ring(p.x, p.y, p.radius + 3 + Math.min(4, p.pierce), p.color, 1.5, 0.7);
      break;
    }
    case 'enemy':
      // 탄이 빨라져서 밝은 심을 넣었습니다. 없으면 빠른 탄이 배경에 묻힙니다
      r.circle(p.x, p.y, p.radius + 3, ENEMY_BULLET.glow, 0.22);
      r.circle(p.x, p.y, p.radius, p.color);
      r.circle(p.x, p.y, p.radius * 0.45, '#ffffff', 0.75);
      break;
    default: {
      const a = Math.atan2(p.vy, p.vx);
      r.line(p.x - Math.cos(a) * 9, p.y - Math.sin(a) * 9, p.x, p.y, p.color, p.radius * 1.2, 0.55);
      r.circle(p.x, p.y, p.radius, p.color);
      break;
    }
  }
}

function drawEnemies(r: Renderer, w: World): void {
  for (const e of w.enemies) {
    if (e.dead) continue;
    drawEnemy(r, e, w);
  }
}

function drawEnemy(r: Renderer, e: Enemy, w: World): void {
  const alpha = e.alpha;
  const flash = e.hitFlash > 0;
  const color = flash ? '#ffffff' : e.def.color;

  // 전원이 정예인 난이도(9 이상)에서는 표식을 감춥니다.
  // 정예 표식은 "저건 다르다"를 알리는 장치인데, 전부 정예면 알릴 차이가 없습니다.
  // 화면 전체가 붉은 링으로 덮여서 오히려 아무것도 안 보이게 됩니다
  // 쓰러져 있는 미라는 시체입니다. 정예 표식도 체력바도 붙이지 않습니다
  const downed = e.downed > 0;
  const showElite = e.elite && !w.diff.allElite && !downed;

  // 정예는 반드시 눈에 띄어야 합니다 (기획.md 4장).
  // 링 하나로는 난전에서 묻히므로 오라 + 이중 링 + 머리 위 뿔을 전부 겹칩니다
  if (showElite) drawEliteMark(r, e, w, alpha);

  // 무적 바보적 (난이도 15). 처치할 수 없다는 것이 한눈에 보여야 합니다
  if (e.immortal) {
    const pulse = 1 + Math.sin(w.time * 3) * 0.08;
    r.circle(e.x, e.y, e.radius + 12, '#8fa6c8', 0.12 * alpha);
    r.ring(e.x, e.y, (e.radius + 6) * pulse, '#dbe6f7', 2.5, 0.8 * alpha);
    r.ring(e.x, e.y, e.radius + 11, '#8fa6c8', 1, 0.5 * alpha);
  }

  if (e.boss) {
    r.circle(e.x, e.y, e.radius + 16, '#ff3355', 0.1);
    r.ring(e.x, e.y, e.radius + 10, '#ff3355', 2, 0.5);
  }

  if (e.def.sides > 0) {
    const rot = e.def.faceMove ? e.facing : w.time * 0.4;
    r.poly(e.x, e.y, e.radius, e.def.sides, rot, color, alpha);
    r.polyOutline(e.x, e.y, e.radius, e.def.sides, rot, showElite ? '#ff8a8a' : e.def.accent, 1.5, alpha * 0.9);
  } else {
    r.circle(e.x, e.y, e.radius, color, alpha);
    r.ring(e.x, e.y, e.radius, showElite ? '#ff8a8a' : e.def.accent, 1.5, alpha * 0.85);
  }

  drawEnemyExtras(r, e, w, alpha);

  if (e.burnTime > 0) r.ring(e.x, e.y, e.radius + 3, '#ff9a3c', 1.5, 0.5 * alpha);
  if (e.slow < 1) r.ring(e.x, e.y, e.radius + 5, '#9be7c4', 1, 0.45 * alpha);

  // 체력바 (다친 적만. 정예는 멀쩡해도 항상 보여서 눈에 띕니다).
  // 무적이면 깎일 일이 없으므로 아예 안 그립니다. 안 줄어드는 막대는 오해만 만듭니다
  if ((e.hp < e.maxHp || showElite) && !e.boss && !e.immortal && !downed) {
    const wBar = e.radius * 2;
    const x = e.x - e.radius;
    const y = e.y - e.radius - 8;
    r.rect(x, y, wBar, 3, '#000000', 0.5 * alpha);
    r.rect(x, y, wBar * Math.max(0, e.hp / e.maxHp), 3, showElite ? '#ff6b6b' : '#8fe36b', 0.9 * alpha);
  }
}

/**
 * 정예 표식.
 * 은신적처럼 투명해지는 적은 alpha 를 그대로 따라가야 정체가 드러나지 않습니다.
 */
function drawEliteMark(r: Renderer, e: Enemy, w: World, alpha: number): void {
  const pulse = Math.sin(w.time * ELITE.ringPulseSpeed) * ELITE.ringPulseAmount;

  // 바닥 오라
  r.circle(e.x, e.y, e.radius + 14, ELITE.markColor, 0.16 * alpha);
  // 굵은 이중 링. 안쪽은 고정, 바깥쪽은 숨쉬듯 움직입니다
  r.ring(e.x, e.y, e.radius + 4, ELITE.markColor, 3, 0.95 * alpha);
  r.ring(e.x, e.y, e.radius + 9 + pulse, ELITE.markColor, 1.5, 0.55 * alpha);

  // 머리 위 뿔 두 개. 색이 비슷한 적끼리 붙어 있어도 실루엣으로 구분됩니다
  const top = e.y - e.radius - 6;
  const spread = e.radius * 0.55;
  const height = 9;
  for (const dir of [-1, 1]) {
    const x = e.x + spread * dir;
    r.line(x, top, x + 3 * dir, top - height, ELITE.markColor, 3, 0.95 * alpha);
  }
}

/**
 * 돌진 충전 막대.
 * 예고 시간이 3초나 되는데 언제 튀어나오는지 알 방법이 선의 진하기뿐이었습니다.
 * 막대가 끝까지 차는 순간 돌진이 시작되므로, 언제 자리를 떠야 하는지가 눈으로 보입니다.
 * 정예는 예고가 짧아서 이 막대가 더 빨리 찹니다.
 */
function drawChargeBar(r: Renderer, e: Enemy): void {
  const P = ENEMY_PARAMS.charger;
  const total = e.state.timer3 > 0 ? e.state.timer3 : P.telegraph;
  const fill = clamp01(1 - e.state.timer / total);

  const x = e.x - P.barWidth / 2;
  const y = e.y - e.radius - 16;
  r.rect(x, y, P.barWidth, P.barHeight, '#000000', 0.55);
  r.rect(x, y, P.barWidth * fill, P.barHeight, e.def.color, 0.95);
  r.rectOutline(x, y, P.barWidth, P.barHeight, e.def.accent, 1, 0.7);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function drawEnemyExtras(r: Renderer, e: Enemy, w: World, alpha: number): void {
  switch (e.def.extraDraw) {
    case 'ranged':
      if (e.state.phase === 1) {
        // 조준선은 플레이어를 계속 따라갑니다. 실제 발사각과 항상 일치합니다
        const p = w.player;
        // 정예는 조준이 절반이라 아래 진행도도 그만큼 빨리 찹니다
        const t = 1 - Math.max(0, e.state.timer) / rangedAimTime(e);
        // 선과 총구 표시는 "누가 어디서 쏘는가"라 적 고유색을 씁니다.
        // 반면 내가 맞을 지점은 날아올 탄과 같은 빨강으로 그립니다
        r.line(e.x, e.y, p.x, p.y, e.def.accent, 1 + t * 2.2, 0.22 + t * 0.5);
        r.ring(e.x, e.y, e.radius + 6, e.def.accent, 2, 0.8);
        r.ring(p.x, p.y, 20 - t * 12, ENEMY_BULLET.color, 2, 0.45 + t * 0.55);
      }
      break;
    case 'coward':
      // 인내가 끝난 겁쟁이는 계속 달려듭니다. 같은 노란 오각형인데 행동만 달라지면
      // 왜 갑자기 화면 끝에서 날아왔는지 알 수 없으므로 링을 둘러서 표시합니다
      if (cowardEnraged(e, w)) {
        const rage = 0.5 + 0.5 * Math.sin(w.time * 7);
        r.ring(e.x, e.y, e.radius + 5 + rage * 3, e.def.accent, 2, (0.45 + rage * 0.35) * alpha);
      }
      if (e.state.phase === 1) {
        // 아주 짧은 준비 동작이라 눈에 확 띄게 그립니다
        r.ring(e.x, e.y, e.radius + 6, e.def.accent, 2.5, 0.95);
        r.line(
          e.x,
          e.y,
          e.x + Math.cos(e.facing) * (e.radius + 34),
          e.y + Math.sin(e.facing) * (e.radius + 34),
          e.def.accent,
          2,
          0.8,
        );
      } else if (e.state.phase === 2) {
        r.line(
          e.x - Math.cos(e.facing) * 22,
          e.y - Math.sin(e.facing) * 22,
          e.x,
          e.y,
          e.def.accent,
          e.radius,
          0.35,
        );
      }
      break;
    case 'bomber': {
      // 심지는 점화 여부와 상관없이 항상 그립니다.
      // 기본적과 같은 붉은 계열 원이라 색만으로는 구분이 안 됐던 것을 실루엣으로 갈라놓는 부분입니다
      const fuseTop = e.y - e.radius - 8;
      r.line(e.x, e.y - e.radius, e.x + 3, fuseTop, e.def.accent, 2.5, alpha);

      if (!e.state.flag) {
        // 점화 전에도 천천히 숨쉬어서 가만히 있는 기본적과 움직임이 다릅니다
        const idle = 0.5 + 0.5 * Math.sin(w.time * 2.2);
        r.circle(e.x + 3, fuseTop, 2 + idle * 1.2, e.def.accent, (0.5 + idle * 0.5) * alpha);
        // 스폰 직후 멈춰 있는 동안에는 링이 몸 쪽으로 조여듭니다.
        // 다 조여든 순간 출발하므로, "언제 오는가"를 세지 않고 눈으로 볼 수 있습니다
        if (e.state.timer2 > 0) {
          const left = e.state.timer2 / ENEMY_PARAMS.bomber.spawnDelay;
          r.ring(e.x, e.y, e.radius + 4 + left * 20, e.def.color, 2, (0.7 - left * 0.3) * alpha);
        }
        break;
      }

      const pulse = 0.5 + 0.5 * Math.sin(w.time * 22);
      // 실제로 죽는 범위를 그대로 보여줍니다. 반경을 모르면 피할 수가 없습니다
      r.ring(e.x, e.y, bomberBlastRadius(e, w), '#ff9a3c', 1.5, 0.15 + pulse * 0.2);
      r.circle(e.x + 3, fuseTop, 3 + pulse * 2.5, '#ffdd66', 0.9);
      r.circle(e.x, e.y, e.radius + 6 * pulse, '#ff9a3c', 0.3);
      r.ring(e.x, e.y, e.radius + 8, '#ffdd66', 2, 0.6 + pulse * 0.4);
      const left = Math.max(0, e.state.timer);
      r.text(left.toFixed(1), e.x, e.y - e.radius - 18, { size: 12, color: '#ffdd66', align: 'center' });
      break;
    }
    case 'splitter':
      // 안쪽에 작은 원을 하나 더 그려 "나뉜다"를 실루엣으로 보여줍니다
      r.ring(e.x, e.y, e.radius * 0.5, e.def.accent, 1.5, 0.8 * alpha);
      break;
    case 'puddle': {
      // 죽으면 여기에 장판이 깔립니다. 미리 보여줘야 잡을 자리를 고를 수 있습니다.
      // 정예는 두 배 넓고 피해까지 있으므로 미리보기도 그만큼 커야 합니다
      const pr = ENEMY_PARAMS.puddle.hazardRadius * eliteMul(e, 'hazardRadiusMul') * w.diff.rangeMul;
      r.ring(e.x, e.y, pr, e.def.color, 1, 0.16 * alpha);
      if (e.elite && !w.diff.allElite) r.ring(e.x, e.y, pr - 6, e.def.color, 1, 0.1 * alpha);
      break;
    }
    case 'charger':
      if (e.state.phase === 1) {
        r.ring(e.x, e.y, e.radius + 5, e.def.color, 2.5, 0.9);
        drawChargeBar(r, e);
      } else if (e.state.phase === 2) {
        // 돌진 중에는 잔상을 남깁니다. 워낙 빨라서 이게 없으면 순간이동처럼 보입니다
        const back = e.radius * 2.6;
        r.line(
          e.x - Math.cos(e.state.angle) * back,
          e.y - Math.sin(e.state.angle) * back,
          e.x,
          e.y,
          e.def.color,
          e.radius * 1.6,
          0.4,
        );
      } else if (e.state.phase === 3) {
        r.text('기절', e.x, e.y - e.radius - 10, { size: 12, color: '#8d99b0', align: 'center' });
      }
      break;
    case 'shield': {
      if (e.shieldHp <= 0) break; // 깨진 뒤에는 그리지 않습니다
      const half = (ENEMY_PARAMS.shield.arcDeg * Math.PI) / 180 / 2;
      const ratio = e.shieldMax > 0 ? e.shieldHp / e.shieldMax : 0;
      // 내구도가 닳을수록 얇아지고 옅어집니다
      r.arc(e.x, e.y, e.radius + 5, e.facing - half, e.facing + half, '#dbe6f7', 1.5 + 3 * ratio, (0.35 + 0.55 * ratio) * alpha);
      break;
    }
    case 'summoner':
      r.ring(e.x, e.y, e.radius + 4 + Math.sin(w.time * 3) * 2, e.def.color, 1.5, 0.5 * alpha);
      break;
    case 'mummy': {
      // 몸을 가로지르는 붕대 줄무늬. 원형 다섯 종 중 이것만의 실루엣입니다
      for (let i = -1; i <= 1; i++) {
        const dy = i * e.radius * 0.45;
        const half = Math.sqrt(Math.max(0, e.radius * e.radius - dy * dy)) * 0.92;
        r.line(e.x - half, e.y + dy, e.x + half, e.y + dy, e.def.accent, 2, 0.75 * alpha);
      }
      // 되살아난 뒤에는 스스로 타들어갑니다. 남은 시간이 링으로 보입니다
      if (e.revived && e.hpDrainRatio > 0) {
        r.ring(e.x, e.y, e.radius + 5, '#ff8f6b', 2, (0.3 + 0.5 * (e.hp / e.maxHp)) * alpha);
      }
      // 쓰러진 동안은 되살아나기까지 남은 시간이 조여드는 링으로 보입니다
      if (e.downed > 0) {
        const total = mummyReviveDelay(e);
        const k = total > 0 ? e.downed / total : 0;
        r.ring(e.x, e.y, e.radius + 4 + k * 16, e.def.accent, 2, 0.75);
      }
      break;
    }
    case 'stealth':
      // 반쪽만 칠한 원. 드러난 1초 동안만 진하게 보입니다
      r.cone(e.x, e.y, e.radius, -Math.PI / 2, Math.PI / 2, e.def.accent, (e.targetable ? 0.85 : 0.5) * alpha);
      if (e.targetable) r.ring(e.x, e.y, e.radius + 4, e.def.accent, 1.5, 0.8);
      break;
    case 'boss': {
      const rot = w.time * 0.6;
      r.polyOutline(e.x, e.y, e.radius + 6, 3, rot, '#ffd0d8', 2, 0.6);
      r.polyOutline(e.x, e.y, e.radius + 6, 3, -rot, '#ffd0d8', 2, 0.6);
      // 무적 중에는 때려도 안 들어갑니다. 안 보이면 "왜 피가 안 깎이지"가 됩니다
      if (e.invuln > 0) {
        const pulse = 0.5 + 0.5 * Math.sin(w.time * 12);
        r.ring(e.x, e.y, e.radius + 16 + pulse * 4, '#dbe6f7', 3, 0.55 + pulse * 0.35);
        r.circle(e.x, e.y, e.radius + 12, '#dbe6f7', 0.1 + pulse * 0.08);
        r.text('무적', e.x, e.y - e.radius - 26, { size: 14, color: '#dbe6f7', align: 'center' });
      }
      break;
    }
    default:
      break;
  }
}

function drawPlayer(r: Renderer, w: World): void {
  const p = w.player;
  if (!p.alive) return;

  const blink = p.invuln > 0 && Math.floor(p.invuln / PLAYER.blinkPeriod) % 2 === 0;
  const alpha = blink ? 0.45 : 1;

  if (p.dashTime > 0) r.circle(p.x, p.y, p.radius + 8, '#a3b8ff', 0.25);
  if (p.invuln > 0) r.ring(p.x, p.y, p.radius + 5, '#7ee0ff', 1.5, 0.5);

  r.circle(p.x, p.y, p.radius, '#e6ebf5', alpha);
  r.circle(p.x, p.y, p.radius - 4, '#4dd2ff', alpha);
  r.line(
    p.x,
    p.y,
    p.x + Math.cos(p.facing) * (p.radius + 6),
    p.y + Math.sin(p.facing) * (p.radius + 6),
    '#4dd2ff',
    2.5,
    alpha,
  );

  // 코인 획득 범위 (아주 옅게)
  r.ring(p.x, p.y, p.stats.pickupRange, '#ffcc4d', 1, 0.06);
}

/**
 * 죽는 순간 흩어지는 파편.
 *
 * 플레이어와 같은 두 색을 그대로 씁니다 (테두리 흰색 + 속 하늘색).
 * 색이 달라지면 "내가 쪼개진 것"이 아니라 새로 생긴 무언가로 보입니다.
 * 부채꼴로 그리는 이유는 원을 갈라낸 조각이라는 것이 실루엣에서 읽혀야 하기 때문입니다.
 */
function drawShards(r: Renderer, w: World): void {
  for (const s of w.shards) {
    const t = s.life / s.maxLife;
    // 끝에서 급히 사라지지 않고 마지막 30% 구간에서만 옅어집니다
    const alpha = Math.min(1, t * 3.2);
    r.cone(s.x, s.y, s.size, s.angle, DEATH_BURST.spread, '#e6ebf5', alpha);
    r.cone(s.x, s.y, s.size * 0.6, s.angle, DEATH_BURST.spread * 0.8, '#4dd2ff', alpha);
  }
}

function drawParticles(r: Renderer, w: World): void {
  for (const pt of w.effects.particles) {
    const a = pt.life / pt.maxLife;
    r.circle(pt.x, pt.y, pt.radius * a, pt.color, a * 0.9);
  }
  for (const t of w.effects.texts) {
    const a = Math.min(1, t.life / t.maxLife * 1.6);
    r.text(t.text, t.x, t.y, { size: t.size, color: t.color, align: 'center', alpha: a, weight: 800 });
  }
}

/** 스킬 아이콘 등에서 쓰는 각도 → 원호 변환 */
export function cooldownArc(ratio: number): [number, number] {
  return [-Math.PI / 2, -Math.PI / 2 + TAU * ratio];
}
