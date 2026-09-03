import { DEBUG } from '../../data/balance';
import { bindKeys, clearOverlay, h, overlayEl } from './dom';

/**
 * 디버그 잠금 화면.
 *
 * **무엇을 여는 화면인지 적지 않습니다.** 여기 "디버그"라고 써 두면, 잘못 눌러 들어온
 * 사람에게 그 자리에 무언가 있다는 사실을 알려주게 됩니다. 아는 사람만 치고 들어오는
 * 자리라 설명이 필요 없고, 판마다 바뀌지 않는 글은 안 적는다는 규칙과도 맞습니다.
 *
 * **입력칸(`<input>`)을 쓰지 않고 `KeyboardEvent.code` 를 셉니다.** 입력칸이면 한글
 * 입력 상태에서 같은 자리를 눌러도 다른 글자가 들어가서, 입력기 상태에 따라 열리기도
 * 하고 안 열리기도 합니다. `code` 는 자판의 자리라 그 영향을 안 받습니다.
 *
 * 다 맞으면 그 순간 바로 열립니다. Enter 를 따로 누르지 않습니다.
 */
export function showDebugGate(onUnlock: () => void, onCancel: () => void): () => void {
  const seq = DEBUG.unlockSequence;
  let typed = 0;

  const dots = h('div', { class: 'gate-dots' });
  const draw = () => {
    dots.replaceChildren(...seq.map((_, i) => h('span', { class: `gate-dot${i < typed ? ' on' : ''}` })));
  };
  draw();

  overlayEl().replaceChildren(h('div', { class: 'gate' }, [dots]));

  return bindKeys((code) => {
    if (code === 'Escape') {
      clearOverlay();
      onCancel();
      return;
    }
    // 글자 자리만 셉니다. Shift 처럼 같이 눌리는 키까지 세면 손이 스치기만 해도 끊깁니다
    if (!code.startsWith('Key')) return;

    // 한 글자라도 어긋나면 처음으로 돌아갑니다. 다만 그 키가 첫 글자면 거기서 다시
    // 시작합니다. 안 그러면 오타 하나에 한 번 더 헛치게 됩니다
    if (code === seq[typed]) typed++;
    else typed = code === seq[0] ? 1 : 0;
    draw();

    if (typed === seq.length) {
      clearOverlay();
      onUnlock();
    }
  });
}
