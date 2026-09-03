import { VIEW } from '../data/balance';
import { viewScale } from './layout';

export interface TextOptions {
  size?: number;
  color?: string;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  weight?: number | string;
  alpha?: number;
}

/**
 * 그리기 계층 인터페이스.
 * 게임 로직은 이 인터페이스만 사용합니다. Canvas 2D 가 한계에 부딪히면
 * 이 파일의 구현만 PixiJS 로 갈아끼우면 됩니다 (기획.md 2장).
 */
export interface Renderer {
  readonly width: number;
  readonly height: number;
  begin(offsetX: number, offsetY: number): void;
  end(): void;
  clear(color: string): void;
  circle(x: number, y: number, r: number, color: string, alpha?: number): void;
  ring(x: number, y: number, r: number, color: string, width?: number, alpha?: number): void;
  poly(x: number, y: number, r: number, sides: number, rotation: number, color: string, alpha?: number): void;
  polyOutline(x: number, y: number, r: number, sides: number, rotation: number, color: string, width?: number, alpha?: number): void;
  line(x1: number, y1: number, x2: number, y2: number, color: string, width?: number, alpha?: number): void;
  rect(x: number, y: number, w: number, h: number, color: string, alpha?: number): void;
  rectOutline(x: number, y: number, w: number, h: number, color: string, width?: number, alpha?: number): void;
  arc(x: number, y: number, r: number, from: number, to: number, color: string, width: number, alpha?: number): void;
  cone(x: number, y: number, r: number, angle: number, spread: number, color: string, alpha?: number): void;
  text(str: string, x: number, y: number, opts?: TextOptions): void;
  fullscreenTint(color: string, alpha: number): void;
}

export class Canvas2DRenderer implements Renderer {
  readonly ctx: CanvasRenderingContext2D;
  readonly width = VIEW.w;
  readonly height = VIEW.h;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D 컨텍스트를 만들 수 없습니다');
    this.ctx = ctx;
    // **여기서 resize 를 직접 듣지 않습니다.** 무대 배율과 캔버스 해상도는 같은
    // 순간에 맞춰져야 하므로 `watchViewport` 가 둘을 함께 부릅니다 (`main.ts`)
    this.resize();
  }

  /**
   * 게임 좌표는 항상 1710x720 입니다. 화면에 맞춰 키우는 것은 `#stage` 가 하고
   * (`render/layout.ts`), 여기서는 **그 배율만큼 더 촘촘하게 그립니다.**
   *
   * CSS 크기를 설계 크기 그대로 두는 것이 중요합니다. 여기서 창 크기를 또 곱하면
   * 무대 배율과 두 번 곱해져서 화면 밖으로 나갑니다. **키우는 곳은 한 군데여야 합니다.**
   *
   * 뒷면(실제 픽셀)은 `dpr x 무대 배율` 로 잡습니다. 그래야 크게 늘렸을 때 글자가
   * 뭉개지지 않습니다. 상한을 두는 것은 큰 화면에서 버퍼가 지나치게 커지는 것을
   * 막기 위해서입니다.
   */
  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px = Math.min(dpr * viewScale(), 3);
    this.canvas.width = Math.round(VIEW.w * px);
    this.canvas.height = Math.round(VIEW.h * px);
    this.canvas.style.width = `${VIEW.w}px`;
    this.canvas.style.height = `${VIEW.h}px`;
    this.ctx.setTransform(px, 0, 0, px, 0, 0);
    this.baseTransform = px;
  }

  private baseTransform = 1;

  begin(offsetX: number, offsetY: number): void {
    this.ctx.setTransform(this.baseTransform, 0, 0, this.baseTransform, offsetX * this.baseTransform, offsetY * this.baseTransform);
  }

  end(): void {
    this.ctx.setTransform(this.baseTransform, 0, 0, this.baseTransform, 0, 0);
  }

  clear(color: string): void {
    const c = this.ctx;
    c.save();
    c.setTransform(this.baseTransform, 0, 0, this.baseTransform, 0, 0);
    c.fillStyle = color;
    c.fillRect(0, 0, VIEW.w, VIEW.h);
    c.restore();
  }

  circle(x: number, y: number, r: number, color: string, alpha = 1): void {
    const c = this.ctx;
    if (alpha <= 0) return;
    c.globalAlpha = alpha;
    c.fillStyle = color;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
    c.globalAlpha = 1;
  }

  ring(x: number, y: number, r: number, color: string, width = 2, alpha = 1): void {
    const c = this.ctx;
    if (alpha <= 0) return;
    c.globalAlpha = alpha;
    c.strokeStyle = color;
    c.lineWidth = width;
    c.beginPath();
    c.arc(x, y, Math.max(0.5, r), 0, Math.PI * 2);
    c.stroke();
    c.globalAlpha = 1;
  }

  private tracePoly(x: number, y: number, r: number, sides: number, rotation: number): void {
    const c = this.ctx;
    c.beginPath();
    for (let i = 0; i < sides; i++) {
      const a = rotation + (i / sides) * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (i === 0) c.moveTo(px, py);
      else c.lineTo(px, py);
    }
    c.closePath();
  }

  poly(x: number, y: number, r: number, sides: number, rotation: number, color: string, alpha = 1): void {
    if (alpha <= 0) return;
    const c = this.ctx;
    c.globalAlpha = alpha;
    c.fillStyle = color;
    this.tracePoly(x, y, r, sides, rotation);
    c.fill();
    c.globalAlpha = 1;
  }

  polyOutline(x: number, y: number, r: number, sides: number, rotation: number, color: string, width = 2, alpha = 1): void {
    if (alpha <= 0) return;
    const c = this.ctx;
    c.globalAlpha = alpha;
    c.strokeStyle = color;
    c.lineWidth = width;
    this.tracePoly(x, y, r, sides, rotation);
    c.stroke();
    c.globalAlpha = 1;
  }

  line(x1: number, y1: number, x2: number, y2: number, color: string, width = 2, alpha = 1): void {
    if (alpha <= 0) return;
    const c = this.ctx;
    c.globalAlpha = alpha;
    c.strokeStyle = color;
    c.lineWidth = width;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(x1, y1);
    c.lineTo(x2, y2);
    c.stroke();
    c.globalAlpha = 1;
  }

  rect(x: number, y: number, w: number, h: number, color: string, alpha = 1): void {
    if (alpha <= 0) return;
    const c = this.ctx;
    c.globalAlpha = alpha;
    c.fillStyle = color;
    c.fillRect(x, y, w, h);
    c.globalAlpha = 1;
  }

  rectOutline(x: number, y: number, w: number, h: number, color: string, width = 1, alpha = 1): void {
    if (alpha <= 0) return;
    const c = this.ctx;
    c.globalAlpha = alpha;
    c.strokeStyle = color;
    c.lineWidth = width;
    c.strokeRect(x, y, w, h);
    c.globalAlpha = 1;
  }

  arc(x: number, y: number, r: number, from: number, to: number, color: string, width: number, alpha = 1): void {
    if (alpha <= 0) return;
    const c = this.ctx;
    c.globalAlpha = alpha;
    c.strokeStyle = color;
    c.lineWidth = width;
    c.beginPath();
    c.arc(x, y, r, from, to);
    c.stroke();
    c.globalAlpha = 1;
  }

  cone(x: number, y: number, r: number, angle: number, spread: number, color: string, alpha = 1): void {
    if (alpha <= 0) return;
    const c = this.ctx;
    c.globalAlpha = alpha;
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(x, y);
    c.arc(x, y, r, angle - spread, angle + spread);
    c.closePath();
    c.fill();
    c.globalAlpha = 1;
  }

  text(str: string, x: number, y: number, opts: TextOptions = {}): void {
    const c = this.ctx;
    const size = opts.size ?? 14;
    c.globalAlpha = opts.alpha ?? 1;
    c.fillStyle = opts.color ?? '#e6ebf5';
    c.font = `${opts.weight ?? 600} ${size}px 'Pretendard', 'Malgun Gothic', system-ui, sans-serif`;
    c.textAlign = opts.align ?? 'left';
    c.textBaseline = opts.baseline ?? 'alphabetic';
    c.fillText(str, x, y);
    c.globalAlpha = 1;
  }

  fullscreenTint(color: string, alpha: number): void {
    if (alpha <= 0) return;
    const c = this.ctx;
    c.save();
    c.setTransform(this.baseTransform, 0, 0, this.baseTransform, 0, 0);
    c.globalAlpha = alpha;
    c.fillStyle = color;
    c.fillRect(0, 0, VIEW.w, VIEW.h);
    c.restore();
    c.globalAlpha = 1;
  }
}
