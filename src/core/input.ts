/**
 * 키 상태 스냅샷.
 * 이 게임은 마우스를 쓰지 않습니다 (기획.md 2장). 메뉴 클릭만 DOM 이 처리합니다.
 */
export class Input {
  private down = new Set<string>();
  private pressedThisStep = new Set<string>();
  private buffer = new Set<string>();

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
   * 이동은 방향키만 씁니다. WASD 는 이동에 쓰지 않습니다.
   * 스킬이 Q / W / E 라서 W 가 겹치기 때문입니다.
   */
  moveVector(): { x: number; y: number } {
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
