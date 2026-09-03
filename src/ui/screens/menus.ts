import { getSkillDef } from '../../skills/registry';
import { achieveProgress } from '../../meta/achievements';
import type { SaveData } from '../../meta/save';
import { bindKeys, card, clearOverlay, formatTime, gearButton, h, helpButton, overlayEl, screen } from './dom';

export interface MainActions {
  start: () => void;
  shop: () => void;
  bestiary: () => void;
  records: () => void;
  achievements: () => void;
  settings: () => void;
}

export function showMainMenu(save: SaveData, actions: MainActions): () => void {
  clearOverlay();

  // 카드에는 제목만 답니다. 부제는 전부 제목을 풀어 쓴 것뿐이라 읽을 이유가 없었습니다.
  // 업적의 진행도만 남습니다. 그것은 설명이 아니라 지금 값이라서입니다
  const items = h('div', { class: 'rowlist' }, [
    card({ key: '1', title: '게임 시작', onClick: actions.start }),
    card({ key: '2', title: '상점', onClick: actions.shop }),
    card({ key: '3', title: '적 도감', onClick: actions.bestiary }),
    card({ key: '4', title: '기록', onClick: actions.records }),
    card({ key: '5', title: '업적', desc: `${achieveProgress(save).done} / ${achieveProgress(save).total} 달성`, onClick: actions.achievements }),
  ]);

  // 조작 안내는 좌측 상단 버튼 안으로 접었습니다. 톱니바퀴와 같은 무게의 "게임 바깥" 항목이라
  // 카드 목록에도 넣지 않고, 늘 펼쳐두지도 않습니다
  const top = h('div', { class: 'topbar' }, [
    helpButton(),
    h('div', { class: 'coins' }, [`보유 코인 ${save.coins}`]),
  ]);

  const el = screen('Monochrome Nine Escape', '', [top, items], 'narrow');
  // 설정은 카드 목록이 아니라 머리말 우측에 톱니바퀴로 답니다
  // **함수를 그대로 넘기면 안 됩니다.** onclick 은 클릭 이벤트를 첫 인자로 넣어
  // 부르는데, `goSettings` 의 첫 인자는 "방금 무엇을 했는지" 적는 알림 줄입니다.
  // 그대로 넘기면 그 자리에 MouseEvent 가 들어가 `[object MouseEvent]` 가 찍혔습니다
  el.querySelector('.screen-head')?.append(gearButton(() => actions.settings()));
  overlayEl().append(el);

  return bindKeys((code) => {
    if (code === 'Digit1' || code === 'Enter' || code === 'Space') actions.start();
    if (code === 'Digit2') actions.shop();
    if (code === 'Digit3') actions.bestiary();
    if (code === 'Digit4') actions.records();
    if (code === 'Digit5') actions.achievements();
    if (code === 'Digit6') actions.settings();
  });
}

export function showRecords(save: SaveData, onBack: () => void): () => void {
  clearOverlay();
  const r = save.records;

  const lines = h('div', {}, [
    statLine('최고 생존 시간', r.bestTime > 0 ? formatTime(r.bestTime) : '기록 없음'),
    statLine('최다 처치', String(r.bestKills)),
    statLine('최고 레벨', String(r.bestLevel)),
    statLine('총 도전 횟수', String(r.totalRuns)),
    statLine('누적 처치', String(r.totalKills)),
  ]);

  const build =
    r.bestBuild.length > 0
      ? r.bestBuild.map((id) => getSkillDef(id).name).join(' · ')
      : '없음';

  const body = [lines, h('div', { class: 'hint' }, [`최고 기록 당시 빌드: ${build}`])];

  overlayEl().append(screen('기록', '', body, 'narrow', onBack));
  return bindKeys((code) => {
    if (code === 'Escape' || code === 'Backspace') onBack();
  });
}

function statLine(label: string, value: string): HTMLElement {
  return h('div', { class: 'stat-line' }, [h('span', {}, [label]), h('span', {}, [value])]);
}
