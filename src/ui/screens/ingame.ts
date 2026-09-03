import { SKILL_BRANCH_LEVEL } from '../../data/balance';
import type { SkillBranchId } from '../../data/balance';
import { UTILITY_KEY_LABEL, ownedSlots } from '../../game/player';
import { getEnemyDef } from '../../enemies/registry';
import { branchDef, branchMods, branchesFor, modsOf } from '../../skills/branches';
import { getSkillDef } from '../../skills/registry';
import { SKILL_FAMILY_LABEL } from '../../skills/types';
import type { SkillId } from '../../skills/types';
import { enemyIcon } from './enemyIcon';
import { applyBranchChoice, applySkillChoice, generateSkillChoices, type SkillChoice } from '../../progression/skillChoice';
import type { SkillSlot } from '../../game/types';
import type { World } from '../../game/world';
import { bindKeys, card, clearOverlay, formatTime, h, overlayEl, screen } from './dom';

/**
 * 스킬 선택 화면.
 * 공격 3칸이 차면 새 공격은 나오지 않으므로 버릴 칸을 고를 일이 없습니다.
 * 유틸은 고르는 순간 쓰던 것과 교체되고, **레벨은 그대로 이어집니다.**
 */
export function showSkillChoice(w: World, onDone: () => void): () => void {
  let choices = generateSkillChoices(w);
  let unbind: () => void = () => {};

  const finish = () => {
    unbind();
    onDone();
  };

  const renderChoices = () => {
    clearOverlay();

    // 선택지가 아예 없을 때만 넘어갈 수 있습니다. 그 외에는 반드시 하나를 골라야 합니다
    if (choices.length === 0) {
      finish();
      return;
    }

    // 카드에는 이름 · 계열 · 레벨 · 수치만 답니다. 무슨 스킬인지는 직접 써 보면서 압니다
    const rows = choices.map((c, i) => {
      const def = getSkillDef(c.id);
      // 계열은 제목에 붙입니다. 패시브가 계열 이름을 그대로 부르므로,
      // 고르는 그 순간에 "이게 무슨 계열인지"가 안 보이면 태그를 붙인 의미가 없습니다.
      // 유틸 교체도 레벨을 그대로 이어받으므로 몇 레벨이 되는지 같이 적습니다
      const family = def.family ? ` (${SKILL_FAMILY_LABEL[def.family]})` : '';
      const level = c.upgrade || c.replacesUtility ? ` Lv.${c.level}` : '';
      return card({
        key: String(i + 1),
        title: `${def.name}${family}${level}${c.replacesUtility ? '  [교체]' : ''}`,
        // 이미 고른 갈래를 반영해서 보여줍니다. 안 그러면 7레벨 카드가 갈래 전 수치를 씁니다
        price: def.levelText(c.level, branchMods(w.player.attacks.find((s) => s?.id === c.id) ?? null)),
        onClick: () => pick(c),
      });
    });

    if (w.player.rerolls > 0) {
      rows.push(card({ key: 'R', title: '다시 뽑기', price: `남은 ${w.player.rerolls}회`, onClick: reroll }));
    }

    // 건너뛰기는 상점에서 산 만큼만 쓸 수 있습니다.
    // 공짜로 두면 "무조건 하나를 고른다"는 규칙 자체가 없어집니다
    if (w.player.skips > 0) {
      rows.push(
        card({
          key: 'S',
          title: '건너뛰기',
          price: Number.isFinite(w.player.skips) ? `남은 ${w.player.skips}회` : '무제한',
          onClick: skip,
        }),
      );
    }

    // ⚠ `skill-choice` 는 `scripts/boot.ts` 가 화면을 가려내는 표식입니다.
    //    예전에는 부제 문구로 갈랐는데, 문구를 지우자 갈래 창과 구분이 안 됐습니다
    overlayEl().append(
      screen(`레벨 ${w.player.level}`, '', [h('div', { class: 'rowlist' }, rows)], 'narrow skill-choice'),
    );

    unbind();
    unbind = bindKeys((code) => {
      const idx = ['Digit1', 'Digit2', 'Digit3'].indexOf(code);
      if (idx >= 0 && choices[idx]) {
        pick(choices[idx]);
        return;
      }
      if (code === 'KeyR') reroll();
      if (code === 'KeyS') skip();
    });
  };

  const reroll = () => {
    if (w.player.rerolls <= 0) return;
    w.player.rerolls--;
    choices = generateSkillChoices(w);
    renderChoices();
  };

  const skip = () => {
    if (w.player.skips <= 0) return;
    w.player.skips--;
    finish();
  };

  const pick = (choice: SkillChoice) => {
    applySkillChoice(w, choice);
    finish();
  };

  renderChoices();
  return () => unbind();
}

/**
 * 6레벨 강화 갈래 선택 화면.
 *
 * 스킬 선택창과 달리 **리롤도 건너뛰기도 Esc 도 없습니다.** 갈래는 되돌릴 수 없는
 * 영구 선택이라 "다시 뽑기"가 성립하지 않고, 건너뛰면 6레벨 이후가 통째로 빈 채로
 * 남습니다. 난이도가 선택지 장수를 줄이는 것도 여기는 적용되지 않습니다.
 * 두 갈래 중 하나를 고르는 것이 이 화면의 전부라 한 장만 보여줄 수가 없습니다.
 */
export function showBranchChoice(w: World, id: SkillId, onDone: () => void): () => void {
  clearOverlay();
  const def = getSkillDef(id);
  const branches = branchesFor(id);
  let unbind: () => void = () => {};

  const finish = () => {
    unbind();
    onDone();
  };

  const pick = (branchId: SkillBranchId) => {
    applyBranchChoice(w, id, branchId);
    finish();
  };

  // 갈래가 없는 스킬이 여기 오면 고를 것이 없어 창이 안 닫힙니다. 그냥 넘깁니다
  if (branches.length === 0) {
    finish();
    return () => unbind();
  }

  const rows = branches.map((b, i) =>
    card({
      key: String(i + 1),
      // 1번은 언제나 강화, 2번은 언제나 특수입니다. 자리가 성격을 뜻합니다
      title: `${b.name}${i === 0 ? '  [강화]' : '  [특수]'}`,
      price: def.levelText(SKILL_BRANCH_LEVEL, modsOf(b.id as SkillBranchId)),
      onClick: () => pick(b.id as SkillBranchId),
    }),
  );

  // ⚠ `branch-choice` 는 `scripts/boot.ts` 가 이 화면을 가려내는 표식입니다
  overlayEl().append(
    screen(`${def.name} Lv.${SKILL_BRANCH_LEVEL}`, '', [h('div', { class: 'rowlist' }, rows)], 'narrow branch-choice'),
  );

  unbind = bindKeys((code) => {
    const idx = ['Digit1', 'Digit2'].indexOf(code);
    if (idx >= 0 && branches[idx]) pick(branches[idx].id as SkillBranchId);
  });

  return () => unbind();
}

/** 빌드 요약에 쓰는 이름. 갈래를 골랐으면 그 이름까지 붙입니다 */
function slotLabel(s: SkillSlot): string {
  const name = getSkillDef(s.id).name;
  const branch = branchDef(s.branch);
  return branch ? `${name}·${branch.name}` : name;
}

export function showPause(w: World, onResume: () => void, onQuit: () => void): () => void {
  clearOverlay();

  const attacks = w.player.attacks
    .map((s) => (s ? `${slotLabel(s)} Lv.${s.level}` : '-'))
    .join('   ');
  const util = w.player.utility
    ? `${getSkillDef(w.player.utility.id).name} Lv.${w.player.utility.level}`
    : '없음';
  const skills = `공격  ${attacks}      ${UTILITY_KEY_LABEL} ${util}`;

  const body = [
    h('div', { class: 'hint' }, [
      `생존 ${formatTime(w.time)} · 처치 ${w.stats.kills} · 코인 ${w.stats.coins}`,
      h('div', {}, [skills]),
    ]),
    h('div', { class: 'rowlist' }, [
      card({ key: 'Esc', title: '계속하기', onClick: onResume }),
      card({ key: 'Q', title: '포기하고 상점으로', desc: '지금까지 모은 코인은 그대로 저장됩니다', onClick: onQuit }),
    ]),
  ];

  overlayEl().append(screen('일시정지', '', body, 'narrow'));

  return bindKeys((code) => {
    if (code === 'Escape') onResume();
    if (code === 'KeyQ') onQuit();
  });
}

export function showGameOver(w: World, coinsTotal: number, onRetry: () => void, onMain: () => void): () => void {
  clearOverlay();

  const build = ownedSlots(w.player)
    .map((s) => `${slotLabel(s)} Lv.${s.level}`)
    .join(' · ');

  const coinLine =
    w.diff.coinMul > 1
      ? `획득 코인 ${w.earnedCoins()}  (주운 ${w.stats.coins} × 난이도 보상 ${w.diff.coinMul.toFixed(2)}배 · 보유 ${coinsTotal})`
      : `획득 코인 ${w.earnedCoins()}  (보유 ${coinsTotal})`;

  const body = [
    h('div', { class: 'big-num' }, [formatTime(w.time)]),
    h('div', { class: 'hint' }, [
      `처치 ${w.stats.kills} · 레벨 ${w.player.level} · 보스 ${w.stats.bossKills}${w.difficulty > 0 ? ` · 난이도 ${w.difficulty}` : ''}`,
      h('div', {}, [coinLine]),
      h('div', {}, [build ? `빌드: ${build}` : '스킬 없이 버텼습니다']),
      // 파편 처치는 보상이 없습니다. 코인을 주면 잡몹 한가운데서 일부러 죽는 것이
      // 이득이 되므로, 데려간 수만 남깁니다
      ...(w.shardKills > 0 ? [h('div', { class: 'shard-kills' }, [`마지막 파편으로 ${w.shardKills}마리를 데려갔습니다`])] : []),
    ]),
    h('div', { class: 'rowlist' }, [
      card({ key: 'Enter', title: '다시 도전', onClick: onRetry }),
      card({ key: 'Esc', title: '메인 화면으로', onClick: onMain }),
    ]),
  ];

  const el = screen('쓰러졌습니다', '', body, 'narrow');
  const killer = killerBadge(w);
  if (killer) el.append(killer);
  overlayEl().append(el);

  return bindKeys((code) => {
    if (code === 'Enter' || code === 'Space') onRetry();
    if (code === 'Escape') onMain();
  });
}

/**
 * 우측 상단에 나를 죽인 적의 생김새를 띄웁니다.
 * "왜 죽었는지 모르겠다"가 이 게임에서 가장 흔한 불만이라, 사인만큼은 확실히 알려줍니다.
 */
function killerBadge(w: World): HTMLElement | null {
  const killer = w.killedBy;
  if (!killer) return null;

  const def = getEnemyDef(killer.id);
  const name = `${killer.elite ? '정예 ' : ''}${def.name}`;

  return h('div', { class: 'killer' }, [
    h('div', { class: 'killer-label' }, ['나를 쓰러뜨린 적']),
    enemyIcon(def, 64, killer.elite),
    h('div', { class: 'killer-name' }, [name]),
  ]);
}
