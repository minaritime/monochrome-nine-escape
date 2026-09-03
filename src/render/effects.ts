import { SHAKE } from '../data/balance';
import type { Rng } from '../core/rng';

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  radius: number;
  color: string;
  drag: number;
}

export interface FloatingText {
  x: number;
  y: number;
  vy: number;
  life: number;
  maxLife: number;
  text: string;
  color: string;
  size: number;
}

/** 파티클, 화면 흔들림, 데미지 숫자 */
export class Effects {
  particles: Particle[] = [];
  texts: FloatingText[] = [];
  shake = 0;
  shakeX = 0;
  shakeY = 0;
  /** 피격 시 화면 가장자리 붉은 섬광 */
  hurtFlash = 0;

  /**
   * 설정의 화면 흔들림 배율 (`SETTINGS.shake`). `SHAKE.mul` 위에 곱합니다.
   * 기본은 절반(0.5)이라 실제로 걸리는 값은 0.3 입니다.
   */
  shakeScale = 1;
  /** 설정의 파티클 양 배율 (`SETTINGS.particles`) */
  particleScale = 1;

  /**
   * **월드와 다른 난수기를 받습니다** (`world.ts` 에서 따로 만들어 넘깁니다).
   *
   * 같은 것을 쓰면 파티클을 적게 뿌리는 사람은 난수를 덜 뽑게 되어, 그 뒤의 스폰과
   * 추첨이 통째로 밀립니다. **설정을 바꾸면 시드를 고정해도 다른 판이 됩니다.**
   * 눈에 보이는 것과 게임의 결과는 서로를 건드리면 안 됩니다.
   */
  constructor(private rng: Rng) {}

  /** 설정 배율을 반영한 실제 개수. 0 이 되어도 1 로 올리지 않습니다 ("끔"이 있어야 합니다) */
  private scaled(count: number): number {
    if (this.particleScale >= 1) return count;
    return Math.round(count * this.particleScale);
  }

  burst(x: number, y: number, count: number, color: string, speed = 130, size = 3, life = 0.45): void {
    if (this.particles.length > 1400) return;
    count = this.scaled(count);
    for (let i = 0; i < count; i++) {
      const a = this.rng.angle();
      const s = speed * this.rng.range(0.35, 1);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life,
        maxLife: life,
        radius: size * this.rng.range(0.6, 1.3),
        color,
        drag: 3.2,
      });
    }
  }

  spray(x: number, y: number, angle: number, spread: number, count: number, color: string, speed = 200, size = 2.4): void {
    count = this.scaled(count);
    if (this.particles.length > 1400) return;
    for (let i = 0; i < count; i++) {
      const a = angle + this.rng.range(-spread, spread);
      const s = speed * this.rng.range(0.4, 1.1);
      const life = this.rng.range(0.16, 0.34);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life,
        maxLife: life,
        radius: size * this.rng.range(0.7, 1.4),
        color,
        drag: 2.4,
      });
    }
  }

  /**
   * 부채꼴 전체를 채우는 불티. 사거리 끝까지 골고루 뿌립니다.
   * 발사구에서만 뿜으면 실제 사거리보다 짧아 보여서 어디까지 닿는지 알 수 없습니다.
   */
  coneJet(x: number, y: number, angle: number, spread: number, range: number, count: number): void {
    count = this.scaled(count);
    if (this.particles.length > 1400) return;
    const colors = ['#ffd166', '#ff9a3c', '#ff7a3d', '#ff5a2d'];
    for (let i = 0; i < count; i++) {
      // 제곱근을 쓰면 면적 기준으로 고르게 퍼집니다 (바깥쪽이 더 넓으므로 더 많이)
      const t = Math.sqrt(this.rng.next());
      const d = t * range;
      // 뿌리 쪽은 좁고 끝으로 갈수록 벌어집니다
      const a = angle + this.rng.range(-spread, spread) * (0.3 + 0.7 * t);
      const life = this.rng.range(0.14, 0.3);
      this.particles.push({
        x: x + Math.cos(a) * d,
        y: y + Math.sin(a) * d,
        vx: Math.cos(a) * 90 * (1 - t),
        vy: Math.sin(a) * 90 * (1 - t),
        life,
        maxLife: life,
        radius: (2.5 + t * 5) * this.rng.range(0.7, 1.2),
        color: colors[Math.min(colors.length - 1, Math.floor(t * colors.length))],
        drag: 2.6,
      });
    }
  }

  /**
   * 주변을 도는 기운. 오라처럼 "여기까지 닿는다"를 선으로 긋지 않고
   * 흩어지는 입자로만 보여줄 때 씁니다. 가장자리를 일부러 흐리게 둡니다.
   */
  auraMotes(x: number, y: number, radius: number, count: number, color: string): void {
    count = this.scaled(count);
    if (this.particles.length > 1400) return;
    for (let i = 0; i < count; i++) {
      const a = this.rng.angle();
      // 안쪽부터 가장자리 살짝 바깥까지 퍼뜨려 경계가 드러나지 않게 합니다
      const d = radius * this.rng.range(0.45, 1.05);
      const tangent = a + Math.PI / 2;
      const life = this.rng.range(0.25, 0.55);
      this.particles.push({
        x: x + Math.cos(a) * d,
        y: y + Math.sin(a) * d,
        vx: Math.cos(tangent) * 34,
        vy: Math.sin(tangent) * 34,
        life,
        maxLife: life,
        radius: this.rng.range(1.6, 3.4),
        color,
        drag: 1.1,
      });
    }
  }

  text(x: number, y: number, text: string, color: string, size = 15): void {
    if (this.texts.length > 90) return;
    this.texts.push({ x, y, vy: -42, life: 0.72, maxLife: 0.72, text, color, size });
  }

  /**
   * 흔들림은 부르는 쪽마다 세기가 다른데, 후반에는 폭발과 처치가 한꺼번에 몰려서
   * 그 값들이 계속 더해집니다. 부르는 곳을 하나씩 고치는 대신 여기 한 곳에서
   * 전체 배율과 상한을 겁니다 (`SHAKE`). 세기의 비율은 그대로 유지됩니다.
   */
  addShake(amount: number): void {
    this.shake = Math.min(this.shake + amount * SHAKE.mul * this.shakeScale, SHAKE.max);
  }

  /**
   * 죽는 순간에만 쓰는 흔들림. 평소 상한(`SHAKE.max`)을 넘겨 `SHAKE.deathMax` 까지 갑니다.
   * 상한을 조인 이유는 후반에 폭발과 처치가 몰려 계속 떨리는 것이었는데,
   * 이건 판당 한 번뿐이고 그 뒤로 게임이 끝나므로 그 문제와 무관합니다.
   *
   * 더하지 않고 큰 값으로 갈아끼웁니다. 죽기 직전에 이미 흔들리고 있었다고 해서
   * 죽는 순간이 더 크게 흔들릴 이유는 없습니다.
   */
  addDeathShake(amount: number): void {
    this.shake = Math.min(Math.max(this.shake, amount), SHAKE.deathMax);
  }

  flashHurt(amount = 1): void {
    this.hurtFlash = Math.min(this.hurtFlash + amount, 1.2);
  }

  update(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      const d = Math.max(0, 1 - p.drag * dt);
      p.vx *= d;
      p.vy *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= dt;
      if (t.life <= 0) {
        this.texts.splice(i, 1);
        continue;
      }
      t.y += t.vy * dt;
      t.vy *= Math.max(0, 1 - 2.6 * dt);
    }

    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * SHAKE.decay);
      const a = this.rng.angle();
      this.shakeX = Math.cos(a) * this.shake;
      this.shakeY = Math.sin(a) * this.shake;
    } else {
      this.shakeX = 0;
      this.shakeY = 0;
    }

    if (this.hurtFlash > 0) this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.2);
  }

  clear(): void {
    this.particles.length = 0;
    this.texts.length = 0;
    this.shake = 0;
    this.hurtFlash = 0;
  }
}
