import {
  ALL_BOSS_IDS,
  BOSS,
  BOSS_VARIANTS,
  ENEMY_BASE,
  ENEMY_TABLE,
  type BossId,
  type EnemyId,
} from '../../data/balance';
import { entryOf, tierOf, tiersFor } from '../../meta/bestiary';
import { isBossId } from '../../enemies/boss';
import { ALL_ENEMY_IDS, getEnemyDef } from '../../enemies/registry';
import type { SaveData } from '../../meta/save';
import { bindKeys, card, clearOverlay, h, overlayEl, screen } from './dom';
import { enemyIcon, unknownIcon } from './enemyIcon';

export function showBestiary(save: SaveData, onBack: () => void): () => void {
  clearOverlay();

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

  const body = [h('div', { class: 'rowlist' }, rows)];

  // 부제를 뺐습니다. "N마리를 처치하면 ~ 열립니다" 가 항목마다 이미 적혀 있어서
  // 머리말에서 같은 말을 한 번 더 하고 있었습니다
  overlayEl().append(screen('적 도감', '', body, '', onBack));

  return bindKeys((code) => {
    if (code === 'Escape' || code === 'Backspace') onBack();
  });
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
