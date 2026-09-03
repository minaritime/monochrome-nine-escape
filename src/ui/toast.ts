import { ACHIEVEMENT } from '../data/balance';
import type { AchieveUnlock } from '../meta/achievements';

/**
 * 업적 달성 알림 (스팀식).
 *
 * 화면 전환용 오버레이(`overlayEl`)와 **다른 컨테이너**를 씁니다.
 * `clearOverlay()` 는 화면을 바꿀 때마다 오버레이를 통째로 비우는데, 알림이 그 안에 있으면
 * 게임오버 화면이 뜨는 순간 방금 달성한 업적이 같이 사라집니다.
 * 알림은 화면과 수명이 다르므로 자리도 달라야 합니다.
 */
const CONTAINER_ID = 'toasts';

function containerEl(): HTMLElement {
  let el = document.getElementById(CONTAINER_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = CONTAINER_ID;
    document.body.append(el);
  }
  return el;
}

/** 아직 안 뜬 알림. 한꺼번에 달성되면 줄을 세웁니다 */
const queue: AchieveUnlock[] = [];
let nextAt = 0;

export function pushToasts(items: AchieveUnlock[]): void {
  for (const it of items) queue.push(it);
}

/**
 * 매 프레임 부릅니다. 줄 서 있는 알림을 간격을 두고 하나씩 띄웁니다.
 *
 * 한 번에 다 띄우면 세 개가 겹쳐서 무엇을 받았는지 못 읽습니다.
 */
export function updateToasts(dt: number): void {
  if (queue.length === 0) return;
  nextAt -= dt;
  if (nextAt > 0) return;
  nextAt = ACHIEVEMENT.toastGap;
  const item = queue.shift();
  if (item) show(item);
}

function show(item: AchieveUnlock): void {
  const el = document.createElement('div');
  el.className = 'toast';

  const badge = document.createElement('div');
  badge.className = 'toast-badge';
  badge.textContent = '★';

  const body = document.createElement('div');
  body.className = 'toast-body';

  const label = document.createElement('div');
  label.className = 'toast-label';
  label.textContent = `업적 달성${item.tierLabel ? `  ${item.tierLabel}` : ''}`;

  const name = document.createElement('div');
  name.className = 'toast-name';
  name.textContent = item.name;

  const coin = document.createElement('div');
  coin.className = 'toast-coin';
  coin.textContent = `+${item.coin}`;

  body.append(label, name);
  el.append(badge, body, coin);
  containerEl().append(el);

  // 애니메이션이 끝나면 스스로 사라집니다. 타이머를 따로 들고 있으면
  // 화면을 나갔다 들어올 때 남은 타이머가 엉킵니다
  el.addEventListener('animationend', (ev) => {
    if ((ev as AnimationEvent).animationName === 'toast-out') el.remove();
  });
  el.style.setProperty('--toast-life', `${ACHIEVEMENT.toastLife}s`);
}

/** 저장을 초기화하는 등으로 화면을 완전히 비울 때 씁니다 */
export function clearToasts(): void {
  queue.length = 0;
  nextAt = 0;
  containerEl().replaceChildren();
}
