import { SETTINGS } from '../../data/balance';
import { achieveProgress } from '../../meta/achievements';
import { clearedAllFrom } from '../../meta/difficulty';
import type { SaveData } from '../../meta/save';
import { bindKeys, card, clearOverlay, h, overlayEl, screen } from './dom';

/**
 * 설정.
 *
 * **마우스로 쓰는 화면입니다.** 카드마다 붙어 있던 숫자 단축키를 뺐습니다. 설정은 판
 * 중에 급하게 누르는 것이 아니라 한 번 들어와서 만지고 나가는 자리라, 손이 키보드에
 * 있어야 할 이유가 없습니다.
 *
 * **Esc 만 남깁니다.** 나가는 수단이 아니라 **겨눈 것을 푸는 수단**입니다. 초기화를
 * 잘못 눌러 겨눈 상태에서 마우스로 풀려면 다른 카드를 눌러야 하는데 그게 더 위험합니다.
 * 나가는 길은 우측 상단 화살표 버튼에 이미 있습니다.
 *
 * 화면은 두 구역입니다. **켜고 끄는 것과 되돌릴 수 없는 것을 섞지 않습니다.**
 * 흔들림 토글이 데이터 초기화와 같은 모양으로 나란히 서면 위험도가 뭉개집니다.
 */

export interface SettingsActions {
  /** 개발자 모드 전용. 도감을 전부 열어 봅니다 */
  toggleDevBestiary: () => void;
  /** 개발자 모드 전용. 난이도를 일반·하드 모두 끝까지 엽니다 */
  unlockAllDifficulties: () => void;
  /** 개발자 모드 전용. 기록이 안 남는 시험장에 들어갑니다 */
  enterDebugMap: () => void;
  /** 단계형 설정을 한 칸 넘깁니다 (끝에 닿으면 처음으로) */
  cycleShake: () => void;
  cycleParticles: () => void;
  toggleAutoPause: () => void;
  /** 하드모드. 난이도 0~15 를 전부 깬 사람에게만 보입니다 */
  toggleHardMode: () => void;
  /** 저장 전체를 지웁니다 */
  resetAll: () => void;
  /** TEST_ONLY: 업적만 지웁니다. 정식판에서는 이 항목째로 뺍니다 */
  resetAchievements: () => void;
  /** 개발자 모드를 끕니다 (디버그 · `?unlock` · `?seed` 가 같이 잠깁니다) */
  devModeOff: () => void;
  back: () => void;
}

type DangerId = 'all' | 'achievements' | 'devoff';

interface DangerItem {
  id: DangerId;
  title: string;
  desc: string;
  run: () => void;
}

export function showSettings(save: SaveData, notice: string, actions: SettingsActions): () => void {
  const { done, total } = achieveProgress(save);

  const items: DangerItem[] = [
    {
      id: 'all',
      title: '모든 데이터 초기화',
      desc: `코인 ${save.coins} · 영구 강화 · 기록 · 도감 · 업적 · 난이도 해금을 전부 지웁니다`,
      run: actions.resetAll,
    },
  ];

  // **개발자 항목은 개발자 모드에서만 보입니다.**
  //
  // 업적 초기화는 누를 때마다 코인이 8,100 씩 다시 들어옵니다. 기록으로 판정되는
  // 업적이 곧바로 다시 열리기 때문인데, 알림을 다시 보려고 만든 버튼이라 그 동작
  // 자체는 맞습니다. 다만 **링크를 받아 들어온 사람에게 두 번 클릭으로 열려 있으면
  // 상점이라는 것이 없어집니다.** 21번 누르면 영구 강화가 전부 채워집니다.
  if (save.devMode) {
    items.push({
      // TEST_ONLY: 알림과 판정을 다시 보려고 둔 통로입니다
      id: 'achievements',
      title: '업적 초기화',
      desc: `업적 ${done} / ${total} 와 업적 누적값만 지웁니다. 받은 코인은 남고, 기록으로 판정되는 업적은 다시 열립니다`,
      run: actions.resetAchievements,
    });
    items.push({
      id: 'devoff',
      title: '개발자 모드 끄기',
      desc: '디버그 오버레이와 주소 파라미터가 같이 잠깁니다. 다시 켜려면 비밀번호를 쳐야 합니다',
      run: actions.devModeOff,
    });
  }

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

  /** 지금 값을 오른쪽에 달고 누르면 다음 값으로 넘어가는 카드 */
  const toggle = (title: string, value: string, onClick: () => void): HTMLElement => {
    const el = card({
      title,
      // 대괄호는 이 게임에서 상태를 뜻합니다 ([장착] · [교체] · [적용 중])
      right: h('div', { class: 'toggle-value' }, [`[ ${value} ]`]),
      onClick: () => {
        armed = null;
        onClick();
      },
    });
    el.classList.add('toggle');
    return el;
  };

  const render = (): void => {
    unbindKeys();
    clearOverlay();

    const body: Node[] = [];
    // 방금 무엇을 했는지. 화면이 그대로라 이 줄이 없으면 눌렸는지 알 수 없습니다
    if (notice) body.push(h('div', { class: 'settings-notice' }, [notice]));

    body.push(
      h('div', { class: 'rowlist' }, [
        toggle('화면 흔들림', SETTINGS.shake.levels[save.shakeLevel].name, actions.cycleShake),
        toggle('파티클', SETTINGS.particles.levels[save.particleLevel].name, actions.cycleParticles),
        toggle('창을 벗어나면 정지', save.autoPause ? '켬' : '끔', actions.toggleAutoPause),
      ]),
    );

    // **히든 요소입니다.** 난이도 0 부터 15 까지 전부 깨야 나타납니다.
    // 입문(-1)은 빼는데, 일부러 쉽게 만든 난이도라 도전의 증거가 되지 않습니다.
    //
    // 잠겨 있을 때 흐린 카드로 자리를 잡아두지 않습니다. 그러면 히든이 아니라
    // "아직 못 여는 것"이 되어, 있는 줄 알고 조건을 찾게 됩니다.
    //
    // **이 조건은 안 낮춥니다** (2026-09-06 사용자 확정). 난이도 15 가 봇으로는 30분에
    // 한참 못 미치지만, 봇 수치로 "사람도 못 깬다"를 결론지을 수 없습니다.
    // 15 를 깨는 것이 하드모드의 입장권입니다.
    //
    // **개발자 모드에서는 조건 없이 켤 수 있습니다** (2026-09-06). 하드모드를 만드는
    // 동안 화면을 봐야 하는데, 15 를 먼저 깨고 오라는 것은 `?unlock` 을 둔 이유와
    // 같은 문제입니다. 그때는 라벨에 그 사실을 적습니다. 정상 해금과 구분이 안 되면
    // 개발자 모드를 켜 둔 것을 잊고 "왜 열려 있지"가 됩니다
    const hardEarned = clearedAllFrom(save, 0);
    const hardRow = hardEarned || save.devMode;
    if (hardRow || save.devMode) {
      const rows: Node[] = [];
      if (hardRow) {
        rows.push(
          toggle(
            hardEarned ? '하드모드' : '하드모드 (개발자)',
            save.hardMode ? '켬' : '끔',
            actions.toggleHardMode,
          ),
        );
      }
      // 개발자 전용. 적을 하나 고칠 때마다 50마리를 잡아 와야 수치 칸을 볼 수 있으면
      // 그 화면은 사실상 확인할 수 없는 화면입니다. 저장의 도감 기록은 안 건드립니다
      if (save.devMode) {
        // 디버그 맵. 켜고 끄는 값이 아니라 들어가는 문이라 값 자리에 `입장` 을 적습니다
        rows.push(toggle('디버그 맵 (개발자)', '입장', actions.enterDebugMap));
        rows.push(toggle('도감 전체 보기 (개발자)', save.devBestiary ? '켬' : '끔', actions.toggleDevBestiary));
        // 난이도 전체 해금. `?unlock` 과 같은 일을 하지만 주소를 고치지 않아도 됩니다.
        //
        // **토글이 아닙니다.** 한 방향으로만 가고 되돌리려면 데이터 초기화뿐입니다.
        // 그래서 켬/끔 대신 **지금 열린 칸을 그대로 보여줍니다.** 다 열린 뒤에 또
        // 눌러도 아무 일이 없고, 그 사실이 값에 드러납니다
        rows.push(
          toggle(
            '난이도 전체 해금 (개발자)',
            `일반 ${save.maxDifficulty} · 하드 ${save.maxHardDifficulty}`,
            actions.unlockAllDifficulties,
          ),
        );
      }
      body.push(h('div', { class: 'rowlist' }, rows));
    }

    body.push(h('div', { class: 'settings-sep' }));

    body.push(
      h(
        'div',
        { class: 'rowlist' },
        items.map((item) => {
          const on = armed === item.id;
          const el = card({
            title: on ? `${item.title}  [한 번 더 누르면 지웁니다]` : item.title,
            desc: item.desc,
            onClick: () => press(item),
          });
          el.classList.add('danger');
          if (on) el.classList.add('armed');
          return el;
        }),
      ),
    );

    overlayEl().append(screen('설정', '', body, 'narrow', actions.back));

    unbindKeys = bindKeys((code) => {
      if (code !== 'Escape' && code !== 'Backspace') return;
      // 겨눈 상태에서 Esc 는 먼저 그것을 풀어줍니다
      if (armed) {
        armed = null;
        render();
        return;
      }
      actions.back();
    });
  };

  render();
  return () => unbindKeys();
}
