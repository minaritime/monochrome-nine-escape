import { VIEW } from '../data/balance';

/**
 * 화면 맞춤.
 *
 * 이 게임은 **1710 x 720 한 크기로 그려집니다.** 창 크기를 따라가지 않고, 그린 것을
 * 통째로 확대·축소해서 창에 맞춥니다. 좌표 계산이 판마다 달라지지 않아야 하기
 * 때문입니다.
 *
 * **캔버스와 메뉴가 한 덩어리로 움직여야 합니다.** 예전에는 캔버스만 배율을 따르고
 * 메뉴(DOM)는 `92vh` 처럼 창을 기준으로 크기를 잡았습니다. 그래서 전체화면으로 키우면
 * 둘의 기준이 갈라져서, 난이도 화면(높이 820px)이 720 짜리 캔버스 밖으로 튀어나갔습니다.
 * 지금은 `#stage` 하나에 둘을 담고 그 상자에만 배율을 겁니다.
 */
export function viewScale(): number {
  return Math.min(window.innerWidth / VIEW.w, window.innerHeight / VIEW.h);
}

let stage: HTMLElement | null = null;

/** 무대 상자를 창 한가운데에 맞춰 놓습니다 */
export function fitStage(): void {
  stage ??= document.getElementById('stage');
  if (!stage) return;
  // 크기를 CSS 가 아니라 여기서 넣는 이유는, 숫자를 `balance.ts` 한 곳에만 두기 위해서입니다
  stage.style.width = `${VIEW.w}px`;
  stage.style.height = `${VIEW.h}px`;
  stage.style.transform = `scale(${viewScale()})`;
}

/**
 * 창 크기와 전체화면 전환을 지켜봅니다.
 *
 * **`fullscreenchange` 를 따로 보는 이유**는 브라우저에 따라 전체화면에 들어간 직후의
 * `resize` 가 예전 크기로 오는 경우가 있어서입니다. 한 번 더 맞추면 그 틈이 메워집니다.
 */
export function watchViewport(onFit: () => void): void {
  const fit = () => {
    fitStage();
    onFit();
  };
  fit();
  window.addEventListener('resize', fit);
  document.addEventListener('fullscreenchange', () => {
    fit();
    // 전환이 끝난 뒤 한 번 더. 들어가는 순간의 창 크기가 아직 옛 값인 브라우저가 있습니다
    setTimeout(fit, 80);
  });
}
