import { ELITE } from '../../data/balance';
import type { EnemyDef } from '../../enemies/types';

/**
 * 도감에 쓰는 적 아이콘.
 * 게임 화면과 같은 규칙(원 또는 정다각형 + 외곽선)으로 그려서
 * 도감에서 본 모양과 실제로 만나는 모양이 같도록 합니다.
 */
export function enemyIcon(def: EnemyDef, size = 46, elite = false): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  canvas.style.flex = `0 0 ${size}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const cx = size / 2;
  const cy = size / 2;
  const radius = size * (def.extraDraw === 'boss' ? 0.4 : 0.32) * (elite ? 0.86 : 1);

  if (elite) drawEliteMark(ctx, cx, cy, radius);

  if (def.sides > 0) {
    tracePoly(ctx, cx, cy, radius, def.sides, -Math.PI / 2);
  } else {
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  }
  ctx.fillStyle = def.color;
  ctx.fill();
  ctx.strokeStyle = def.accent;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  drawMark(ctx, def, cx, cy, radius);
  return canvas;
}

/** 게임 화면의 정예 표식(붉은 이중 링 + 뿔)을 아이콘에도 그대로 씁니다 */
function drawEliteMark(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number): void {
  ctx.fillStyle = ELITE.markColor;
  ctx.globalAlpha = 0.18;
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.strokeStyle = ELITE.markColor;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 4, 0, Math.PI * 2);
  ctx.stroke();

  const top = cy - radius - 4;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  for (const dir of [-1, 1]) {
    const x = cx + radius * 0.55 * dir;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x + 2.5 * dir, top - 7);
    ctx.stroke();
  }
}

/** 게임 화면에서 그 적을 알아보게 해주는 표식을 같이 그립니다 */
function drawMark(ctx: CanvasRenderingContext2D, def: EnemyDef, cx: number, cy: number, radius: number): void {
  switch (def.extraDraw) {
    case 'shield': {
      ctx.strokeStyle = '#dbe6f7';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, radius + 4, -Math.PI * 0.75, -Math.PI * 0.25);
      ctx.stroke();
      break;
    }
    case 'bomber': {
      // 게임 화면과 같은 심지. 도감에서 본 모양 그대로 만나야 합니다
      ctx.strokeStyle = def.accent;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx, cy - radius);
      ctx.lineTo(cx + 3, cy - radius - 6);
      ctx.stroke();
      ctx.fillStyle = def.accent;
      ctx.beginPath();
      ctx.arc(cx + 3, cy - radius - 6, 2.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'splitter': {
      ctx.strokeStyle = def.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 0.5, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'mummy': {
      // 몸을 가로지르는 붕대 줄무늬
      ctx.strokeStyle = def.accent;
      ctx.lineWidth = 2;
      for (let i = -1; i <= 1; i++) {
        const dy = i * radius * 0.45;
        const half = Math.sqrt(Math.max(0, radius * radius - dy * dy)) * 0.92;
        ctx.beginPath();
        ctx.moveTo(cx - half, cy + dy);
        ctx.lineTo(cx + half, cy + dy);
        ctx.stroke();
      }
      break;
    }
    case 'summoner': {
      ctx.strokeStyle = def.accent;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(cx, cy, radius + 4, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'puddle': {
      // 죽은 자리에 깔릴 장판
      ctx.strokeStyle = def.color;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, radius + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    }
    case 'stealth': {
      // 반쪽만 칠한 원
      ctx.fillStyle = def.accent;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, -Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }
    case 'boss': {
      ctx.strokeStyle = def.accent;
      ctx.lineWidth = 1.5;
      tracePoly(ctx, cx, cy, radius + 4, 3, -Math.PI / 2);
      ctx.stroke();
      tracePoly(ctx, cx, cy, radius + 4, 3, Math.PI / 2);
      ctx.stroke();
      break;
    }
    default:
      break;
  }
}

function tracePoly(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, sides: number, rotation: number): void {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i / sides) * Math.PI * 2;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** 아직 만나지 못한 적 자리 */
export function unknownIcon(size = 46): HTMLElement {
  const el = document.createElement('div');
  el.textContent = '?';
  el.style.flex = `0 0 ${size}px`;
  el.style.height = `${size}px`;
  el.style.display = 'grid';
  el.style.placeItems = 'center';
  el.style.color = '#394154';
  el.style.fontSize = '22px';
  el.style.fontWeight = '800';
  return el;
}
