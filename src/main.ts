import './style.css';

import { ACHIEVEMENT, DIFFICULTY, HARD, SETTINGS, VIEW } from './data/balance';
import { GameLoop } from './core/loop';
import { Input } from './core/input';
import { Debug } from './game/debug';
import { World } from './game/world';
import { commitRun } from './meta/bestiary';
import { loadSave, resetSave, saveGame } from './meta/save';
import { Canvas2DRenderer } from './render/renderer';
import { drawIdleBackground, drawWorld } from './render/scene';
import { drawHud } from './ui/hud';
import { clearOverlay } from './ui/screens/dom';
import { showBestiary } from './ui/screens/bestiary';
import { showShop } from './ui/screens/shop';
import { showDifficultySelect } from './ui/screens/difficulty';
import { showMainMenu, showRecords } from './ui/screens/menus';
import { showAchievements } from './ui/screens/achievements';
import { showSettings } from './ui/screens/settings';
import { showBranchChoice, showGameOver, showPause, showSkillChoice } from './ui/screens/ingame';
import { showDebugGate } from './ui/screens/debugGate';
import type { SkillId } from './skills/types';
import { checkAchievements, commitAchieveStats, resetAchievements, unlockDirect } from './meta/achievements';
import { clearToasts, pushToasts, updateToasts } from './ui/toast';

type Screen =
  | 'main'
  | 'shop'
  | 'bestiary'
  | 'records'
  | 'difficulty'
  | 'playing'
  | 'paused'
  | 'levelup'
  /** 6레벨 강화 갈래 선택. 레벨업 창이 닫힌 뒤에 이어서 뜹니다 */
  | 'branch'
  /** 죽는 연출. 판은 멈춰 있고 파편만 날아갑니다 */
  | 'dying'
  | 'achievements'
  | 'settings'
  /** 디버그 잠금. 무엇을 여는 화면인지 적지 않습니다 (`debugGate.ts`) */
  | 'debugauth'
  | 'gameover';

const canvas = document.getElementById('game') as HTMLCanvasElement | null;
if (!canvas) throw new Error('#game 캔버스를 찾을 수 없습니다');

const renderer = new Canvas2DRenderer(canvas);
const input = new Input();
const debug = new Debug();

let save = loadSave();
let world: World | null = null;
let screen: Screen = 'main';
let unbind: () => void = () => {};
/**
 * 마지막으로 고른 난이도. 게임오버 후 "다시 도전"이 같은 난이도로 이어지고,
 * 저장에도 남아서 브라우저를 껐다 켜도 그 자리에서 시작합니다.
 */
let difficulty = save.lastDifficulty;
// 개발자 모드는 브라우저에 남습니다. 켜져 있으면 F1 이 바로 열립니다
debug.unlocked = save.devMode;
/** 업적 판정까지 남은 시간 */
let achieveTimer = 0;

watchMouse();
watchKonami();
watchFocus();
applyHardTheme();

/**
 * 하드모드의 겉모습을 화면에 반영합니다.
 *
 * **캔버스와 메뉴가 따로 놉니다.** 캔버스는 매 프레임 덧칠(`HARD.tint`)로 덮고,
 * 메뉴(DOM)는 `body.hard` 가 CSS 변수를 붉은 쪽으로 옮깁니다. 둘 다 걸어야 화면
 * 전체가 하나로 붉어집니다. **켜고 끌 때마다 이걸 부르십시오.**
 */
function applyHardTheme(): void {
  document.body.classList.toggle('hard', save.hardMode);
}

/**
 * 창을 벗어나면 자동으로 일시정지합니다 (설정에서 끌 수 있습니다).
 *
 * 30분짜리 판을 하는 게임이라 중간에 다른 창을 볼 일이 반드시 생깁니다. 없으면
 * 돌아와서 죽어 있는 것을 봅니다.
 *
 * **`blur` 와 `visibilitychange` 를 둘 다 봅니다.** 다른 창을 클릭하면 `blur` 만 오고,
 * 탭을 바꾸거나 최소화하면 `visibilitychange` 만 오는 경우가 있습니다.
 * `pauseRun` 은 판이 도는 중일 때만 동작하므로 두 번 불려도 문제가 없습니다.
 */
function watchFocus(): void {
  const pause = () => {
    if (!save.autoPause) return;
    if (screen !== 'playing') return;
    pauseRun();
  };
  window.addEventListener('blur', pause);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
  });
}

/** 화면(오버레이)을 마지막으로 닫은 시각. 그 직후의 클릭은 안 셉니다 */
let overlayClosedAt = 0;

/**
 * 스킬 선택창을 닫은 뒤 이 시간(ms) 안의 클릭은 무시합니다.
 *
 * 카드를 마우스로 고르면 창이 닫히는 그 순간 화면이 `playing` 이 되는데,
 * 연달아 한 번 더 누르는 습관이 있으면 그 클릭이 게임 화면에 떨어집니다.
 * **스킬 선택은 마우스로 해도 되는 조작**이라 그것 때문에 업적이 깨지면 안 됩니다.
 */
const MOUSE_GRACE_MS = 400;

/**
 * 이 게임은 마우스를 쓰지 않습니다 (기획.md 2장). 메뉴 클릭만 예외입니다.
 * 판이 도는 동안 화면을 **클릭하면** 히든 업적이 열립니다.
 *
 * 움직임(`mousemove`)까지 세지 않는 이유는, 책상 위의 마우스를 스치거나
 * 창을 옮기다 커서가 지나가기만 해도 열려버리기 때문입니다.
 * "마우스를 안 쓴다"를 어긴 것은 **누른 것**이지 지나간 것이 아닙니다.
 *
 * **스킬 선택과 갈래 선택의 클릭은 안 셉니다.** 창이 떠 있는 동안은 `screen` 이
 * `playing` 이 아니라 저절로 빠지고, 창을 닫은 직후의 한 번은 위 유예가 막습니다.
 */
function watchMouse(): void {
  window.addEventListener('mousedown', () => {
    if (screen !== 'playing' || !world) return;
    if (performance.now() - overlayClosedAt < MOUSE_GRACE_MS) return;
    // 아직 열릴 선택창이 남아 있으면 지금 클릭은 그 창을 향한 것입니다
    if (world.pendingSkillChoices > 0 || world.pendingBranchChoices.length > 0) return;
    world.track.mouseClicked = true;
  });
}

/**
 * 코나미 코드. 게임 상태로는 표현되지 않는 업적이라 조건식이 아니라 여기서 직접 엽니다.
 * 상점에서만 먹습니다 ("치트는 없다" 는 상점에서 치트를 시도했다는 농담입니다).
 */
function watchKonami(): void {
  const seq = [
    'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
    'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight',
    'KeyB', 'KeyA',
  ];
  let at = 0;
  window.addEventListener('keydown', (e) => {
    if (screen !== 'shop') {
      at = 0;
      return;
    }
    // 틀리면 처음으로. 다만 첫 글자와 같으면 거기서 다시 셉니다
    at = e.code === seq[at] ? at + 1 : e.code === seq[0] ? 1 : 0;
    if (at < seq.length) return;
    at = 0;
    const got = unlockDirect(save, 'konami');
    if (got.length === 0) return;
    pushToasts(got);
    save = loadSave();
  });
}

unlockAllFromUrl();

/**
 * 난이도 전체 해금 (개발용).
 *
 * `?unlock` 을 붙여 한 번 열면 최고 난이도까지 열린 채로 저장됩니다.
 * 그 뒤로는 파라미터를 떼고 열어도 계속 열려 있습니다.
 * 밸런스를 볼 때 15단계까지 차례로 깨고 올라갈 수는 없어서 둔 통로입니다.
 *
 * **개발자 모드에서만 듣습니다.** 난이도 해금은 이 게임의 유일한 장기 목표인데,
 * 주소에 한 줄 붙여 건너뛸 수 있으면 그 목표가 없는 것과 같습니다.
 */
function unlockAllFromUrl(): void {
  if (!save.devMode) return;
  if (!new URLSearchParams(location.search).has('unlock')) return;
  if (save.maxDifficulty >= DIFFICULTY.max) return;
  save.maxDifficulty = DIFFICULTY.max;
  saveGame(save);
}

// ---------------------------------------------------------------------------
// 화면 전환
// ---------------------------------------------------------------------------

function open(next: Screen, opener: () => () => void): void {
  // 메뉴로 넘어갈 때마다 한 번 훑습니다. 판 밖에서 열리는 업적(상점 구매·누적값)은
  // 판정할 자리가 여기밖에 없어서, 없으면 다음 판을 시작해야 알림이 뜹니다.
  // 여는 화면이 저장을 읽기 전에 훑어야 코인 표시가 낡지 않습니다
  sweepAchievements(null);
  unbind();
  screen = next;
  unbind = opener();
}

function closeOverlay(next: Screen): void {
  unbind();
  unbind = () => {};
  overlayClosedAt = performance.now();
  clearOverlay();
  // 화면을 닫은 그 키가 게임 쪽에서 다시 소비되지 않게 합니다
  input.clearPresses();
  screen = next;
}

function goMain(): void {
  world = null;
  open('main', () =>
    showMainMenu(save, {
      start: goStart,
      shop: goShop,
      bestiary: goBestiary,
      records: goRecords,
      achievements: goAchievements,
      settings: goSettings,
    }),
  );
}

/**
 * 난이도 선택은 처음부터 거칩니다.
 * 첫 판에도 -1(입문) 과 0(기본) 중에서 고를 수 있어야 하므로 건너뛰지 않습니다
 */
function goStart(): void {
  open('difficulty', () =>
    showDifficultySelect(
      save,
      (lv) => {
        difficulty = lv;
        // 고른 그 자리에서 저장합니다. 판이 끝날 때 저장하면 도중에 새로고침한 판이 사라집니다
        save.lastDifficulty = lv;
        saveGame(save);
        startRun();
      },
      goMain,
      // 마지막에 고른 난이도에서 이어서 고릅니다. 매번 0 부터 돌리면 15 까지 열다섯 번을 눌러야 합니다
      difficulty,
    ),
  );
}

function goShop(): void {
  // 산 그 자리에서 업적이 뜹니다. 판을 시작해야 알림이 오면 무엇 때문에 받았는지 안 보입니다
  open('shop', () => showShop(save, goMain, () => sweepAchievements(null)));
}

function goBestiary(): void {
  open('bestiary', () => showBestiary(save, goMain));
}

function goRecords(): void {
  open('records', () => showRecords(save, goMain));
}

function goAchievements(): void {
  open('achievements', () => showAchievements(save, goMain));
}

/**
 * 설정 (테스트용 초기화).
 *
 * 지운 뒤에는 같은 화면을 다시 엽니다. 메인으로 돌려보내면 무엇이 지워졌는지
 * 볼 자리가 없고, 연달아 지울 때 매번 들어와야 합니다.
 * 지운 직후 `save` 를 갈아끼우므로 다시 여는 시점에는 새 저장이 들어갑니다.
 */
/** 단계형 설정을 한 칸 넘깁니다. 끝에 닿으면 처음으로 돌아옵니다 */
function cycle(value: number, count: number): number {
  return (value + 1) % count;
}

function goSettings(notice = ''): void {
  open('settings', () =>
    showSettings(save, notice, {
      cycleShake: () => {
        save.shakeLevel = cycle(save.shakeLevel, SETTINGS.shake.levels.length);
        saveGame(save);
        // 판이 돌고 있는 중이면 그 판에도 바로 먹여야 합니다. 다음 판부터 적용되면
        // 무엇이 바뀌었는지 확인할 방법이 없습니다
        if (world) world.effects.shakeScale = SETTINGS.shake.levels[save.shakeLevel].mul;
        goSettings();
      },
      cycleParticles: () => {
        save.particleLevel = cycle(save.particleLevel, SETTINGS.particles.levels.length);
        saveGame(save);
        if (world) world.effects.particleScale = SETTINGS.particles.levels[save.particleLevel].mul;
        goSettings();
      },
      toggleAutoPause: () => {
        save.autoPause = !save.autoPause;
        saveGame(save);
        goSettings();
      },
      // ⚠ 지금은 저장에 남기는 것이 전부입니다. 하드모드의 내용은 나중에 만듭니다
      toggleHardMode: () => {
        save.hardMode = !save.hardMode;
        saveGame(save);
        applyHardTheme();
        goSettings(save.hardMode ? '하드모드' : '');
      },
      resetAll: () => {
        save = resetSave();
        // 저장이 비면 하드모드도 꺼집니다. 색만 붉게 남으면 화면이 거짓말을 합니다
        applyHardTheme();
        // 난이도 해금이 0 으로 돌아갔는데 마지막에 고른 값이 남아 있으면 어긋납니다
        difficulty = 0;
        clearToasts();
        goSettings('모든 데이터를 지웠습니다');
      },
      resetAchievements: () => {
        resetAchievements(save);
        clearToasts();
        goSettings('업적을 지웠습니다');
      },
      devModeOff: () => {
        save.devMode = false;
        saveGame(save);
        debug.unlocked = false;
        debug.enabled = false;
        goSettings('개발자 모드를 껐습니다');
      },
      back: goMain,
    }),
  );
}

/**
 * 업적을 한 번 훑고, 새로 열린 것이 있으면 알림을 띄웁니다.
 *
 * 코인 지급과 저장은 `checkAchievements` 안에서 즉시 일어납니다. 여기서는 알림만 맡습니다.
 *
 * **여기서 `save` 를 다시 읽지 않습니다.** `checkAchievements` 는 넘겨준 객체를 그 자리에서
 * 고치므로 다시 읽을 이유가 없고, 다시 읽으면 내용은 같지만 **다른 객체**가 됩니다.
 * 그러면 지금 열려 있는 화면(상점처럼 저장을 들고 있는 화면)이 낡은 객체를 계속 고쳐서
 * 그 뒤의 구매가 업적 보상을 지우고 덮어씁니다.
 */
function sweepAchievements(w: World | null, runEnded = false): void {
  const got = checkAchievements(save, w, runEnded);
  if (got.length === 0) return;
  pushToasts(got);
}

/**
 * 시드 고정 모드 (기획.md 10장).
 * ?seed=12345 로 열면 같은 상황이 그대로 재현됩니다. 밸런싱 전후 비교에 씁니다.
 *
 * **개발자 모드에서만 듣습니다.** 유리해지는 파라미터는 아니지만, 개발용 통로는
 * 한 자리에 모아두는 편이 무엇이 열려 있는지 알기 쉽습니다.
 */
function seedFromUrl(): number | undefined {
  if (!save.devMode) return undefined;
  const raw = new URLSearchParams(location.search).get('seed');
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n >>> 0 : undefined;
}

function startRun(): void {
  // 고른 난이도가 사라진(저장 데이터가 초기화된) 경우를 대비해 한 번 더 잘라둡니다.
  // 아래로는 DIFFICULTY.min 까지 허용합니다 (-1 은 해금과 무관하게 항상 고를 수 있습니다)
  difficulty = Math.max(DIFFICULTY.min, Math.min(difficulty, save.maxDifficulty));
  world = new World(save, input, seedFromUrl(), difficulty);
  input.clear();
  closeOverlay('playing');
}

function pauseRun(): void {
  if (!world) return;
  const w = world;
  open('paused', () =>
    showPause(
      w,
      () => closeOverlay('playing'),
      () => {
        finishRun(w);
        goMain();
      },
    ),
  );
}

function openSkillChoice(): void {
  if (!world) return;
  const w = world;
  open('levelup', () => showSkillChoice(w, () => closeOverlay('playing')));
}

function openBranchChoice(id: SkillId): void {
  if (!world) return;
  const w = world;
  open('branch', () => showBranchChoice(w, id, () => closeOverlay('playing')));
}

function finishRun(w: World): void {
  commitRun(save, w);
  commitAchieveStats(save, w);
  saveGame(save);
  save = loadSave();
  // 판이 끝나야 판정되는 업적(클리어 조건, 누적값)이 있어서 여기서 한 번 더 훑습니다
  sweepAchievements(w, true);
}

/**
 * 죽는 연출로 넘어갑니다. 화면(DOM)은 아무것도 띄우지 않습니다.
 *
 * `open` 을 거치는 이유는 이전 화면이 걸어둔 키 처리를 확실히 걷기 위해서입니다.
 * 연출 중에 남은 핸들러가 살아 있으면 건너뛰기 키가 두 번 먹습니다.
 */
/**
 * 디버그 잠금 화면을 엽니다.
 *
 * `open` 을 거치므로 판이 멈춥니다. 비밀번호를 치는 동안 가만히 서 있으면
 * 그대로 맞아 죽기 때문입니다.
 */
function openDebugGate(): void {
  open('debugauth', () =>
    showDebugGate(
      () => {
        debug.unlocked = true;
        debug.enabled = true;
        // **저장에 남깁니다.** `?unlock` 은 페이지가 열릴 때, `?seed` 는 판이 시작될 때
        // 읽히는데 그 시점에는 아직 디버그를 켤 기회가 없습니다. 탭 안에만 두면
        // 주소 파라미터는 영영 안 듣습니다. 끄는 것은 설정 화면에서 합니다
        save.devMode = true;
        saveGame(save);
        closeOverlay('playing');
      },
      () => closeOverlay('playing'),
    ),
  );
}

function startDying(): void {
  open('dying', () => () => {});
}

function endRun(): void {
  if (!world) return;
  const w = world;
  finishRun(w);
  open('gameover', () =>
    showGameOver(w, save.coins, startRun, goMain),
  );
}

// ---------------------------------------------------------------------------
// 루프
// ---------------------------------------------------------------------------

const loop = new GameLoop({
  update: (dt) => {
    input.beginStep();
    // 알림은 게임이 돌든 메뉴에 있든 계속 흘러야 합니다.
    // 게임오버로 넘어가는 순간 방금 딴 업적이 멈춰 서면 읽을 수가 없습니다
    updateToasts(dt);

    if (!world) return;

    // 죽는 연출 중에는 판 전체가 멈춰 있고 파편만 움직입니다.
    // 그래서 world.update 대신 이것만 돌립니다
    if (screen === 'dying') {
      if (world.updateDeathBurst(dt, input.anyPressed())) endRun();
      return;
    }

    if (screen !== 'playing') {
      // 메뉴가 떠 있어도 파티클과 화면 흔들림은 정리되게 둡니다
      world.effects.update(dt);
      return;
    }

    // 잠겨 있는 동안의 F1 은 디버그를 켜지 않고 잠금 화면을 엽니다.
    // **여는 순간 판이 멈춥니다.** `screen` 이 'playing' 이 아니게 되어 world.update 가
    // 안 도는데, 그래야 비밀번호를 치는 동안 가만히 서서 맞아 죽지 않습니다
    if (!debug.unlocked && input.wasPressed('F1')) {
      openDebugGate();
      return;
    }

    debug.handleKeys(world);

    if (input.wasPressed('Escape')) {
      pauseRun();
      return;
    }

    world.update(dt);

    // 판이 도는 동안에도 조건이 갖춰지는 순간 바로 뜹니다.
    // 매 프레임 49개를 돌릴 이유가 없어서 ACHIEVEMENT.checkInterval 간격으로 봅니다
    achieveTimer -= dt;
    if (achieveTimer <= 0) {
      achieveTimer = ACHIEVEMENT.checkInterval;
      sweepAchievements(world);
    }

    if (world.gameOver) {
      startDying();
      return;
    }

    // 갈래를 **먼저** 비웁니다. "지뢰 Lv.6 을 골랐다 → 갈래를 고른다"가 한 흐름으로
    // 이어져야 무엇 때문에 이 화면이 떴는지 보입니다. 뒤로 미루면 다른 레벨업 카드가
    // 사이에 끼어 원인이 끊깁니다.
    // ⚠ return 이 없으면 같은 프레임에 화면 두 개가 열려 키 처리가 어긋납니다
    if (world.pendingBranchChoices.length > 0) {
      openBranchChoice(world.pendingBranchChoices.shift()!);
      return;
    }

    if (world.pendingSkillChoices > 0) {
      world.pendingSkillChoices--;
      openSkillChoice();
    }
  },

  render: (_alpha, fps) => {
    if (world) {
      drawWorld(renderer, world);
      if (
        screen === 'playing' ||
        screen === 'paused' ||
        screen === 'levelup' ||
        // 빠뜨리면 갈래를 고르는 동안 HUD 가 통째로 사라집니다
        screen === 'branch' ||
        screen === 'dying' ||
        screen === 'gameover'
      ) {
        drawHud(renderer, world);
      }
      debug.draw(renderer, world, fps);
    } else {
      drawIdleBackground(renderer);
    }
    // **맨 위에 덮습니다.** 디버그 오버레이까지 같이 붉어져야 화면 전체가 하나로
    // 보입니다. 판이 없을 때(메인 화면 배경)도 걸립니다
    if (save.hardMode) renderer.rect(0, 0, VIEW.w, VIEW.h, HARD.tint);
  },
});

goMain();
loop.start();
