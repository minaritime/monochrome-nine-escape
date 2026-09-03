/**
 * 브라우저 없이 부팅 경로를 그대로 돌려보는 점검 스크립트입니다.
 * 최소한의 DOM 을 흉내 내어 main.ts 를 그대로 실행하고,
 * 메인 화면 → 게임 시작 → 레벨업 선택 → 일시정지 → 상점 까지 키 입력으로 밟습니다.
 *
 *   npx esbuild scripts/boot.ts --bundle --format=esm --platform=node --loader:.css=text --outfile=.boot.mjs
 *   node .boot.mjs
 */

// main.ts 는 불러오는 순간 document 를 만지므로 아래에서 동적으로 불러옵니다.
// 이 둘은 모듈을 읽는 것만으로는 DOM 을 건드리지 않아 정적으로 가져와도 안전합니다
import { DEBUG } from '../src/data/balance';
import { emptySave } from '../src/meta/save';

interface StubElement {
  tagName: string;
  id: string;
  className: string;
  children: StubElement[];
  text: string;
  attrs: Record<string, string>;
  listeners: Record<string, ((e: unknown) => void)[]>;
  style: Record<string, string> & { setProperty(k: string, v: string): void };
  classList: { add(...names: string[]): void };
  width: number;
  height: number;
  /** 업적 알림은 append 가 아니라 textContent 로 글자를 넣습니다 */
  textContent: string;
  querySelector(selector: string): StubElement | null;
  append(...nodes: (StubElement | string)[]): void;
  replaceChildren(...nodes: StubElement[]): void;
  setAttribute(k: string, v: string): void;
  addEventListener(type: string, fn: (e: unknown) => void): void;
  removeEventListener(type: string, fn: (e: unknown) => void): void;
  getContext(kind: string): unknown;
  click(): void;
}

const ctx2d = new Proxy(
  {},
  {
    get: (_t, prop) => {
      if (prop === 'canvas') return undefined;
      return () => undefined;
    },
    set: () => true,
  },
);

function createElement(tagName: string): StubElement {
  const el = {
    tagName,
    id: '',
    className: '',
    children: [],
    text: '',
    textContent: '',
    attrs: {},
    listeners: {},
    // CSS 변수를 넣는 코드(업적 알림)가 있어서 setProperty 까지 흉내 냅니다
    style: Object.assign({} as Record<string, string>, {
      setProperty(k: string, v: string) {
        (el.style as Record<string, string>)[k] = v;
      },
    }),
    classList: {
      add(...names: string[]) {
        el.className = [el.className, ...names].filter(Boolean).join(' ');
      },
    },
    width: 0,
    height: 0,
    querySelector(selector) {
      const want = selector.replace(/^\./, '');
      const walk = (node: StubElement): StubElement | null => {
        for (const c of node.children) {
          if (c.className.split(' ').includes(want)) return c;
          const found = walk(c);
          if (found) return found;
        }
        return null;
      };
      return walk(el);
    },
    append(...nodes) {
      for (const n of nodes) {
        if (typeof n === 'string') el.text += n;
        else el.children.push(n);
      }
    },
    replaceChildren(...nodes) {
      el.children = nodes;
      el.text = '';
    },
    setAttribute(k, v) {
      el.attrs[k] = v;
    },
    addEventListener(type, fn) {
      (el.listeners[type] ||= []).push(fn);
    },
    removeEventListener(type, fn) {
      el.listeners[type] = (el.listeners[type] ?? []).filter((f) => f !== fn);
    },
    getContext: () => ctx2d,
    click() {
      for (const fn of el.listeners['click'] ?? []) fn({});
    },
  } as StubElement;

  // textContent 는 넣으면 안의 것을 갈아치웁니다. 그냥 필드로 두면
  // 업적 알림처럼 textContent 로만 글자를 넣는 화면이 점검에서 빈 줄로 보입니다
  Object.defineProperty(el, 'textContent', {
    get: () => el.text,
    set: (v: string) => {
      el.text = String(v);
      el.children = [];
    },
  });
  return el;
}

const gameCanvas = createElement('canvas');
const overlay = createElement('div');
// 업적 알림은 오버레이 바깥(body 직속)에 붙습니다
const bodyEl = createElement('body');

const windowListeners: Record<string, ((e: unknown) => void)[]> = {};
let rafCallback: ((t: number) => void) | null = null;

const stubWindow = {
  innerWidth: 1400,
  innerHeight: 900,
  devicePixelRatio: 1,
  addEventListener(type: string, fn: (e: unknown) => void) {
    (windowListeners[type] ||= []).push(fn);
  },
  removeEventListener(type: string, fn: (e: unknown) => void) {
    windowListeners[type] = (windowListeners[type] ?? []).filter((f) => f !== fn);
  },
};

const store = new Map<string, string>();

/**
 * 난이도가 해금된 저장 데이터를 미리 심어 둡니다.
 * 그래야 "게임 시작 → 난이도 선택 → 시작" 경로까지 점검이 밟습니다.
 * 난이도 자체는 0 으로 고르므로 이후 흐름은 기본 게임과 같습니다.
 */
{
  const seed = emptySave();
  seed.maxDifficulty = 2;
  // 상점에서 한 번 더 사면 "플렉스" 1단계(5회 구매)가 열리는 자리에 세워 둡니다.
  // 그래야 "산 그 자리에서 업적이 뜨는가"를 상점 안에서 확인할 수 있습니다
  seed.coins = 500;
  seed.perm = { hp: 2, spd: 2 };
  // 난이도 다이얼이 0 이 아니라 마지막에 고른 자리에서 시작하는지 봅니다
  seed.lastDifficulty = 2;
  store.set('dodge-game-save', JSON.stringify(seed));
}

Object.assign(globalThis, {
  window: stubWindow,
  // 시드를 고정해야 매번 같은 흐름으로 재현됩니다.
  // **다만 `?seed` 는 개발자 모드에서만 듣습니다.** 5번에서 잠금을 풀기 전까지는
  // 안 걸리므로 첫 판은 시드가 안 잡힙니다. 그 구간의 점검은 시드와 무관한
  // 것들뿐이라(강제 레벨업 · 즉사 키) 결과가 흔들리지 않습니다
  location: { search: '?seed=20260804' },
  document: {
    getElementById: (id: string) => {
      if (id === 'game') return gameCanvas;
      if (id === 'overlay') return overlay;
      // 알림 컨테이너는 없으면 만들어 붙이는 구조라 body 에서 찾아줍니다
      return bodyEl.children.find((c) => c.id === id) ?? null;
    },
    createElement,
    body: bodyEl,
    // 자동 일시정지가 여기에 붙습니다 (`watchFocus`)
    addEventListener: () => {},
    hidden: false,
  },
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
  requestAnimationFrame: (cb: (t: number) => void) => {
    rafCallback = cb;
    return 1;
  },
  cancelAnimationFrame: () => {
    rafCallback = null;
  },
});
Object.assign(stubWindow, { requestAnimationFrame: globalThis.requestAnimationFrame });

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'OK  ' : '실패'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
}

/** 누르고 바로 뗍니다. keyup 을 보내지 않으면 같은 키를 두 번 못 누릅니다 */
function press(code: string): void {
  for (const fn of windowListeners['keydown'] ?? []) fn({ code, preventDefault() {} });
  for (const fn of windowListeners['keyup'] ?? []) fn({ code, preventDefault() {} });
}

function frames(count: number, msPerFrame = 16.7): void {
  // 루프는 `performance.now()` 로 기준 시각을 잡습니다(`GameLoop.start`).
  // 프레임 시각을 0 부터 세면 첫 프레임의 간격이 그만큼 **음수**가 되어,
  // 그 빚을 갚는 동안 물리 갱신이 통째로 건너뛰어집니다. 실행할 때마다 빚의 크기가
  // 달라져서 점검이 되다 말다 합니다. 첫 프레임에서 지금 시각에 맞춥니다
  if (now === 0) now = performance.now();
  for (let i = 0; i < count; i++) {
    const cb = rafCallback;
    if (!cb) return;
    rafCallback = null;
    cb(now);
    now += msPerFrame;
  }
}

let now = 0;

/** class 이름으로 화면 안을 뒤집니다 (문구가 아니라 표식으로 찾을 때) */
function findByClass(el: StubElement, name: string): StubElement | null {
  if (el.className.split(' ').includes(name)) return el;
  for (const c of el.children) {
    const hit = findByClass(c, name);
    if (hit) return hit;
  }
  return null;
}

/** 제목에 그 글자가 들어간 카드를 마우스로 누릅니다 */
function clickCard(title: string): void {
  const walk = (el: StubElement): StubElement | null => {
    if (el.className.split(' ').includes('card') && overlayText(el).includes(title)) return el;
    for (const c of el.children) {
      const hit = walk(c);
      if (hit) return hit;
    }
    return null;
  };
  walk(overlay)?.click();
}

/** 화면 안의 모든 텍스트를 모읍니다 */
function overlayText(el: StubElement = overlay): string {
  let out = el.text;
  for (const c of el.children) out += ` ${overlayText(c)}`;
  return out;
}

/** 업적 알림은 오버레이 바깥(#toasts)에 붙으므로 따로 봅니다 */
function toastText(): string {
  const box = bodyEl.children.find((c) => c.id === 'toasts');
  return box ? overlayText(box) : '';
}

async function main(): Promise<void> {
  await import('../src/main');

  console.log('1) 부팅');
  check('메인 화면이 떴다', overlayText().includes('게임 시작'));
  frames(3);
  check('첫 프레임이 돌았다', true);

  console.log('2) 상점과 도감');
  press('Digit2');
  // 탭 이름을 그대로 봅니다. 이름이 바뀌면 여기가 걸려서 화면과 시험이 같이 움직입니다
  check('상점이 열렸다', overlayText().includes('스탯 강화'));
  for (const tabName of ['스탯 고정', '공격 스킬', '유틸 스킬']) {
    check(`상점에 "${tabName}" 탭이 있다`, overlayText().includes(tabName));
  }

  // 첫 방문 도움말은 Esc 한 번을 먹습니다. 그것부터 닫지 않으면 처음 들어온 사람이
  // 상점 밖으로 튕겨 나가면서 도움말도 읽은 것으로 처리됩니다
  check('상점 첫 방문 도움말이 뜬다', overlay.querySelector('.shop-intro') !== null);
  press('Escape');
  check(
    'Esc 는 도움말을 먼저 닫는다 (상점은 안 나감)',
    overlay.querySelector('.shop-intro') === null && overlayText().includes('스탯 강화'),
  );

  // 판을 시작해야 알림이 뜨면 무엇 때문에 받았는지 안 보입니다. 산 그 자리에서 떠야 합니다
  const coinsBefore = JSON.parse(store.get('dodge-game-save') ?? '{}').coins as number;
  overlay.querySelector('.card')?.click();
  frames(6);
  check('상점에서 산 즉시 업적 알림이 뜬다', toastText().includes('업적 달성'), toastText().trim());
  check('업적 보상이 상점 화면의 코인에 반영된다', overlayText().includes(`코인 ${JSON.parse(store.get('dodge-game-save') ?? '{}').coins}`));

  // 알림 코인이 저장에도 들어가야 합니다 (산 값을 빼고도 늘어난 경우)
  const coinsAfter = JSON.parse(store.get('dodge-game-save') ?? '{}').coins as number;
  check('업적 코인이 저장에 남는다', coinsAfter > 0 && coinsBefore > 0, `${coinsBefore} → ${coinsAfter}`);
  press('Escape');
  press('Digit2');
  check('도움말은 두 번째 방문부터 안 뜬다', overlay.querySelector('.shop-intro') === null);
  press('Escape');
  press('Digit3');
  check('도감이 열렸다', overlayText().includes('적 도감'));
  press('Escape');
  press('Digit4');
  check('기록이 열렸다', overlayText().includes('최고 생존 시간'));
  press('Escape');
  press('Digit5');
  check('업적이 열렸다', overlayText().includes('업적'));
  // 히든은 달성 전까지 이름까지 가려야 합니다
  check('히든 업적은 가려져 있다', overlayText().includes('숨겨진 업적'));
  check('일반 업적은 이름이 보인다', overlayText().includes('학살자'));
  press('Escape');

  // 설정의 초기화는 한 번에 실행되면 안 됩니다 (되돌릴 방법이 없습니다).
  // 겨누기 동작 자체는 개발자 항목으로 6-2 번에서 봅니다
  press('Digit6');
  check('설정이 열렸다', overlayText().includes('모든 데이터 초기화'));
  // 개발자 모드를 켜기 전에는 그 항목들이 아예 없어야 합니다
  check('업적 초기화는 잠겨 있으면 안 보인다', !overlayText().includes('업적 초기화'));
  check('개발자 모드 끄기도 안 보인다', !overlayText().includes('개발자 모드'));
  // 설정은 마우스로 쓰는 화면입니다. 숫자키가 남아 있으면 안 됩니다
  press('Digit1');
  check('숫자키로는 아무 일도 안 일어난다', !overlayText().includes('한 번 더 누르면'));
  clickCard('모든 데이터 초기화');
  check('한 번 누르면 겨누기만 한다', overlayText().includes('한 번 더 누르면'));
  press('Escape');
  check('Esc 로 겨눈 것이 풀린다', !overlayText().includes('한 번 더 누르면'));

  // 설정 항목들
  check('화면 흔들림은 절반에서 시작한다', overlayText().includes('화면 흔들림') && overlayText().includes('절반'));
  check('파티클은 전체에서 시작한다', overlayText().includes('파티클') && overlayText().includes('전체'));
  check('창을 벗어나면 정지는 켜져 있다', overlayText().includes('창을 벗어나면 정지'));
  clickCard('화면 흔들림');
  check('흔들림을 누르면 다음 값으로 넘어간다', overlayText().includes('전체'), overlayText().trim().slice(0, 80));

  press('Escape');
  check('설정에서 메인으로 돌아온다', overlayText().includes('게임 시작'));

  // **톱니를 마우스로 눌러도 알림 줄이 생기면 안 됩니다.**
  // onclick 에 함수를 그대로 넘기면 클릭 이벤트가 첫 인자로 들어가는데,
  // 그 자리가 알림 문구라 화면에 `[object MouseEvent]` 가 찍혔습니다
  const gear = findByClass(overlay, 'gear-btn');
  check('톱니 버튼이 있다', gear !== null);
  gear?.click();
  check('톱니를 클릭해도 알림 줄이 없다', findByClass(overlay, 'settings-notice') === null);
  press('Escape');
  check('다시 메인으로 돌아온다', overlayText().includes('게임 시작'));

  console.log('3) 난이도 선택 후 게임 시작');
  press('Digit1');
  check('난이도 선택 화면이 떴다', overlayText().includes('난이도 선택'));
  check('효과 목록이 보인다', overlayText().includes('적용되는 효과'));
  // 저장에 남은 마지막 난이도(2)에서 시작해야 합니다. 0 부터면 매판 화살표를 그만큼 눌러야 합니다
  // 다이얼 이름표를 그대로 봅니다. 시작 버튼 문구는 이제 난이도와 무관하게 `시작` 입니다
  check(
    '마지막에 고른 난이도에서 시작한다',
    overlay.querySelector('.diff-name')?.text === '난이도 2',
    overlay.querySelector('.diff-name')?.text ?? '(없음)',
  );

  // 다이얼을 오른쪽 끝까지 밀어 잠긴 난이도를 확인합니다 (해금은 2 까지 심어뒀습니다)
  for (let i = 0; i < 6; i++) press('ArrowRight');
  check('잠긴 난이도는 시작 버튼이 없다', overlay.querySelector('.diff-start') === null);
  check('잠긴 난이도에는 잠김 표시가 뜬다', overlay.querySelector('.diff-locked') !== null);

  // 왼쪽 끝까지 밀면 입문(-1) 이고 그 아래로는 안 내려갑니다
  for (let i = 0; i < 12; i++) press('ArrowLeft');
  check('왼쪽 끝은 입문 난이도', overlayText().includes('입문'));

  // 0 으로 되돌려 시작합니다. 숫자 단축키는 없앴으므로 화살표와 Enter 로만 움직입니다
  press('ArrowRight');
  check(
    '난이도 0 으로 돌아왔다',
    overlay.querySelector('.diff-name')?.text === '기본' && overlay.querySelector('.diff-start') !== null,
  );
  press('Enter');
  frames(2);
  check('오버레이가 비었다 (게임 중)', overlayText().trim() === '');

  // 10초쯤 진행
  frames(600);
  check('게임이 진행됐다', true);

  console.log('4) 일시정지');
  press('Escape');
  frames(2);
  check('일시정지 화면이 떴다', overlayText().includes('일시정지'));
  press('Escape');
  frames(2);
  check('게임으로 복귀했다', overlayText().trim() === '');

  console.log('5) 레벨업 스킬 선택');
  // 레벨이 오를 때까지 돌립니다 (디버그 키로 강제 레벨업)
  //
  // **F1 만으로는 안 열립니다.** 잠금 화면이 먼저 뜨고 비밀번호를 쳐야 들어갑니다.
  // 그 순서를 여기서 그대로 밟으므로, 잠금이 깨지면 이 점검이 통째로 걸립니다
  press('F1');
  frames(2);
  check('디버그는 F1 만으로는 안 열린다 (잠금 화면)', overlay.querySelector('.gate') !== null);
  press('KeyZ');
  frames(1);
  check('틀린 키로는 안 열린다', overlay.querySelector('.gate') !== null);
  for (const code of DEBUG.unlockSequence) press(code);
  frames(2);
  check('비밀번호를 치면 열린다', overlayText().trim() === '', overlayText().trim().slice(0, 40));
  // 화면 판별은 문구가 아니라 **표식(class)** 으로 합니다.
  // 예전에는 부제 문구를 봤는데, 그 문구를 지우자 갈래 창과 구분이 안 됐습니다
  const skillChoiceOpen = () => overlay.querySelector('.skill-choice') !== null;
  const branchChoiceOpen = () => overlay.querySelector('.branch-choice') !== null;

  let opened = false;
  for (let i = 0; i < 40 && !opened; i++) {
    press('KeyL');
    frames(4);
    if (skillChoiceOpen()) opened = true;
  }
  check('스킬 선택 화면이 떴다', opened);
  if (opened) {
    press('Digit1');
    frames(3);
    check('선택 후 게임으로 복귀했다', overlayText().trim() === '');
  }

  console.log('6) 게임오버');
  // **싸움에 져서 죽기를 기다리지 않습니다.** 예전에는 200마리씩 45번을 쏟아붓고
  // 죽기를 기다렸는데, 그 처치로 들어오는 경험치가 플레이어를 같이 키워서 8천 마리를
  // 잡아 Lv.45 가 되면 안 죽었습니다. 판마다 결과가 갈려 점검이 되다 말다 했습니다.
  // 이 점검의 목적은 생존 시간 측정이 아니라 게임오버 화면까지 밟는 것이므로,
  // 디버그 즉사 키(X)로 곧장 갑니다. 밸런스를 아무리 만져도 안 흔들립니다.
  //
  // 적을 한 번 부르는 이유는 **사망 원인 표시를 같이 보기 위해서**입니다.
  // 화면에 적이 하나도 없으면 나를 죽인 적이 없어서 그 칸이 안 뜹니다
  press('KeyP');
  frames(4);
  let over = false;
  // 부활이 남아 있으면 한 번은 되살아나므로 여러 번 누릅니다.
  // 상점에서 살 수 있는 최대치보다 넉넉하게 잡습니다
  for (let i = 0; i < 8 && !over; i++) {
    press('KeyX');
    // 죽는 연출(1초)이 끝나야 게임오버 화면이 뜹니다
    frames(80);
    if (overlayText().includes('쓰러졌습니다')) over = true;
    // 선택은 필수라 화면이 뜨면 반드시 골라야 진행됩니다 (거절 없음).
    // 갈래 창도 마찬가지입니다. 안 누르면 world.update 가 멈춰 판이 영영 안 끝납니다
    if (skillChoiceOpen() || branchChoiceOpen()) press('Digit1');
  }
  check('게임오버 화면이 떴다', over, over ? '' : `화면: ${overlayText().trim().slice(0, 80) || '(비어 있음)'}`);
  check('나를 죽인 적이 표시됐다', overlayText().includes('나를 쓰러뜨린 적'));
  check('코인이 저장됐다', store.has('dodge-game-save'), store.get('dodge-game-save')?.slice(0, 60) ?? '없음');

  if (over) {
    press('Escape');
    frames(2);
    check('메인 화면으로 돌아왔다', overlayText().includes('게임 시작'));
  }

  if (over) {
    console.log('6-2) 개발자 모드가 켜진 뒤의 설정');
    press('Digit6');
    check('업적 초기화가 보인다', overlayText().includes('업적 초기화'));
    check('개발자 모드 끄기가 보인다', overlayText().includes('개발자 모드 끄기'));
    // 설정은 마우스로 씁니다 (숫자 단축키 없음)
    clickCard('업적 초기화');
    check('한 번 누르면 겨누기만 한다', overlayText().includes('한 번 더 누르면'));
    clickCard('업적 초기화');
    check('두 번 누르면 실행된다', overlayText().includes('업적을 지웠습니다'));
    // 껐다가 다시 켜야 아래 7번에서 디버그 키를 쓸 수 있으므로 여기서는 끄지 않습니다
    press('Escape');
    check('설정에서 메인으로 돌아온다', overlayText().includes('게임 시작'));
  }

  console.log('7) 6레벨 강화 갈래 선택');
  // **판을 새로 시작해서 확인합니다.** 6레벨까지 올리려면 강제 레벨업을 수십 번 해야 하는데,
  // 그러면 플레이어가 너무 세져서 6번(게임오버)이 영영 안 끝납니다. 두 점검이 서로를
  // 방해하므로 자리를 나눕니다
  if (over) {
    press('Digit1');
    frames(2);
    check('난이도 화면이 다시 떴다', overlayText().includes('난이도 선택'), overlayText().trim().slice(0, 40));
    press('Enter');
    frames(4);
    check('새 판이 시작됐다', overlayText().trim() === '', overlayText().trim().slice(0, 40));

    // F1 은 토글입니다. 5번에서 잠금을 풀었고 그 상태가 판을 넘어 유지되므로
    // 여기서는 비밀번호를 다시 칠 필요가 없습니다
    let branchOpened = false;
    for (let i = 0; i < 400 && !branchOpened; i++) {
      if (branchChoiceOpen()) {
        branchOpened = true;
        break;
      }
      // 선택창이 뜨면 1번을 눌러 계속 골라 나갑니다. 언젠가 한 스킬이 6레벨에 닿습니다
      if (skillChoiceOpen()) press('Digit1');
      else press('KeyL');
      frames(3);
    }
    check('강화 갈래 화면이 떴다', branchOpened, branchOpened ? '' : `화면: ${overlayText().trim().slice(0, 60) || '(비어 있음)'}`);
    if (branchOpened) {
      // 갈래 창에는 리롤도 건너뛰기도 Esc 도 없습니다. 반드시 하나를 골라야 넘어갑니다
      press('Escape');
      frames(2);
      check('Esc 로는 안 닫힌다', branchChoiceOpen());
      press('Digit1');
      frames(3);
      check('고른 뒤 게임으로 복귀했다', overlayText().trim() === '');
    }
  }

  console.log(failures === 0 ? '\n전부 통과했습니다' : `\n실패 ${failures}건`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
