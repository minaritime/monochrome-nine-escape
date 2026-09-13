import {
  ALL_BOSS_IDS,
  BOSS,
  BOSS_VARIANTS,
  ENEMY_BASE,
  ENEMY_TABLE,
  SKILL_BRANCH_LEVEL,
  SKILL_MAX_LEVEL,
  type BossId,
  type EnemyId,
  type SkillBranchId,
} from '../../data/balance';
import { entryOf, tierOf, tiersFor } from '../../meta/bestiary';
import { knowsBranch, skillDexLevel } from '../../meta/skillDex';
import { isBossId } from '../../enemies/boss';
import { ALL_ENEMY_IDS, getEnemyDef } from '../../enemies/registry';
import type { SaveData } from '../../meta/save';
import { branchesFor, modsOf } from '../../skills/branches';
import { ALL_SKILL_IDS, getSkillDef } from '../../skills/registry';
import type { SkillId } from '../../skills/types';
import { bindKeys, card, clearOverlay, h, overlayEl, screen } from './dom';
import { enemyIcon, unknownIcon } from './enemyIcon';

/**
 * 도감. **적과 스킬 두 탭입니다** (스킬은 2026-09-13 추가).
 *
 * 탭은 상점과 같은 모양(`.tabs` · `.tab`)을 쓰고, 좌우 화살표로도 넘깁니다.
 * 들어올 때마다 적 탭에서 시작합니다.
 */
type Tab = 'enemy' | 'skill';

const TABS: readonly Tab[] = ['enemy', 'skill'];
const TAB_LABEL: Record<Tab, string> = { enemy: '적', skill: '스킬' };
const TITLE: Record<Tab, string> = { enemy: '적 도감', skill: '스킬 도감' };

export function showBestiary(save: SaveData, onBack: () => void): () => void {
  let tab: Tab = 'enemy';

  const render = (): void => {
    clearOverlay();
    const tabs = h(
      'div',
      { class: 'tabs' },
      TABS.map((t) =>
        h('button', {
          class: `tab${tab === t ? ' active' : ''}`,
          onclick: () => {
            tab = t;
            render();
          },
        }, [TAB_LABEL[t]]),
      ),
    );
    const rows = tab === 'enemy' ? enemyRows(save) : skillRows(save);
    // 부제를 뺐습니다. 열리는 조건이 항목마다 이미 적혀 있어서 머리말에서 같은 말을
    // 한 번 더 하고 있었습니다
    overlayEl().append(screen(TITLE[tab], '', [tabs, h('div', { class: 'rowlist' }, rows)], '', onBack));
  };

  render();

  return bindKeys((code) => {
    if (code === 'Escape' || code === 'Backspace') {
      onBack();
      return;
    }
    if (code === 'ArrowLeft' || code === 'ArrowRight') {
      const step = code === 'ArrowRight' ? 1 : -1;
      tab = TABS[(TABS.indexOf(tab) + step + TABS.length) % TABS.length];
      render();
    }
  });
}

// ---------------------------------------------------------------------------
// 적
// ---------------------------------------------------------------------------

function enemyRows(save: SaveData): Node[] {
  const rows: Node[] = [];
  const ids: (EnemyId | BossId)[] = [...ALL_ENEMY_IDS, ...ALL_BOSS_IDS];

  for (const id of ids) {
    const def = getEnemyDef(id);
    const tier = tierOf(save, id);
    const entry = entryOf(save, id);

    if (tier === 'unknown') {
      rows.push(
        card({
          title: '???',
          desc: '아직 만나지 못했습니다',
          locked: true,
          disabled: true,
          info: true,
          right: unknownIcon(),
        }),
      );
      continue;
    }

    const t = tiersFor(id);
    const parts: string[] = [];
    if (tier === 'seen') {
      parts.push(`${t.pattern}마리를 처치하면 이동 패턴이 열립니다 (${entry.kills}/${t.pattern})`);
    } else {
      parts.push(def.pattern);
      if (tier === 'pattern') {
        parts.push(`${t.numbers}마리를 처치하면 정확한 수치가 열립니다 (${entry.kills}/${t.numbers})`);
      } else {
        parts.push(numbersOf(id));
      }
    }

    rows.push(
      card({
        title: `${def.name}  ·  처치 ${entry.kills}`,
        desc: parts.join('  /  '),
        disabled: true,
        info: true,
        right: enemyIcon(def),
      }),
    );
  }
  return rows;
}

function numbersOf(id: EnemyId | BossId): string {
  if (isBossId(id)) {
    const v = BOSS_VARIANTS[id];
    const order = ALL_BOSS_IDS.indexOf(id) + 1;
    return [
      `${Math.round(BOSS.interval / 60)}분마다 등장 (${order}번째 순서)`,
      `체력 ${Math.round(BOSS.hp * v.hpMul)}`,
      `공격력 ${Math.round(BOSS.damage * v.damageMul)}`,
      `속도 ${Math.round(BOSS.speed * v.speedMul)}`,
      '처치 시 코인 대량과 회복',
    ].join(' · ');
  }
  const bal = ENEMY_TABLE[id];
  const unlock =
    bal.unlockTime === 0
      ? '처음부터'
      : bal.unlockSkills > 0
        ? `${Math.round(bal.unlockTime / 60)}분 또는 스킬 ${bal.unlockSkills}개`
        : `${Math.round(bal.unlockTime / 60)}분`;
  return [
    `속도 ${Math.round(ENEMY_BASE.speed * bal.speed)}`,
    `체력 ${Math.round(ENEMY_BASE.hp * bal.hp)}`,
    `공격력 ${Math.round(ENEMY_BASE.damage * bal.damage)}`,
    `해금 ${unlock}`,
  ].join(' · ');
}

// ---------------------------------------------------------------------------
// 스킬
// ---------------------------------------------------------------------------

function skillRows(save: SaveData): Node[] {
  return ALL_SKILL_IDS.map((id) => skillCard(save, id));
}

/**
 * 스킬 한 장. 가 본 레벨까지 한 줄씩, 그 위는 한 줄로 가립니다.
 * 갈래는 고른 적 있는 것만 이름 · 설명 · 6레벨 기준 수치를 보여줍니다.
 *
 * **수치는 `levelText` 를 그대로 씁니다.** 레벨업 카드가 쓰는 것과 같은 식이라,
 * 도감의 숫자와 실제 성능이 어긋날 수 없습니다.
 */
function skillCard(save: SaveData, id: SkillId): HTMLElement {
  const def = getSkillDef(id);
  const level = skillDexLevel(save, id);

  if (level <= 0) {
    return card({
      title: '???',
      desc: '클리어한 판에서 써 본 적이 없습니다',
      locked: true,
      disabled: true,
      info: true,
    });
  }

  const lines: HTMLElement[] = [];
  for (let l = 1; l <= level; l++) {
    lines.push(h('li', {}, [h('b', {}, [`Lv.${l}`]), def.levelText(l)]));
  }
  if (level < SKILL_MAX_LEVEL) {
    const range = level + 1 === SKILL_MAX_LEVEL ? `Lv.${SKILL_MAX_LEVEL}` : `Lv.${level + 1}~${SKILL_MAX_LEVEL}`;
    lines.push(h('li', { class: 'locked' }, [h('b', {}, [range]), '???']));
  }

  for (const b of branchesFor(id)) {
    if (!knowsBranch(save, id, b.id)) {
      lines.push(h('li', { class: 'dex-branch locked' }, [h('b', {}, ['갈래']), '???']));
      continue;
    }
    const numbers = def.levelText(SKILL_BRANCH_LEVEL, modsOf(b.id as SkillBranchId));
    lines.push(
      h('li', { class: 'dex-branch' }, [
        h('b', {}, [b.name]),
        `${b.desc} · Lv.${SKILL_BRANCH_LEVEL} 기준 ${numbers}`,
      ]),
    );
  }

  const el = card({
    title: `${def.name}  ·  ${def.kind === 'utility' ? '유틸' : '공격'}  ·  Lv.${level}/${SKILL_MAX_LEVEL}`,
    desc: def.desc,
    disabled: true,
    info: true,
  });
  // 목록은 카드의 글 칸 안에 붙입니다. 카드 자체에 붙이면 가로로 늘어선 칸 하나가 됩니다
  (el.querySelector('.body') ?? el).append(h('ul', { class: 'dex-levels' }, lines));
  return el;
}
