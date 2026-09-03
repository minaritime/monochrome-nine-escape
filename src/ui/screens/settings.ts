import { achieveProgress } from '../../meta/achievements';
import type { SaveData } from '../../meta/save';
import { bindKeys, card, clearOverlay, h, overlayEl, screen } from './dom';

/**
 * 설정.
 *
 * **테스트용 화면입니다.** 지금 들어 있는 것은 초기화 두 개뿐이고,
 * 그중 업적 초기화는 밸런스를 다 보고 나면 지울 항목입니다 (아래 `TEST_ONLY` 표시).
 *
 * 두 항목 모두 **한 번 더 눌러야** 실행됩니다. 잘못 누르면 되돌릴 방법이 없는데
 * 카드 한 번에 지워지면 도감을 열려다 판 기록을 통째로 날립니다.
 */

export interface SettingsActions {
  /** 저장 전체를 지웁니다 */
  resetAll: () => void;
  /** TEST_ONLY: 업적만 지웁니다. 정식판에서는 이 항목째로 뺍니다 */
  resetAchievements: () => void;
  back: () => void;
}

type DangerId = 'all' | 'achievements';

interface DangerItem {
  id: DangerId;
  key: string;
  title: string;
  desc: string;
  run: () => void;
}

export function showSettings(save: SaveData, notice: string, actions: SettingsActions): () => void {
  const { done, total } = achieveProgress(save);

  const items: DangerItem[] = [
    {
      id: 'all',
      key: '1',
      title: '모든 데이터 초기화',
      desc: `코인 ${save.coins} · 영구 강화 · 기록 · 도감 · 업적 · 난이도 해금을 전부 지웁니다`,
      run: actions.resetAll,
    },
    {
      // TEST_ONLY: 알림과 판정을 다시 보려고 둔 통로입니다
      id: 'achievements',
      key: '2',
      title: '업적 초기화',
      desc: `업적 ${done} / ${total} 와 업적 누적값만 지웁니다. 받은 코인은 남고, 기록으로 판정되는 업적은 다시 열립니다`,
      run: actions.resetAchievements,
    },
  ];

  /** 한 번 눌러 겨눈 항목. 같은 것을 또 누르면 실행됩니다 */
  let armed: DangerId | null = null;
  let unbindKeys: () => void = () => {};

  const press = (item: DangerItem): void => {
    if (armed !== item.id) {
      armed = item.id;
      render();
      return;
    }
    armed = null;
    item.run();
  };

  const render = (): void => {
    unbindKeys();
    clearOverlay();

    const rows = items.map((item) => {
      const on = armed === item.id;
      const el = card({
        key: item.key,
        // 대괄호는 이 게임에서 상태를 뜻합니다 ([장착] · [교체] · [적용 중]).
        // 한국어 문장에 대시를 쓰지 않는다는 규칙과도 맞습니다
        title: on ? `${item.title}  [한 번 더 누르면 지웁니다]` : item.title,
        desc: item.desc,
        onClick: () => press(item),
      });
      el.classList.add('danger');
      if (on) el.classList.add('armed');
      return el;
    });

    const body: Node[] = [];
    // 방금 무엇을 지웠는지. 화면이 그대로라 이 줄이 없으면 눌렸는지 알 수 없습니다
    if (notice) body.push(h('div', { class: 'settings-notice' }, [notice]));
    body.push(h('div', { class: 'rowlist' }, rows));

    overlayEl().append(screen('설정', '테스트용입니다', body, 'narrow', actions.back));

    unbindKeys = bindKeys((code) => {
      if (code === 'Escape' || code === 'Backspace') {
        // 겨눈 상태에서 Esc 는 먼저 그것을 풀어줍니다
        if (armed) {
          armed = null;
          render();
          return;
        }
        actions.back();
        return;
      }
      const hit = items.find((i) => code === `Digit${i.key}`);
      if (hit) press(hit);
    });
  };

  render();
  return () => unbindKeys();
}
