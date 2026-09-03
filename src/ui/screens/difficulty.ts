import { DIFFICULTY } from '../../data/balance';
import { difficultyEffects, difficultyStepLabel } from '../../meta/difficulty';
import type { SaveData } from '../../meta/save';
import { bindKeys, clearOverlay, formatTime, h, overlayEl, screen } from './dom';

/**
 * 난이도 선택 화면.
 *
 * 목록이 아니라 **한 번에 하나씩 보는 다이얼**입니다. -1 부터 15 까지 열일곱 개를
 * 카드로 늘어놓으면 화면을 넘어가고, 무엇보다 후반 난이도는 효과가 열 줄이 넘어서
 * 카드 한 줄에 담기지 않습니다. 가운데 숫자를 좌우로 돌리고 그 아래에 효과를 전부 폅니다.
 *
 * 화면 자체는 처음부터 열려 있습니다. -1 과 0 은 언제나 고를 수 있고,
 * 1 부터는 바로 아래 난이도로 요구 시간을 버텨야 차례로 열립니다.
 */
export function showDifficultySelect(
  save: SaveData,
  onStart: (difficulty: number) => void,
  onBack: () => void,
  initial = 0,
): () => void {
  const max = Math.min(save.maxDifficulty, DIFFICULTY.max);
  // 아직 안 열린 다음 한 칸까지는 볼 수 있습니다. 무엇이 더 붙는지 알아야 버틸 이유가 생깁니다
  const highest = Math.min(max + 1, DIFFICULTY.max);
  let lv = clamp(initial, DIFFICULTY.min, highest);

  const move = (delta: number) => {
    const next = clamp(lv + delta, DIFFICULTY.min, highest);
    if (next === lv) return;
    lv = next;
    render();
  };

  const start = () => {
    if (lv > max) return; // 잠긴 난이도는 시작할 수 없습니다
    onStart(lv);
  };

  const render = () => {
    clearOverlay();

    const locked = lv > max;

    // 다이얼과 시작 버튼은 고정, 효과 목록만 안에서 구릅니다.
    // 난이도마다 효과 줄 수가 3 줄에서 20 줄까지 달라지는데, 그게 바깥 상자 높이를 바꾸면
    // 가운데 정렬 때문에 다이얼과 버튼이 매번 위아래로 튑니다. 누르려던 버튼이 도망갑니다
    const top = h('div', { class: 'diff-top' }, [
      dial(lv, DIFFICULTY.min, highest, move),
      h('div', { class: 'diff-sub' }, [subtitleOf(lv, save, locked)]),
      startButton(locked, start),
    ]);

    // 누적 목록만 구르고, `새로 붙은 것` 은 맨 아래에 고정입니다.
    // 스크롤 안에 있으면 20 줄짜리 난이도에서는 끝까지 내려야 보이는데, 그건 지금 이
    // 난이도를 고르는 이유 자체라 항상 눈에 있어야 합니다
    const scroll = h('div', { class: 'diff-scroll' }, [effectList(lv)]);

    const parts: Node[] = [top, scroll];
    const fresh = newBox(lv);
    if (fresh) parts.push(fresh);

    overlayEl().append(screen('난이도 선택', '', parts, 'diff-screen', onBack));
  };

  render();

  return bindKeys((code) => {
    if (code === 'Escape' || code === 'Backspace') {
      onBack();
      return;
    }
    if (code === 'ArrowLeft') move(-1);
    else if (code === 'ArrowRight') move(1);
    else if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space') start();
  });
}

/** 가운데 숫자와 좌우 화살표 */
function dial(lv: number, min: number, max: number, move: (delta: number) => void): HTMLElement {
  const arrow = (delta: number, glyph: string, label: string) =>
    h(
      'button',
      {
        class: 'diff-arrow',
        'aria-label': label,
        disabled: delta < 0 ? lv <= min : lv >= max,
        onclick: () => move(delta),
      },
      [glyph],
    );

  return h('div', { class: 'diff-dial' }, [
    arrow(-1, '◀', '더 쉽게'),
    h('div', { class: 'diff-value' }, [
      h('div', { class: `diff-num${lv < 0 ? ' easy' : ''}` }, [String(lv)]),
      h('div', { class: 'diff-name' }, [nameOf(lv)]),
    ]),
    arrow(1, '▶', '더 어렵게'),
  ]);
}

function startButton(locked: boolean, onClick: () => void): HTMLElement {
  // 시작 버튼 자리에 `잠김` 한 마디만 둡니다. 조건을 여기 길게 적으면 버튼 자리가
  // 문장으로 바뀌면서 다이얼 아래 짜임이 난이도마다 달라집니다
  if (locked) return h('div', { class: 'diff-locked' }, ['잠김']);
  // 몇 번 난이도인지는 바로 위 다이얼이 큼직하게 말하고 있습니다
  return h('button', { class: 'diff-start', onclick: onClick }, ['시작']);
}

/** 그 난이도에 걸리는 효과를 전부 한 줄씩 폅니다 */
function effectList(lv: number): HTMLElement {
  const effects = difficultyEffects(lv);
  const rows: Node[] = [h('div', { class: 'diff-list-head' }, ['적용되는 효과'])];

  if (effects.length === 0) {
    rows.push(h('div', { class: 'diff-none' }, ['가장 정상적이고 노말한 일반적인 난이도']));
  } else {
    for (const e of effects) {
      rows.push(
        h('div', { class: `diff-row${e.device ? ' device' : ''}` }, [
          h('span', { class: 'diff-row-label' }, [e.label]),
          h('span', { class: `diff-row-value ${e.bad ? 'bad' : 'good'}` }, [e.value]),
        ]),
      );
    }
  }

  return h('div', { class: 'diff-list' }, rows);
}

/**
 * 이 단계에서 새로 붙은 것. **화면 맨 아래에 고정입니다.**
 * 누적 목록만 보면 무엇이 늘었는지 알 수 없는데, 그게 이 난이도를 고르는 이유입니다.
 * 스크롤 안에 두면 후반 난이도에서는 끝까지 내려야 나옵니다.
 */
function newBox(lv: number): HTMLElement | null {
  if (lv <= 0) return null;
  return h('div', { class: 'diff-new-box' }, [
    h('div', { class: 'diff-list-head' }, [`난이도 ${lv} 에서 새로 붙은 것`]),
    h('div', { class: 'diff-new' }, [difficultyStepLabel(lv)]),
  ]);
}

function nameOf(lv: number): string {
  if (lv < 0) return '입문';
  if (lv === 0) return '기본';
  return `난이도 ${lv}`;
}

/** 그 난이도의 내 기록. 해금 조건은 안 적습니다 (`적용되는 효과` 목록이 3단계부터 알려줍니다) */
function subtitleOf(lv: number, save: SaveData, locked: boolean): string {
  if (locked) return '';
  const best = save.records.bestTimeByDifficulty[String(lv)] ?? 0;
  return best > 0 ? `최고 ${formatTime(best)}` : '기록 없음';
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.floor(v)));
}
