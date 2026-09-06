import { getSkillDef } from '../skills/registry';
import type { Input } from '../core/input';
import type { World } from '../game/world';

/**
 * 터치 조작 (모바일).
 *
 * **화면은 가로가 기준입니다.** 세로로 들면 게임이 우표만 해지므로, 그때는
 * 돌려달라는 안내만 띄웁니다 (게임을 멈추지는 않습니다).
 *
 * 셋이 붙습니다.
 *
 * | 자리 | 무엇 |
 * |---|---|
 * | 좌측 아래 | 이동 조이스틱 (누른 자리에 뜹니다) |
 * | 우측 아래 | Q (유틸 스킬) |
 * | 우측 위 | 일시정지 |
 *
 * **좌우 정보 패널을 펴는 버튼은 없습니다.** 요즘 폰 가로(20:9)에서는 패널을 접어도
 * 경기장이 10% 커질 뿐이라 토글을 둘 값어치가 없었고, 그 버튼이 HUD 의 처치·코인
 * 표시와 정확히 같은 자리였습니다. 모바일에서는 패널을 아예 안 그리고, 스탯과 스킬
 * 목록은 **일시정지 화면**에서 봅니다.
 *
 * **오버레이(`#overlay`) 밖에 답니다.** 그 안에 넣으면 화면을 바꿀 때마다
 * `clearOverlay()` 가 같이 지웁니다. 알림(`#toasts`)을 밖에 둔 것과 같은 이유입니다.
 */

const CONTAINER_ID = 'touch';

/**
 * 조이스틱 반경의 상한 (px). 손가락을 이만큼 끌면 최대 속도입니다.
 *
 * **실제 값은 화면 높이에서 계산합니다** (`stickRadius`). 가로 화면에서 모자라는
 * 것은 세로라, 작은 폰에서 상한을 그대로 쓰면 조이스틱이 화면의 3분의 1을 먹습니다.
 */
const STICK_MAX_RADIUS = 56;
const STICK_MIN_RADIUS = 38;
/** 이보다 짧게 끌면 안 움직입니다. 손을 얹기만 했을 때 미끄러지는 것을 막습니다 */
const DEAD_ZONE = 8;

/**
 * 이 값 이하이면 모바일 레이아웃입니다 (짧은 쪽 변, px).
 *
 * 터치 여부만으로 가르면 **터치되는 윈도우 노트북과 큰 태블릿까지** 조이스틱과
 * 전체화면이 붙습니다. 마우스와 키보드가 있는 기기에 그것이 뜨면 화면만 가립니다.
 */
const MOBILE_MAX_SHORT_SIDE = 540;

export interface TouchUi {
  /** 판이 도는 동안에만 보입니다 */
  setVisible(visible: boolean): void;
  /** Q 버튼에 지금 든 유틸 스킬의 이름과 쿨다운을 비춥니다 */
  update(w: World | null): void;
  /** 화면이 바뀌었을 때 버튼 크기를 다시 잡습니다 */
  resize(): void;
}

/**
 * 터치가 되는 기기인가.
 *
 * **브라우저 전역이 있다고 가정하면 안 됩니다.** 부팅 점검은 Node 에서 도는데
 * `navigator` 는 Node 20 에 없고 21 부터 생겼습니다. 그대로 읽으면 로컬(24)에서는
 * 통과하고 CI(20)에서만 터집니다. 실제로 한 번 그렇게 걸렸습니다.
 */
export function isTouchDevice(): boolean {
  if (typeof window !== 'undefined' && 'ontouchstart' in window) return true;
  return typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;
}

/**
 * 모바일 레이아웃으로 그릴 것인가.
 *
 * **터치 여부와 화면 크기를 함께 봅니다.** `isTouchDevice()` 하나로 가르면 터치
 * 노트북에도 조이스틱이 뜹니다. 회전하면 값이 달라지므로 **한 번 재서 보관하지 말고
 * 필요할 때마다 부르십시오** (`main.ts` 가 resize 마다 다시 봅니다).
 */
export function isMobileLayout(): boolean {
  if (!isTouchDevice()) return false;
  if (typeof window === 'undefined') return false;
  return Math.min(window.innerWidth, window.innerHeight) <= MOBILE_MAX_SHORT_SIDE;
}

/** 지금 화면에서 쓸 조이스틱 반경 */
function stickRadius(): number {
  const h = typeof window !== 'undefined' ? window.innerHeight : 720;
  return Math.round(Math.max(STICK_MIN_RADIUS, Math.min(STICK_MAX_RADIUS, h * 0.16)));
}

export function createTouchUi(input: Input): TouchUi {
  const root = document.createElement('div');
  root.id = CONTAINER_ID;
  root.hidden = true;

  // --- 이동 조이스틱 -------------------------------------------------------
  //
  // **누른 자리가 중심입니다.** 고정된 원 한가운데를 정확히 짚게 하면 화면을 안 보고
  // 조작할 수가 없습니다. 그래서 손가락을 받는 것은 좌하단의 **보이지 않는 넓은
  // 구역**이고, 눈에 보이는 원은 누른 그 자리에 떠오릅니다.
  const zone = document.createElement('div');
  zone.className = 'tc-zone';

  const stick = document.createElement('div');
  stick.className = 'tc-stick';
  stick.hidden = true;
  const knob = document.createElement('div');
  knob.className = 'tc-knob';
  stick.append(knob);

  let stickId: number | null = null;
  let originX = 0;
  let originY = 0;
  /** 이번에 잡은 조이스틱의 반경. 잡는 순간 굳혀서 도중에 회전해도 안 흔들립니다 */
  let radius = STICK_MAX_RADIUS;

  const moveKnob = (dx: number, dy: number) => {
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  };

  const hideStick = () => {
    stick.hidden = true;
    moveKnob(0, 0);
  };

  const startStick = (e: PointerEvent) => {
    if (stickId !== null) return;
    stickId = e.pointerId;
    zone.setPointerCapture(e.pointerId);
    radius = stickRadius();
    originX = e.clientX;
    originY = e.clientY;
    // 누른 자리에 원을 띄웁니다. 크기를 여기서 정하므로 CSS 에는 숫자가 없습니다
    stick.style.width = `${radius * 2}px`;
    stick.style.height = `${radius * 2}px`;
    stick.style.left = `${originX}px`;
    stick.style.top = `${originY}px`;
    knob.style.width = `${Math.round(radius * 0.9)}px`;
    knob.style.height = `${Math.round(radius * 0.9)}px`;
    stick.hidden = false;
    dragStick(e);
  };

  const dragStick = (e: PointerEvent) => {
    if (stickId !== e.pointerId) return;
    e.preventDefault();
    let dx = e.clientX - originX;
    let dy = e.clientY - originY;
    const len = Math.hypot(dx, dy);
    if (len < DEAD_ZONE) {
      moveKnob(0, 0);
      input.setTouchVector({ x: 0, y: 0 });
      return;
    }
    // 반경을 넘어가도 방향만 받고 세기는 최대에서 멈춥니다
    const clamped = Math.min(len, radius);
    dx = (dx / len) * clamped;
    dy = (dy / len) * clamped;
    moveKnob(dx, dy);
    input.setTouchVector({ x: dx / radius, y: dy / radius });
  };

  const endStick = (e: PointerEvent) => {
    if (stickId !== e.pointerId) return;
    stickId = null;
    hideStick();
    // **0 이 아니라 null 입니다.** 0 을 넣어두면 그 뒤로 키보드가 영영 안 먹습니다
    input.setTouchVector(null);
  };

  zone.addEventListener('pointerdown', startStick);
  zone.addEventListener('pointermove', dragStick);
  zone.addEventListener('pointerup', endStick);
  zone.addEventListener('pointercancel', endStick);

  // --- Q 버튼 ---------------------------------------------------------------
  const skillBtn = document.createElement('button');
  skillBtn.className = 'tc-skill';
  skillBtn.type = 'button';
  const skillName = document.createElement('span');
  skillName.className = 'tc-skill-name';
  const skillCool = document.createElement('span');
  skillCool.className = 'tc-skill-cool';
  skillBtn.append(skillName, skillCool);

  // **누르는 순간 발동합니다.** click 은 손을 떼야 오는데, 유틸은 대시처럼 위기에
  // 쓰는 것이라 그 사이가 그대로 손해입니다
  skillBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    input.pressVirtual('KeyQ');
  });
  const releaseSkill = () => input.releaseVirtual('KeyQ');
  skillBtn.addEventListener('pointerup', releaseSkill);
  skillBtn.addEventListener('pointercancel', releaseSkill);
  skillBtn.addEventListener('pointerleave', releaseSkill);

  // --- 일시정지 --------------------------------------------------------------
  //
  // **폰에는 Esc 가 없습니다.** 이 버튼이 없으면 30분짜리 판을 시작한 뒤로 끝날
  // 때까지 못 멈춥니다. 실제 Esc 와 **같은 길**로 들여보내서 처리하는 곳을 한 군데로
  // 둡니다 (`main.ts` 의 `input.wasPressed('Escape')`).
  //
  // 누른 자리에서 곧바로 놓습니다. 안 놓으면 `down` 에 Escape 가 남아서 다음에
  // 누를 때 "새로 눌림"으로 안 잡힙니다.
  //
  // **여기서 `pauseRun` 을 직접 부르지 마십시오.** 키와 버튼이 각각 판을 멈추면
  // 멈추는 길이 둘이 되고, 한쪽만 고친 순간 둘이 갈라집니다.
  const pauseBtn = document.createElement('button');
  pauseBtn.className = 'tc-pause';
  pauseBtn.type = 'button';
  pauseBtn.textContent = '⏸';
  pauseBtn.setAttribute('aria-label', '일시정지');
  pauseBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    input.pressVirtual('Escape');
    input.releaseVirtual('Escape');
  });

  root.append(zone, stick, skillBtn, pauseBtn);
  document.body.append(root);

  const applySize = () => {
    // Q 와 일시정지는 조이스틱과 같은 잣대로 커집니다. 한 화면에서 서로 크기가
    // 따로 놀면 어느 것이 주된 조작인지 안 읽힙니다
    const r = stickRadius();
    root.style.setProperty('--tc-skill', `${Math.round(r * 1.9)}px`);
    root.style.setProperty('--tc-pause', `${Math.round(r * 0.9)}px`);
  };
  applySize();

  return {
    setVisible(visible: boolean): void {
      root.hidden = !visible;
      // 안 보이는 동안 조이스틱을 잡고 있었다면 그대로 굳습니다
      if (!visible) {
        stickId = null;
        hideStick();
        input.setTouchVector(null);
        input.releaseVirtual('KeyQ');
      }
    },
    update(w: World | null): void {
      const slot = w?.player.utility ?? null;
      if (!slot) {
        skillName.textContent = '없음';
        skillCool.textContent = '';
        skillBtn.disabled = true;
        return;
      }
      skillBtn.disabled = false;
      skillName.textContent = getSkillDef(slot.id).name;
      // 남은 쿨다운. 준비됐으면 비웁니다. 판마다 바뀌는 값이라 화면에 남길 값입니다
      skillCool.textContent = slot.cooldown > 0 ? slot.cooldown.toFixed(1) : '';
      skillBtn.classList.toggle('ready', slot.cooldown <= 0);
    },
    resize(): void {
      applySize();
    },
  };
}
