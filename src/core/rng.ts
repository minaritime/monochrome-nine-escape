/**
 * 시드 기반 난수. 같은 시드는 같은 수열을 냅니다.
 * 밸런싱 전후 비교나 버그 재현에 씁니다 (기획.md 10장).
 */
export class Rng {
  private state: number;
  readonly seed: number;

  constructor(seed?: number) {
    this.seed = seed ?? (Math.random() * 0xffffffff) >>> 0;
    this.state = this.seed || 1;
  }

  /** 0 이상 1 미만 */
  next(): number {
    // mulberry32
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo);
  }

  int(loInclusive: number, hiExclusive: number): number {
    return Math.floor(this.range(loInclusive, hiExclusive));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(0, arr.length)];
  }

  /** 가중치 추첨. weights 는 items 와 같은 길이 */
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    let total = 0;
    for (const w of weights) total += w;
    let roll = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  angle(): number {
    return this.next() * Math.PI * 2;
  }
}
