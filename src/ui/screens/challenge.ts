import { CHALLENGE_IMPLEMENTED, CHALLENGE_STAGES, type ChallengeStageDef } from '../../data/balance';
import type { SaveData } from '../../meta/save';
import { bindKeys, card, clearOverlay, formatTime, h, overlayEl, screen } from './dom';

/**
 * 도전모드 스테이지 목록 (2026-09-16).
 *
 * **아직 개발자 모드에서만 열립니다** (설정 화면의 개발자 구역). 정식 개방 조건은
 * 난이도 1 클리어입니다 (`docs/기획/콘텐츠.md`).
 *
 * 지금은 규칙을 만든 스테이지가 하나도 없어서 전부 못 누르는 정보 카드입니다.
 * **`disabled` 가 아니라 `info` 를 씁니다.** `disabled` 는 상점의 "못 사는 항목"
 * 흐림이라, 읽으라고 만든 화면 전체가 희미해집니다 (도감이 실제로 그랬습니다).
 */
export function showChallengeList(save: SaveData, onBack: () => void): () => void {
  clearOverlay();

  const rows = CHALLENGE_STAGES.map((stage, i) => stageCard(save, stage, i + 1));

  const note = h('div', { class: 'hint' }, [
    '개발자 모드 전용입니다. 정식 개방은 난이도 1 클리어입니다',
    h('div', {}, ['상점 강화와 난이도 배율이 안 걸리고, 판 중에는 코인이 안 떨어집니다']),
    h('div', {}, ['클리어 코인은 첫 클리어에만 나옵니다 (반복 0)']),
  ]);

  const body = [note, h('div', { class: 'rowlist' }, rows)];
  overlayEl().append(screen('도전모드', '', body, 'narrow', onBack));

  return bindKeys((code) => {
    if (code === 'Escape' || code === 'Backspace') onBack();
  });
}

/**
 * 한 칸의 상태는 셋입니다.
 *
 * **`ready` 와 "구현됨"은 다른 값입니다.** 앞은 "1차 범위인가"고 뒤는 "지금 돌아가는가"라,
 * 경기장 공사를 기다리는 둘과 아직 안 만든 것을 갈라서 보여줘야 합니다
 */
function stageCard(save: SaveData, stage: ChallengeStageDef, no: number): HTMLElement {
  const clearedRules = save.challenge.cleared[stage.id];
  const done = typeof clearedRules === 'number';
  const playable = CHALLENGE_IMPLEMENTED.includes(stage.id);

  const state = !stage.ready ? '보류' : playable ? (done ? '클리어' : '입장') : '준비 중';
  const why = !stage.ready
    ? '경기장 크기를 바꾸는 스테이지라 그 공사가 끝나야 열립니다'
    : playable
      ? ''
      : '규칙을 아직 안 만들었습니다';

  const desc = why ? `${stage.summary} · ${why}` : stage.summary;

  return card({
    title: `${no}. ${stage.name}`,
    desc,
    info: true,
    right: h('div', { class: 'toggle-value' }, [`[ ${state} · ${formatTime(stage.clearTime)} ]`]),
  });
}
