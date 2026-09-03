import { FIXED_DT, MAX_STEPS_PER_FRAME } from '../data/balance';

export interface LoopCallbacks {
  /** 고정 타임스텝 물리 갱신 */
  update: (dt: number) => void;
  /** 가변 렌더. alpha 는 마지막 스텝 이후 보간 비율 */
  render: (alpha: number, fps: number) => void;
}

/**
 * 고정 타임스텝 루프. 물리는 항상 60Hz, 렌더는 화면 주사율을 따릅니다.
 * 프레임이 밀려도 물리 결과가 기기마다 달라지지 않게 하는 게 목적입니다.
 */
export class GameLoop {
  private raf = 0;
  private last = 0;
  private acc = 0;
  private running = false;

  private fpsSamples: number[] = [];
  private fps = 60;

  constructor(private cb: LoopCallbacks) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.acc = 0;
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);

    let elapsed = (now - this.last) / 1000;
    this.last = now;
    if (elapsed > 0.25) elapsed = 0.25; // 탭 복귀 시 폭주 방지

    this.trackFps(elapsed);

    this.acc += elapsed;
    let steps = 0;
    while (this.acc >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      this.cb.update(FIXED_DT);
      this.acc -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.acc = 0;

    this.cb.render(this.acc / FIXED_DT, this.fps);
  };

  private trackFps(elapsed: number): void {
    if (elapsed <= 0) return;
    this.fpsSamples.push(1 / elapsed);
    if (this.fpsSamples.length > 30) this.fpsSamples.shift();
    let sum = 0;
    for (const s of this.fpsSamples) sum += s;
    this.fps = sum / this.fpsSamples.length;
  }
}
