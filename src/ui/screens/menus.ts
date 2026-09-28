import { getSkillDef } from '../../skills/registry';
import { achieveProgress } from '../../meta/achievements';
import { LATEST_PATCH } from '../../data/patchnotes';
import type { SaveData } from '../../meta/save';
import { challengeOpen } from './challenge';
import { bindKeys, card, clearOverlay, formatTime, gearButton, h, helpButton, overlayEl, patchButton, screen } from './dom';

export interface MainActions {
  start: () => void;
  shop: () => void;
  bestiary: () => void;
  records: () => void;
  achievements: () => void;
  challenge: () => void;
  settings: () => void;
  patchNotes: () => void;
}

export function showMainMenu(save: SaveData, actions: MainActions): () => void {
  clearOverlay();

  // 카드에는 제목만 답니다. 부제는 전부 제목을 풀어 쓴 것뿐이라 읽을 이유가 없었습니다.
  // 업적의 진행도만 남습니다. 그것은 설명이 아니라 지금 값이라서입니다
  //
  // 도전모드는 난이도 1 을 깨야 자리가 생기고, 생기면 **2번**에 섭니다 (2026-09-28 사용자 지시).
  // 그래서 번호는 고정값이 아니라 보이는 순서대로 매깁니다. 카드 배지와 숫자키가 같은 목록을
  // 보므로 둘이 어긋날 수 없습니다
  const entries: { title: string; desc?: string; onClick: () => void }[] = [
    { title: '게임 시작', onClick: actions.start },
    ...(challengeOpen(save) ? [{ title: '도전모드', onClick: actions.challenge }] : []),
    { title: '상점', onClick: actions.shop },
    // 적과 스킬 두 탭이라 "적 도감"이 아니라 "도감"입니다 (2026-09-13)
    { title: '도감', onClick: actions.bestiary },
    { title: '기록', onClick: actions.records },
    { title: '업적', desc: `${achieveProgress(save).done} / ${achieveProgress(save).total} 달성`, onClick: actions.achievements },
  ];
  const items = h(
    'div',
    { class: 'rowlist' },
    entries.map((e, i) => card({ key: String(i + 1), ...e })),
  );

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
  // 패치로그는 톱니 왼쪽에 나란히 섭니다. 둘 다 "게임 바깥"이라 카드 목록에는 안 넣습니다
  el.querySelector('.screen-head')?.append(
    patchButton(save.patchSeen !== LATEST_PATCH, () => actions.patchNotes()),
    gearButton(() => actions.settings()),
  );
  overlayEl().append(el);

  return bindKeys((code) => {
    if (code === 'Enter' || code === 'Space') actions.start();
    const n = code.startsWith('Digit') ? Number(code.slice(5)) : 0;
    if (n >= 1 && n <= entries.length) entries[n - 1].onClick();
    // 설정은 톱니라 번호 배지가 없습니다. 숫자는 카드가 쓰므로 0 에 둡니다
    if (code === 'Digit0') actions.settings();
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
