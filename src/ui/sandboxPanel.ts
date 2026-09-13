import { ALL_BOSS_IDS, DEBUG_MAP, DIFFICULTY } from '../data/balance';
import { ALL_ENEMY_IDS, getEnemyDef } from '../enemies/registry';
import type { Debug } from '../game/debug';
import { ownedSlots } from '../game/player';
import {
  SPAWN_PLACES,
  clearHostiles,
  clearSkills,
  forceClear,
  grantSkill,
  killAllEnemies,
  levelUp,
  setClock,
  spawnEnemies,
} from '../game/sandbox';
import type { World } from '../game/world';
import { clampDifficulty, difficultyName } from '../meta/difficulty';
import { ALL_SKILL_IDS, getSkillDef } from '../skills/registry';
import { formatTime, h } from './screens/dom';

/**
 * 디버그 맵의 조작판 (2026-09-13).
 *
 * **오버레이 바깥(`#sandbox`)에 붙습니다.** 판이 도는 동안 계속 떠 있어야 하는데,
 * 오버레이 안에 두면 레벨업 창을 열고 닫을 때마다 `clearOverlay()` 가 같이 지웁니다.
 * 알림(`#toasts`)과 터치 조작(`#touch`)을 밖에 둔 것과 같은 이유입니다.
 *
 * **판이 도는 동안에만 보입니다.** 일시정지나 레벨업 창 위에 겹치면 카드를 가립니다.
 *
 * **다시 그리는 것은 누를 때뿐입니다.** 상태 줄만 `DEBUG_MAP.statusInterval` 마다 글자를
 * 갈아끼웁니다. 판 전체를 주기적으로 다시 그리면 누르는 도중에 버튼이 바뀌어서
 * 클릭이 사라집니다.
 */

export interface SandboxPanelActions {
  /** 난이도를 바꿨을 때. "다시 도전"이 같은 난이도로 이어지게 `main.ts` 가 기억합니다 */
  onDifficulty: (level: number, hard: boolean) => void;
  exit: () => void;
}

export interface SandboxPanel {
  setVisible(on: boolean): void;
  /** 매 프레임 부릅니다. 디버그 맵이 아니면 `null` 을 넘깁니다 */
  update(w: World | null, dt: number): void;
}

const PANEL_ID = 'sandbox';

interface ButtonOptions {
  on?: boolean;
  wide?: boolean;
  danger?: boolean;
}

function btn(label: string, onClick: () => void, opts: ButtonOptions = {}): HTMLElement {
  const cls = ['sb-btn', opts.on ? 'on' : '', opts.wide ? 'wide' : '', opts.danger ? 'danger' : '']
    .filter(Boolean)
    .join(' ');
  return h('button', {
    type: 'button',
    class: cls,
    onclick: (e: Event) => {
      // **누른 뒤 포커스를 놓습니다.** 안 놓으면 판 중에 스페이스나 엔터를 칠 때마다
      // 방금 누른 버튼이 한 번 더 눌립니다
      (e?.currentTarget as HTMLElement | null | undefined)?.blur?.();
      onClick();
    },
  }, [label]);
}

function row(label: string, controls: Node[]): HTMLElement {
  return h('div', { class: 'sb-row' }, [
    h('span', { class: 'sb-label' }, [label]),
    h('div', { class: 'sb-ctrl' }, controls),
  ]);
}

function stepper(value: string, prev: () => void, next: () => void): HTMLElement {
  return h('div', { class: 'sb-step' }, [
    btn('◀', prev),
    h('span', { class: 'sb-val' }, [value]),
    btn('▶', next),
  ]);
}

function section(title: string, rows: Node[]): HTMLElement {
  return h('section', { class: 'sb-sec' }, [h('div', { class: 'sb-sec-title' }, [title]), ...rows]);
}

/** 끝에서 끝으로 돌아갑니다. 적 16종을 반대편으로 가려고 열다섯 번 누를 일이 없게 합니다 */
function wrap(i: number, n: number): number {
  return ((i % n) + n) % n;
}

function statusText(w: World): string {
  const clear = w.cleared
    ? '클리어 후'
    : w.awaitingClearBoss()
      ? '클리어 보스 대기'
      : `클리어까지 ${formatTime(Math.max(0, w.diff.clearTime - w.time))}`;
  return [
    `${formatTime(w.time)}${w.freezeClock ? ' (정지)' : ''}`,
    difficultyName(w.difficulty, w.hard),
    `적 ${w.countedAlive()}/${w.maxAliveNow()}`,
    `스폰 ${w.spawner.currentRate(w).toFixed(2)}/초`,
    clear,
  ].join(' · ');
}

export function createSandboxPanel(debug: Debug, actions: SandboxPanelActions): SandboxPanel {
  const root = document.createElement('div');
  root.id = PANEL_ID;
  root.hidden = true;
  document.body.append(root);

  /** 고른 값. 판을 다시 시작해도 유지합니다 (같은 적을 연달아 시험하는 일이 많습니다) */
  const sel = { enemy: 0, elite: false, count: 0, place: 1, skill: 0 };
  let collapsed = false;
  let notice = '';
  let world: World | null = null;
  let visible = false;
  let statusEl: HTMLElement | null = null;
  let statusTimer = 0;

  /** 누르면 World 를 만지고, 돌려준 한 줄을 알림으로 띄운 뒤 다시 그립니다 */
  const act = (fn: (w: World) => string | void): (() => void) => () => {
    if (!world) return;
    notice = fn(world) ?? '';
    render();
  };

  const toggle = (label: string, on: boolean, flip: (w: World) => void): HTMLElement =>
    row(label, [btn(on ? '켬' : '끔', act(flip), { on })]);

  function difficultySection(w: World): HTMLElement {
    const set = (level: number, hard: boolean): (() => void) =>
      act((cur) => {
        const lv = clampDifficulty(level, hard);
        cur.setDifficulty(lv, hard);
        actions.onDifficulty(lv, hard);
        return `${difficultyName(lv, hard)} 적용 · 이미 나와 있는 적은 그대로입니다`;
      });
    return section('난이도', [
      row('모드', [
        btn('일반', set(w.difficulty, false), { on: !w.hard }),
        btn('하드', set(w.difficulty, true), { on: w.hard }),
      ]),
      row('단계', [
        stepper(
          difficultyName(w.difficulty, w.hard),
          set(w.difficulty - 1, w.hard),
          set(Math.min(DIFFICULTY.max, w.difficulty + 1), w.hard),
        ),
      ]),
    ]);
  }

  function timeSection(w: World): HTMLElement {
    return section('시간', [
      row('이동', DEBUG_MAP.timeSteps.map((s) =>
        btn(`${s > 0 ? '+' : '−'}${Math.abs(s) / 60}분`, act((cur) => {
          setClock(cur, cur.time + s);
          return `시간 ${formatTime(cur.time)}`;
        })),
      )),
      row('바로', [
        btn('0:00', act((cur) => {
          setClock(cur, 0);
          return '시간 0:00';
        })),
        btn(`클리어 ${DEBUG_MAP.clearLead}초 전`, act((cur) => {
          setClock(cur, cur.diff.clearTime - DEBUG_MAP.clearLead);
          return `시간 ${formatTime(cur.time)}`;
        })),
        btn('강제 클리어', act((cur) => (forceClear(cur) ? '클리어 상태로 넘겼습니다' : '이미 클리어했습니다'))),
      ]),
      toggle('시계 정지', w.freezeClock, (cur) => {
        cur.freezeClock = !cur.freezeClock;
      }),
    ]);
  }

  function spawnSection(w: World): HTMLElement {
    const steps = DEBUG_MAP.rateMulSteps;
    const found = steps.indexOf(w.spawner.rateMul as (typeof steps)[number]);
    const at = found < 0 ? steps.indexOf(1) : found;
    const setRate = (i: number): (() => void) =>
      act((cur) => {
        cur.spawner.rateMul = steps[Math.max(0, Math.min(steps.length - 1, i))];
        return `스폰율 x${cur.spawner.rateMul}`;
      });
    return section('스폰', [
      toggle('자동 스폰', w.spawner.enabled, (cur) => {
        cur.spawner.enabled = !cur.spawner.enabled;
      }),
      toggle('보스 자동', w.spawner.bossEnabled, (cur) => {
        cur.spawner.bossEnabled = !cur.spawner.bossEnabled;
      }),
      toggle('해금 무시', w.spawner.ignoreUnlock, (cur) => {
        cur.spawner.ignoreUnlock = !cur.spawner.ignoreUnlock;
      }),
      row('스폰율', [stepper(`x${steps[at]}`, setRate(at - 1), setRate(at + 1))]),
    ]);
  }

  function summonSection(): HTMLElement {
    const id = ALL_ENEMY_IDS[sel.enemy];
    const name = getEnemyDef(id).name;
    const count = DEBUG_MAP.countSteps[sel.count];
    const place = SPAWN_PLACES[sel.place];
    const pick = (fn: () => void): (() => void) => () => {
      fn();
      render();
    };
    return section('적 소환', [
      row('종류', [stepper(name, pick(() => (sel.enemy = wrap(sel.enemy - 1, ALL_ENEMY_IDS.length))), pick(() => (sel.enemy = wrap(sel.enemy + 1, ALL_ENEMY_IDS.length))))]),
      row('정예', [btn(sel.elite ? '켬' : '끔', pick(() => (sel.elite = !sel.elite)), { on: sel.elite })]),
      row('마릿수', [stepper(String(count), pick(() => (sel.count = wrap(sel.count - 1, DEBUG_MAP.countSteps.length))), pick(() => (sel.count = wrap(sel.count + 1, DEBUG_MAP.countSteps.length))))]),
      row('위치', [stepper(place.name, pick(() => (sel.place = wrap(sel.place - 1, SPAWN_PLACES.length))), pick(() => (sel.place = wrap(sel.place + 1, SPAWN_PLACES.length))))]),
      btn('소환', act((cur) => {
        const n = spawnEnemies(cur, id, count, sel.elite, place.id);
        return `${sel.elite ? '정예 ' : ''}${name} ${n}마리 (${place.name})`;
      }), { wide: true }),
    ]);
  }

  function bossSection(): HTMLElement {
    return section('보스 소환', [
      h('div', { class: 'sb-grid' }, ALL_BOSS_IDS.map((id) => {
        const name = getEnemyDef(id).name;
        return btn(name, act((cur) => {
          cur.spawnBoss(id);
          return `${name} 소환 (${cur.bossesSpawned}번째)`;
        }));
      })),
    ]);
  }

  function playerSection(): HTMLElement {
    return section('플레이어 · 정리', [
      row('무적', [btn(debug.godMode ? '켬' : '끔', () => {
        debug.godMode = !debug.godMode;
        notice = debug.godMode ? '무적 켬' : '무적 끔';
        render();
      }, { on: debug.godMode })]),
      h('div', { class: 'sb-grid' }, [
        btn('회복', act((cur) => {
          cur.player.hp = cur.player.stats.maxHp;
          return '체력 회복';
        })),
        ...DEBUG_MAP.levelSteps.map((n) =>
          btn(`레벨 +${n}`, act((cur) => {
            levelUp(cur, n);
            return `Lv.${cur.player.level}`;
          })),
        ),
        btn('적 전멸', act((cur) => `${killAllEnemies(cur)}마리 처치`)),
        btn('적탄·장판 정리', act((cur) => {
          clearHostiles(cur);
          return '적탄 · 장판 · 예고를 걷었습니다';
        })),
        btn('즉사', act((cur) => {
          debug.godMode = false;
          cur.damagePlayer(cur.player.stats.maxHp + 1, true, null);
          return '즉사';
        }), { danger: true }),
      ]),
    ]);
  }

  function skillSection(w: World): HTMLElement {
    const id = ALL_SKILL_IDS[sel.skill];
    const def = getSkillDef(id);
    const pick = (d: number): (() => void) => () => {
      sel.skill = wrap(sel.skill + d, ALL_SKILL_IDS.length);
      render();
    };
    const owned = ownedSlots(w.player).map((s) => `${getSkillDef(s.id).name} ${s.level}`).join(' · ');
    return section('스킬', [
      row('종류', [stepper(`${def.name}${def.kind === 'utility' ? ' [유틸]' : ''}`, pick(-1), pick(1))]),
      h('div', { class: 'sb-grid' }, [
        btn('지급 / +1', act((cur) => grantSkill(cur, id, false))),
        btn('만렙', act((cur) => grantSkill(cur, id, true))),
        btn('전부 비우기', act((cur) => {
          clearSkills(cur);
          return '스킬을 전부 뺐습니다';
        })),
      ]),
      h('div', { class: 'sb-owned' }, [owned || '(스킬 없음)']),
    ]);
  }

  function render(): void {
    root.replaceChildren();
    root.append(
      h('div', { class: 'sb-head' }, [
        h('div', { class: 'sb-title' }, ['디버그 맵']),
        btn(collapsed ? '펼치기' : '접기', () => {
          collapsed = !collapsed;
          render();
        }),
        btn('나가기', actions.exit, { danger: true }),
      ]),
    );
    statusEl = h('div', { class: 'sb-status' }, [world ? statusText(world) : '']);
    root.append(statusEl);
    if (notice) root.append(h('div', { class: 'sb-notice' }, [notice]));
    if (collapsed || !world) return;

    const w = world;
    root.append(
      difficultySection(w),
      timeSection(w),
      spawnSection(w),
      summonSection(),
      bossSection(),
      playerSection(),
      skillSection(w),
    );
  }

  return {
    setVisible(on: boolean): void {
      if (on === visible) return;
      visible = on;
      root.hidden = !on;
      // 레벨업 창을 닫고 돌아왔을 때 스킬 목록이 낡아 있지 않게 다시 그립니다
      if (on) render();
    },
    update(w: World | null, dt: number): void {
      if (w !== world) {
        world = w;
        notice = '';
        render();
      }
      if (!visible || !w || !statusEl) return;
      statusTimer -= dt;
      if (statusTimer > 0) return;
      statusTimer = DEBUG_MAP.statusInterval;
      statusEl.textContent = statusText(w);
    },
  };
}
