import { ACHIEVEMENT } from '../../data/balance';
import { type AchieveCtx, type AchieveDef } from '../../data/achievements';
import { achieveProgress, isComplete, tierOf, visibleAchievements } from '../../meta/achievements';
import type { SaveData } from '../../meta/save';
import { bindKeys, card, clearOverlay, h, overlayEl, screen } from './dom';

/**
 * 업적 화면.
 *
 * 히든은 달성 전까지 이름까지 가립니다. 조건만 가리고 이름을 보여주면
 * "무궁화 꽃이 피고 있는 듯한 느낌" 같은 이름에서 조건이 그대로 유추됩니다.
 *
 * 히든은 이름도 조건도 없는 줄이라 목록 사이에 섞이면 읽는 흐름을 끊습니다.
 * 찾은 것이든 아니든 전부 맨 아래 한 덩어리로 모읍니다.
 */
export function showAchievements(save: SaveData, onBack: () => void): () => void {
  clearOverlay();

  const { done, total } = achieveProgress(save);
  // 보상 설명은 뺐습니다. 줄마다 `120 코인` 이 이미 붙어 있습니다
  const head = h('div', { class: 'ach-head' }, [h('div', { class: 'coins' }, [`${done} / ${total}`])]);
  const bar = h('div', { class: 'ach-bar' }, [
    h('div', { style: `width: ${total === 0 ? 0 : Math.round((done / total) * 100)}%` }, []),
  ]);

  const visible = visibleAchievements(save);
  // 달성한 것을 위로 올립니다. 다 채운 것은 다시 볼 일이 적으므로 맨 아래로 보냅니다
  const open = visible.filter((d) => !d.hidden).sort((a, b) => rank(save, a) - rank(save, b));
  // 히든은 찾은 것을 앞에 둡니다. 뒤쪽은 어차피 전부 같은 ??? 줄입니다
  const secrets = visible.filter((d) => d.hidden).sort((a, b) => hiddenRank(save, a) - hiddenRank(save, b));

  const rows: Node[] = open.map((def) => rowOf(save, def));
  if (secrets.length > 0) {
    const found = secrets.filter((d) => isComplete(save, d)).length;
    rows.push(h('div', { class: 'ach-sep' }, [`히든 ${found} / ${secrets.length}`]));
    rows.push(...secrets.map((def) => rowOf(save, def)));
  }

  overlayEl().append(screen('업적', '', [head, bar, h('div', { class: 'rowlist' }, rows)], '', onBack));

  return bindKeys((code) => {
    if (code === 'Escape' || code === 'Backspace') onBack();
  });
}

/** 정렬 순서: 진행 중 → 아직 안 한 것 → 다 채운 것 */
function rank(save: SaveData, def: AchieveDef): number {
  if (isComplete(save, def)) return 2;
  return tierOf(save, def.id) > 0 ? 0 : 1;
}

/** 히든 안에서는 찾은 것이 먼저입니다 */
function hiddenRank(save: SaveData, def: AchieveDef): number {
  return isComplete(save, def) ? 0 : 1;
}

function rowOf(save: SaveData, def: AchieveDef): HTMLElement {
  const have = tierOf(save, def.id);
  const complete = isComplete(save, def);
  const secret = !!def.hidden && have === 0;

  const nextCoin = Math.round((def.tiers[Math.min(have, def.tiers.length - 1)]?.coin ?? 0) * ACHIEVEMENT.coinMul);
  const el = card({
    // 누를 수 없는 정보 카드입니다. disabled 만 걸면 상점의 "못 사는 항목" 흐림이 걸립니다
    info: true,
    title: secret ? '???' : def.name,
    desc: secret ? '숨겨진 업적입니다' : def.desc,
    price: complete ? '완료' : `${nextCoin} 코인`,
  });
  el.classList.add(secret ? 'ach-hidden' : complete ? 'ach-done' : 'ach-todo');

  // 단계형은 **다음 한 칸만** 보여줍니다. 여섯 단계를 한 줄에 늘어놓으면
  // 지금 무엇을 채우면 되는지가 그 안에 묻힙니다
  if (!secret && def.tiers.length > 1) {
    const line = complete
      ? `${have}/${def.tiers.length} 단계 완료`
      : `${have}/${def.tiers.length}  다음 ${fmt(def.tiers[have]?.goal ?? 0, def.id)}${nowText(save, def)}`;
    el.querySelector('.body')?.append(h('div', { class: 'ach-tiers' }, [line]));
  }
  return el;
}

/** 지금 값. 조건식 하나가 터져서 화면이 안 뜨는 일은 없어야 합니다 */
function nowText(save: SaveData, def: AchieveDef): string {
  if (!def.progress) return '';
  try {
    return ` (지금 ${fmt(def.progress({ save, w: null, runEnded: false }), def.id)})`;
  } catch {
    return '';
  }
}

/** 시간 단계는 초로 보여주면 안 읽힙니다 */
function fmt(value: number, id: string): string {
  if (id !== 'playtime') return String(Math.floor(value));
  const hours = value / 3600;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}시간`;
}

/** 방금 만든 컨텍스트로 화면을 새로 그릴 필요는 없어서 타입만 다시 내보냅니다 */
export type { AchieveCtx };
