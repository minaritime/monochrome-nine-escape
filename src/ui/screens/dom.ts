/** DOM 화면 공통 유틸. 게임 화면은 캔버스, 메뉴는 DOM 으로 그립니다 */

export function overlayEl(): HTMLElement {
  const el = document.getElementById('overlay');
  if (!el) throw new Error('#overlay 를 찾을 수 없습니다');
  return el;
}

/**
 * 지금 열려 있는 펼침판을 닫는 함수들 (`helpWrap`).
 *
 * **화면을 바꿀 때 같이 닫아야 합니다.** 펼침판은 열려 있는 동안 `document` 에
 * 바깥 클릭 감시를 다는데, 그것은 클릭으로만 걷힙니다. 그런데 이 게임은 메뉴를
 * **숫자키로도 넘길 수 있어서** 클릭 한 번 없이 화면이 바뀝니다. 그러면 이미 화면에서
 * 떨어져 나간 요소를 붙들고 있는 감시가 그대로 남습니다.
 */
const openPopovers = new Set<() => void>();

export function clearOverlay(): void {
  // 복사해서 돌립니다. close 가 이 집합을 건드립니다
  for (const close of [...openPopovers]) close();
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
  /**
   * 하드모드를 켠 뒤에만 살 수 있는 항목. 제목 옆에 `Hard` 뱃지가 붙습니다.
   *
   * **뱃지는 이 한 곳에서만 그립니다.** 화면마다 직접 붙이면 하드 항목을 늘릴 때
   * 그 자리를 매번 찾아다녀야 합니다.
   */
  hard?: boolean;
  /** 우측 끝에 붙일 요소 (도감의 생김새 등) */
  right?: Node;
  onClick?: () => void;
}

export function card(opts: CardOptions): HTMLElement {
  const children: Node[] = [];
  if (opts.key) children.push(h('div', { class: 'key' }, [opts.key]));

  const title = h('div', { class: 'title' }, [opts.title]);
  if (opts.hard) title.append(h('span', { class: 'hard-badge' }, ['Hard']));
  const body = h('div', { class: 'body' }, [title]);
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
  return h('button', { class: 'head-btn gear-btn', title: '설정 (6)', 'aria-label': '설정', onclick: onClick }, [
    h('span', { class: 'gear' }, ['⚙']),
  ]);
}

/**
 * 우측 상단 패치로그 버튼 (톱니바퀴 왼쪽).
 *
 * 톱니와 같은 무게의 "게임 바깥" 항목이라 카드 목록에는 안 넣습니다.
 *
 * `unread` 면 점이 하나 붙습니다. **새 저장에도 붙습니다.** 처음 켠 사람이
 * 그 버튼이 무엇인지 알 길이 아이콘 하나뿐이라, 한 번은 눈에 띄어야 합니다.
 */
export function patchButton(unread: boolean, onClick: () => void): HTMLElement {
  const kids: Node[] = [h('span', { class: 'gear' }, ['🗒'])];
  if (unread) kids.push(h('span', { class: 'dot' }, []));
  // **`gear-btn` 을 같이 달면 안 됩니다.** 그 클래스로 버튼을 찾는 곳이 있는데
  // 패치 버튼이 톱니보다 앞에 서 있어서, `.gear-btn` 을 찾으면 이쪽이 먼저 잡힙니다.
  // 실제로 부팅 점검의 "톱니를 눌러본다"가 조용히 패치로그를 열고 있었습니다
  return h(
    'button',
    { class: 'head-btn patch-btn', title: '패치로그', 'aria-label': '패치로그', onclick: onClick },
    kids,
  );
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

  return helpWrap(
    'help-wrap',
    h('button', { class: 'help-btn', type: 'button', 'aria-label': '조작법' }, ['조작법']),
    h('div', { class: 'help-pop', role: 'tooltip' }, [
      row('이동', '← ↑ ↓ →'),
      row('유틸 스킬', 'Q'),
      row('일시정지', 'Esc'),
      // **디버그 키는 여기 적지 않습니다.** 잠금까지 걸어놓고 메인 화면에서
      // "디버그 F1" 이라고 알려주면 잠근 의미가 없습니다
    ]),
  );
}

/**
 * 펼침판 하나를 감싸 **누르면 열리게** 만듭니다.
 *
 * hover 만으로 열면 폰에서는 영영 안 열립니다. 마우스가 없는 기기에는 hover 라는
 * 것이 아예 없기 때문입니다. PC 의 hover 는 CSS 에 그대로 두고, 여기서는 클릭으로
 * 여는 길을 하나 더 냅니다.
 *
 * **밖을 누르면 닫힙니다.** 안 닫으면 상점처럼 화면이 안 바뀌는 자리에서 펼침판이
 * 카드 위에 계속 떠 있게 됩니다.
 */
function helpWrap(cls: string, btn: HTMLElement, pop: HTMLElement): HTMLElement {
  const wrap = h('div', { class: cls }, [btn, pop]);
  /** 열려 있는 동안에만 사는 바깥 클릭 감시. 닫을 때 반드시 같이 걷습니다 */
  let outside: (() => void) | null = null;

  const close = () => {
    wrap.classList.remove('open');
    if (outside) document.removeEventListener('click', outside);
    outside = null;
    openPopovers.delete(close);
  };

  btn.addEventListener('click', (e) => {
    // 이 클릭이 문서까지 올라가면 방금 단 감시가 그 자리에서 닫아버립니다
    e.stopPropagation();
    if (wrap.classList.contains('open')) {
      close();
      return;
    }
    wrap.classList.add('open');
    // 열어둔 채로 다른 것을 누르면 닫습니다. 안 닫으면 화면이 안 바뀌는 상점 같은
    // 자리에서 펼침판이 카드 위에 계속 떠 있습니다
    outside = close;
    document.addEventListener('click', outside);
    // 클릭 없이 화면이 바뀌는 길(숫자키)에서도 걷히도록 `clearOverlay` 에 맡깁니다
    openPopovers.add(close);
  });

  return wrap;
}

/**
 * 작은 물음표 버튼. 마우스를 올리거나 초점이 닿으면 여러 줄 설명이 펼쳐집니다.
 *
 * `helpButton` 과 같은 장치인데 이쪽은 **줄글**을 답니다. 화면 오른쪽 끝에 붙는
 * 경우가 많아서 펼침판이 기본으로 왼쪽으로 열립니다.
 */
export function helpDot(lines: string[], wrapClass = ''): HTMLElement {
  return helpWrap(
    `help-wrap to-left ${wrapClass}`.trim(),
    h('button', { class: 'help-btn dot', type: 'button', 'aria-label': '설명' }, ['?']),
    h(
      'div',
      { class: 'help-pop wide', role: 'tooltip' },
      lines.map((t) => h('div', { class: 'help-line' }, [t])),
    ),
  );
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
