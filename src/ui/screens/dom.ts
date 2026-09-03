/** DOM 화면 공통 유틸. 게임 화면은 캔버스, 메뉴는 DOM 으로 그립니다 */

export function overlayEl(): HTMLElement {
  const el = document.getElementById('overlay');
  if (!el) throw new Error('#overlay 를 찾을 수 없습니다');
  return el;
}

export function clearOverlay(): void {
  overlayEl().replaceChildren();
}

type Props = Record<string, string | number | boolean | ((e: Event) => void)>;

export function h(tag: string, props: Props = {}, children: (Node | string)[] = []): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'class') {
      el.className = String(v);
    } else if (k === 'disabled') {
      if (v) el.setAttribute('disabled', '');
    } else {
      el.setAttribute(k, String(v));
    }
  }
  for (const c of children) el.append(c);
  return el;
}

export interface CardOptions {
  key?: string;
  title: string;
  desc?: string;
  price?: string;
  disabled?: boolean;
  locked?: boolean;
  /**
   * 누를 수 없는 "정보 카드" (도감 항목 등).
   * disabled 만 쓰면 상점의 "못 사는 항목"과 같은 흐림 처리가 걸려서
   * 읽으라고 만든 화면 전체가 흐려집니다.
   */
  info?: boolean;
  /** 우측 끝에 붙일 요소 (도감의 생김새 등) */
  right?: Node;
  onClick?: () => void;
}

export function card(opts: CardOptions): HTMLElement {
  const children: Node[] = [];
  if (opts.key) children.push(h('div', { class: 'key' }, [opts.key]));

  const body = h('div', { class: 'body' }, [h('div', { class: 'title' }, [opts.title])]);
  if (opts.desc) body.append(h('div', { class: 'desc' }, [opts.desc]));
  children.push(body);

  if (opts.price) children.push(h('div', { class: 'price' }, [opts.price]));
  if (opts.right) children.push(opts.right);

  const btn = h(
    'button',
    {
      class: `card${opts.info ? ' info' : ''}${opts.locked ? ' locked' : ''}`,
      disabled: !!opts.disabled,
      onclick: () => opts.onClick?.(),
    },
    children,
  );
  return btn;
}

/**
 * 우측 상단 나가기 버튼.
 * 화살표를 누르든 Esc 를 누르든 같은 동작이라는 걸 한눈에 보이게 합니다.
 */
export function backButton(onBack: () => void): HTMLElement {
  return h('button', { class: 'back-btn', title: '돌아가기 (Esc)', 'aria-label': '돌아가기', onclick: onBack }, [
    h('span', { class: 'arrow' }, ['←']),
    h('span', { class: 'esc' }, ['ESC']),
  ]);
}

/**
 * 우측 상단 설정 버튼 (톱니바퀴).
 *
 * 메인 화면의 카드 목록에는 넣지 않습니다. 목록은 "이 게임에서 할 것"이 늘어서는
 * 자리인데, 설정은 게임의 내용이 아니라 그 바깥이라 같은 무게로 보이면 안 됩니다.
 */
export function gearButton(onClick: () => void): HTMLElement {
  return h('button', { class: 'gear-btn', title: '설정 (6)', 'aria-label': '설정', onclick: onClick }, [
    h('span', { class: 'gear' }, ['⚙']),
  ]);
}

/**
 * 좌측 상단 조작법 버튼.
 *
 * 예전에는 메인 화면 아래에 조작 안내 두 줄이 늘 펼쳐져 있었습니다. 한 번 읽으면
 * 다시 볼 일이 없는 글이 화면 절반을 차지하고 있었으므로, 필요할 때만 꺼내 보도록
 * 접었습니다. 마우스를 올리거나 키보드 초점이 닿으면 펴집니다.
 *
 * **키 목록만 둡니다.** 여기에 규칙 설명을 적기 시작하면 접어둔 의미가 없어집니다.
 */
export function helpButton(): HTMLElement {
  const row = (label: string, keys: string) =>
    h('div', { class: 'help-row' }, [h('span', {}, [label]), h('b', {}, [keys])]);

  return h('div', { class: 'help-wrap' }, [
    h('button', { class: 'help-btn', type: 'button', 'aria-label': '조작법' }, ['조작법']),
    h('div', { class: 'help-pop', role: 'tooltip' }, [
      row('이동', '← ↑ ↓ →'),
      row('유틸 스킬', 'Q'),
      row('일시정지', 'Esc'),
      // **디버그 키는 여기 적지 않습니다.** 잠금까지 걸어놓고 메인 화면에서
      // "디버그 F1" 이라고 알려주면 잠근 의미가 없습니다
    ]),
  ]);
}

/**
 * 작은 물음표 버튼. 마우스를 올리거나 초점이 닿으면 여러 줄 설명이 펼쳐집니다.
 *
 * `helpButton` 과 같은 장치인데 이쪽은 **줄글**을 답니다. 화면 오른쪽 끝에 붙는
 * 경우가 많아서 펼침판이 기본으로 왼쪽으로 열립니다.
 */
export function helpDot(lines: string[], wrapClass = ''): HTMLElement {
  return h('div', { class: `help-wrap to-left ${wrapClass}`.trim() }, [
    h('button', { class: 'help-btn dot', type: 'button', 'aria-label': '설명' }, ['?']),
    h(
      'div',
      { class: 'help-pop wide', role: 'tooltip' },
      lines.map((t) => h('div', { class: 'help-line' }, [t])),
    ),
  ]);
}

export function screen(title: string, subtitle: string, body: Node[], extraClass = '', onBack?: () => void): HTMLElement {
  const head: Node[] = [h('h1', {}, [title])];
  if (subtitle) head.push(h('p', { class: 'sub' }, [subtitle]));

  const headEl = h('div', { class: 'screen-head' }, head);
  if (onBack) headEl.append(backButton(onBack));

  return h('div', { class: `screen ${extraClass}`.trim() }, [headEl, h('div', { class: 'screen-body' }, body)]);
}

/** 화면이 열려 있는 동안만 동작하는 키 처리기 */
export function bindKeys(handler: (code: string, e: KeyboardEvent) => void): () => void {
  const listener = (e: KeyboardEvent) => handler(e.code, e);
  window.addEventListener('keydown', listener);
  return () => window.removeEventListener('keydown', listener);
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}분 ${String(s).padStart(2, '0')}초`;
}
