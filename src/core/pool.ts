/**
 * 단순 오브젝트 풀. 투사체와 파티클처럼 초당 수백 개가 생겼다 사라지는
 * 객체의 GC 부담을 줄입니다.
 */
export class Pool<T> {
  private free: T[] = [];

  constructor(
    private create: () => T,
    private reset: (item: T) => void,
    prefill = 0,
  ) {
    for (let i = 0; i < prefill; i++) this.free.push(create());
  }

  obtain(): T {
    const item = this.free.pop();
    return item ?? this.create();
  }

  release(item: T): void {
    this.reset(item);
    this.free.push(item);
  }

  get size(): number {
    return this.free.length;
  }
}

/**
 * 죽은 항목을 뒤 항목으로 덮어 지우는 제자리 압축.
 * splice 를 반복하는 것보다 훨씬 빠릅니다.
 */
export function compact<T>(arr: T[], isAlive: (item: T) => boolean, onRemove?: (item: T) => void): void {
  let write = 0;
  for (let read = 0; read < arr.length; read++) {
    const item = arr[read];
    if (isAlive(item)) {
      arr[write++] = item;
    } else if (onRemove) {
      onRemove(item);
    }
  }
  arr.length = write;
}
