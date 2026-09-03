import { getSkillDef } from '../skills/registry';
import type { Input } from '../core/input';
import type { World } from '../game/world';

/**
 * 터치 조작 (모바일).
 *
 * **화면은 가로가 기준입니다.** 경기장이 16:9 라 폰을 눕히면 거의 딱 맞습니다.
 * 세로로 들면 게임이 우표만 해지므로, 그때는 돌려달라는 안내만 띄웁니다.
 *
 * 세 가지가 붙습니다.
 *
 * | 자리 | 무엇 |
 * |---|---|
 * | 좌측 아래 | 이동 조이스틱 |
 * | 우측 아래 | Q (유틸 스킬) |
 * | 우측 위 | 좌우 정보 패널 펴기 / 접기 |
 *
 * **오버레이(`#overlay`) 밖에 답니다.** 그 안에 넣으면 화면을 바꿀 때마다
 * `clearOverlay()` 가 같이 지웁니다. 알림(`#toasts`)을 밖에 둔 것과 같은 이유입니다.
 */

const CONTAINER_ID = 'touch';

/** 손가락을 얼마나 끌어야 최대 속도인가 (px). 조이스틱 반경입니다 */
const STICK_RADIUS = 56;
/** 이보다 짧게 끌면 안 움직입니다. 손을 얹기만 했을 때 미끄러지는 것을 막습니다 */
const DEAD_ZONE = 8;

export interface TouchUi {
  /** 판이 도는 동안에만 보입니다 */
  setVisible(visible: boolean): void;
  /** Q 버튼에 지금 든 유틸 스킬의 이름과 쿨다운을 비춥니다 */
  update(w: World | null): void;
}

/**
 * 터치가 되는 기기인가. 마우스만 있는 PC 에서는 아무것도 안 붙입니다.
 *
 * **브라우저 전역이 있다고 가정하면 안 됩니다.** 부팅 점검은 Node 에서 도는데
 * `navigator` 는 Node 20 에 없고 21 부터 생겼습니다. 그대로 읽으면 로컬(24)에서는
 * 통과하고 CI(20)에서만 터집니다. 실제로 한 번 그렇게 걸렸습니다.
 */
export function isTouchDevice(): boolean {
  if (typeof window !== 'undefined' && 'ontouchstart' in window) return true;
  return typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;
}

export function createTouchUi(input: Input, onTogglePanels: () => void): TouchUi {
  const root = document.createElement('div');
  root.id = CONTAINER_ID;
  root.hidden = true;

  // --- 이동 조이스틱 -------------------------------------------------------
  const stick = document.createElement('div');
  stick.className = 'tc-stick';
  const knob = document.createElement('div');
  knob.className = 'tc-knob';
  stick.append(knob);

  let stickId: number | null = null;
  let originX = 0;
  let originY = 0;

  const moveKnob = (dx: number, dy: number) => {
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  };

  const startStick = (e: PointerEvent) => {
    if (stickId !== null) return;
    stickId = e.pointerId;
    stick.setPointerCapture(e.pointerId);
    // **누른 자리가 중심이 됩니다.** 고정된 원 한가운데를 정확히 짚게 하면
    // 화면을 안 보고 조작할 수가 없습니다
    const r = stick.getBoundingClientRect();
    originX = r.left + r.width / 2;
    originY = r.top + r.height / 2;
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
    const clamped = Math.min(len, STICK_RADIUS);
    dx = (dx / len) * clamped;
    dy = (dy / len) * clamped;
    moveKnob(dx, dy);
    input.setTouchVector({ x: dx / STICK_RADIUS, y: dy / STICK_RADIUS });
  };

  const endStick = (e: PointerEvent) => {
    if (stickId !== e.pointerId) return;
    stickId = null;
    moveKnob(0, 0);
    // **0 이 아니라 null 입니다.** 0 을 넣어두면 그 뒤로 키보드가 영영 안 먹습니다
    input.setTouchVector(null);
  };

  stick.addEventListener('pointerdown', startStick);
  stick.addEventListener('pointermove', dragStick);
  stick.addEventListener('pointerup', endStick);
  stick.addEventListener('pointercancel', endStick);

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

  // --- 패널 접기 -------------------------------------------------------------
  const panelBtn = document.createElement('button');
  panelBtn.className = 'tc-panel';
  panelBtn.type = 'button';
  panelBtn.textContent = '≡';
  panelBtn.addEventListener('click', onTogglePanels);

  root.append(stick, skillBtn, panelBtn);
  document.body.append(root);

  return {
    setVisible(visible: boolean): void {
      root.hidden = !visible;
      // 안 보이는 동안 조이스틱을 잡고 있었다면 그대로 굳습니다
      if (!visible) {
        stickId = null;
        moveKnob(0, 0);
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
  };
}
