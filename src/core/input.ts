/**
 * 키 상태 스냅샷.
 * 이 게임은 마우스를 쓰지 않습니다 (기획.md 2장). 메뉴 클릭만 DOM 이 처리합니다.
 */
export class Input {
  private down = new Set<string>();
  private pressedThisStep = new Set<string>();
  private buffer = new Set<string>();
  /**
   * 터치 조이스틱이 넣는 이동 방향 (`ui/touch.ts`).
   *
   * **키보드와 더하지 않고 갈아끼웁니다.** 둘을 더하면 조이스틱을 잡은 채로 방향키를
   * 누를 때 속도가 두 배가 되는 자리가 생깁니다. 어차피 한 사람이 둘을 같이 쓰지
   * 않으므로, **잡고 있는 동안에는 조이스틱이 이깁니다.**
   */
  private touch: { x: number; y: number } | null = null;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      const code = e.code;
      if (BLOCKED_DEFAULT.has(code)) e.preventDefault();
      if (!this.down.has(code)) this.buffer.add(code);
      this.down.add(code);
    });
    target.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
    });
    target.addEventListener('blur', () => {
      this.down.clear();
    });
  }

  /** 물리 스텝 시작 시 호출. 이번 스텝에서 "새로 눌린" 키를 확정합니다 */
  beginStep(): void {
    this.pressedThisStep = this.buffer;
    this.buffer = new Set();
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  wasPressed(code: string): boolean {
    return this.pressedThisStep.has(code);
  }

  /**
   * 이번 스텝에 아무 키나 새로 눌렸는가 (죽는 연출 건너뛰기).
   *
   * "누르고 있는가"가 아니라 "새로 눌렸는가"를 봅니다. 죽는 순간 방향키를 잡고
   * 있었다면 그대로 연출이 넘어가버립니다.
   */
  anyPressed(): boolean {
    return this.pressedThisStep.size > 0;
  }

  /**
   * 터치 조이스틱의 방향을 넣습니다. 길이는 0 ~ 1 이고, 손을 떼면 `null` 입니다.
   * **0 이 아니라 `null` 로 놓는 이유**는 "가만히 잡고 있는 것"과 "안 잡은 것"을
   * 갈라야 하기 때문입니다. 놓지 않고 0 을 넣으면 키보드가 영영 안 먹습니다.
   */
  setTouchVector(v: { x: number; y: number } | null): void {
    this.touch = v;
  }

  /**
   * 버튼을 눌러 키를 흉내 냅니다 (터치 Q 버튼).
   * 실제 키와 같은 길로 들어가야 `wasPressed` 한 곳만 보면 됩니다.
   */
  pressVirtual(code: string): void {
    if (!this.down.has(code)) this.buffer.add(code);
    this.down.add(code);
  }

  releaseVirtual(code: string): void {
    this.down.delete(code);
  }

  /**
   * 이동. 키보드는 **방향키만** 씁니다 (WASD 는 안 씁니다).
   * 터치 조이스틱을 잡고 있으면 그쪽이 이깁니다.
   */
  moveVector(): { x: number; y: number } {
    if (this.touch) return this.touch;
    let x = 0;
    let y = 0;
    if (this.isDown('ArrowLeft')) x -= 1;
    if (this.isDown('ArrowRight')) x += 1;
    if (this.isDown('ArrowUp')) y -= 1;
    if (this.isDown('ArrowDown')) y += 1;
    if (x !== 0 && y !== 0) {
      const inv = Math.SQRT1_2;
      x *= inv;
      y *= inv;
    }
    return { x, y };
  }

  clear(): void {
    this.down.clear();
    this.buffer.clear();
    this.pressedThisStep.clear();
    this.touch = null;
  }

  /**
   * "새로 눌림" 기록만 비웁니다. 누르고 있는 키는 유지합니다.
   * 메뉴를 닫은 키(Esc, 숫자키)가 게임 쪽에서 한 번 더 소비되는 것을 막습니다.
   */
  clearPresses(): void {
    this.buffer.clear();
    this.pressedThisStep.clear();
  }
}

/** 스크롤이나 검색창이 뜨는 것을 막을 키 */
const BLOCKED_DEFAULT = new Set([
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'F1',
  'F2',
  'F3',
  'F4',
  'Slash',
]);
