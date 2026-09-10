import { visiblePatchNotes, type PatchNote } from '../../data/patchnotes';
import type { SaveData } from '../../meta/save';
import { bindKeys, clearOverlay, h, overlayEl, screen } from './dom';

/**
 * 패치로그 화면.
 *
 * **최신 하나만 펼치고 나머지는 접습니다.** 버전이 쌓이면 스크롤이 길어지는데,
 * 여기 들어오는 이유는 대개 "이번에 뭐가 바뀌었나"라서 옛 버전이 위를 차지하면 안 됩니다.
 *
 * **하드 항목은 하드모드를 연 사람에게만 보입니다** (`PatchItem.hardOnly`).
 * 하드모드는 히든 요소라, 안 연 사람에게 하드 항목을 보여주면 존재를 알리게 됩니다.
 * 잠긴 하드모드 스위치를 흐린 카드로 잡아두지 않는 것과 같은 이유입니다.
 */
export function showPatchNotes(save: SaveData, onBack: () => void): () => void {
  clearOverlay();

  const notes = visiblePatchNotes(save.hardUnlocked);
  // 펼침 상태는 화면이 살아 있는 동안만 유지합니다. 저장에 남길 값이 아닙니다
  const open = new Set<string>(notes.length > 0 ? [notes[0].version] : []);

  const body = h('div', { class: 'patch-list' }, []);
  const draw = () => {
    body.replaceChildren(...notes.map((n) => versionBlock(n, open, draw)));
  };
  draw();

  overlayEl().append(screen('패치로그', '', [body], 'narrow patch-screen', onBack));
  return bindKeys((code) => {
    if (code === 'Escape') onBack();
  });
}

function versionBlock(note: PatchNote, open: Set<string>, redraw: () => void): HTMLElement {
  const expanded = open.has(note.version);

  const head = h(
    'button',
    {
      class: `patch-head${expanded ? ' open' : ''}`,
      onclick: () => {
        if (expanded) open.delete(note.version);
        else open.add(note.version);
        redraw();
      },
    },
    [
      h('span', { class: 'patch-ver' }, [note.version]),
      h('span', { class: 'patch-date' }, [note.date]),
      h('span', { class: 'patch-caret' }, [expanded ? '▾' : '▸']),
    ],
  );

  const kids: Node[] = [head];
  if (expanded) {
    kids.push(
      h(
        'div',
        { class: 'patch-body' },
        note.groups.map((g) =>
          h('div', { class: 'patch-group' }, [
            h('div', { class: 'patch-group-title' }, [`* ${g.title}`]),
            ...g.items.map((it, i) =>
              h('div', { class: 'patch-item' }, [
                h('div', { class: 'patch-item-title' }, [`${i + 1}. ${it.title}`]),
                ...it.lines.map((line) => h('div', { class: 'patch-line' }, [`- ${line}`])),
              ]),
            ),
          ]),
        ),
      ),
    );
  }

  return h('div', { class: 'patch-note' }, kids);
}
