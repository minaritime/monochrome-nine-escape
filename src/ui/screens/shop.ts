import {
  ARMS_UPGRADE,
  PERM_MAX_LEVEL,
  PERM_UPGRADES,
  REROLL_UPGRADE,
  REVIVE_UPGRADE,
  SKIP_UPGRADE,
  START_SKILL_LEVEL_UPGRADE,
  STAT_DEFS,
  PASSIVE,
  STAT_GAINS_PER_LEVEL,
  XP_UPGRADE,
  type PermUpgradeDef,
} from '../../data/balance';
import { passiveChancePercent } from '../../progression/levelup';
import { formatGain } from '../../game/stats';
import { saveGame, type SaveData } from '../../meta/save';
import {
  attackSlotCount,
  buyPassive,
  buyPerm,
  buySeal,
  equippedStartCount,
  isPassiveUnlocked,
  isSkipUnlimited,
  isStartSkillUnlocked,
  nextSealCost,
  openSlots,
  passiveCost,
  passiveKeys,
  maxStartFor,
  permLevel,
  permMaxLevel,
  permNextCost,
  sealedSlots,
  setSealed,
  startSkillCost,
  startSkillLevel,
  togglePassive,
  toggleStartSkill,
  buyStartSkill,
  xpMultiplier,
} from '../../meta/shop';
import { UTILITY_KEY_LABEL } from '../../game/player';
import { ATTACK_SKILL_IDS, UTILITY_SKILL_IDS, getSkillDef } from '../../skills/registry';
import { SKILL_FAMILY_LABEL } from '../../skills/types';
import { bindKeys, card, clearOverlay, h, helpDot, overlayEl, screen } from './dom';

type Tab = 'perm' | 'passive' | 'attack' | 'utility' | 'hard';

/**
 * 탭 차례. **하드 탭은 하드모드를 한 번 켠 뒤에만 목록에 들어갑니다.**
 * 잠겨 있을 때 흐린 탭으로 자리를 잡아두지 않습니다. 그러면 히든이 아니라
 * "아직 못 여는 것"이 되어, 있는 줄 알고 조건을 찾게 됩니다 (하드모드 스위치와 같은 규칙).
 */
function tabOrder(save: SaveData): Tab[] {
  const tabs: Tab[] = ['perm', 'passive', 'attack', 'utility'];
  if (save.hardUnlocked) tabs.push('hard');
  return tabs;
}

const TAB_LABEL: Record<Tab, string> = {
  perm: '스탯 강화',
  passive: '스탯 고정',
  attack: '공격 스킬',
  utility: '유틸 스킬',
  hard: '심연',
};

/**
 * 탭이 무엇을 파는 자리인지.
 *
 * 예전에는 목록 아래 꼬리말로 늘 펼쳐져 있었습니다. 한 번 읽으면 다시 볼 일이 없는
 * 글이라 탭 줄 오른쪽 `?` 안으로 접었고, 처음 들어온 사람에게만 한 번 펼쳐 보입니다.
 *
 * **스탯 고정의 확률은 반드시 여기에 남습니다.** 카드마다 `18%` 가 적혀 있는데 그 숫자가
 * 어디서 나왔는지는 이 글에만 있습니다. 예전 가중치 상점이 폐기된 이유가 정확히
 * "산 값과 실제 값이 다른데 계산을 보여줄 수 없다" 였습니다.
 */
function tabHelp(tab: Tab, save: SaveData): string[] {
  switch (tab) {
    case 'perm': {
      const lines = [
        '코인으로 스탯 기본값을 영구히 올립니다. 다음 판부터 바로 적용됩니다.',
        '부활 · 다시 뽑기 · 건너뛰기도 여기서 삽니다.',
      ];
      if (save.hardUnlocked) {
        lines.push(
          `${PERM_MAX_LEVEL}단계 위로는 한 단계가 두 배씩 오릅니다. 하드모드를 열어야 살 수 있습니다.`,
        );
      }
      return lines;
    }
    case 'passive': {
      const open = openSlots(save);
      return [
        `레벨업마다 서로 다른 스탯 ${STAT_GAINS_PER_LEVEL}개가 오릅니다.`,
        `그중 첫 칸만 ${Math.round(PASSIVE.chance * 100)}% 확률로 여기 끼운 스탯에서 뽑고, 나머지는 언제나 무작위입니다.`,
        `지금은 칸이 ${open}개라 낀 스탯 하나마다 ${Math.round((PASSIVE.chance / open) * 100)}% 입니다. 안 쓸 칸은 봉인해야 그 몫이 남은 칸으로 몰립니다.`,
      ];
    }
    case 'attack': {
      const lv = startSkillLevel(save);
      return [
        `판을 시작할 때 들고 있을 공격 스킬입니다. ${lv}레벨로 시작합니다.`,
        `여기서 ${maxStartFor(save, 'attack')}개까지 장착하고, 판 안에서는 ${attackSlotCount(save)}칸까지 모읍니다.`,
      ];
    }
    case 'utility':
      return [
        `${UTILITY_KEY_LABEL} 로 직접 쓰는 스킬입니다. 판 안에서도 1칸뿐이라 새로 고르면 교체됩니다.`,
        '공격과 주머니가 따로라 끼워도 공격 칸이 줄지 않습니다.',
      ];
    case 'hard':
      return [
        '하드모드를 연 사람에게만 열리는 자리입니다.',
        '경험치와 시작 스킬 숙련은 일반 판에도 그대로 적용됩니다.',
        '무장 확장만 하드에서만 듣습니다. 하드는 시작 장착이 1칸으로 깎인 채 시작합니다.',
      ];
  }
}

/**
 * 상점.
 *
 * `onChange` 는 무언가를 산 직후, **화면을 다시 그리기 전에** 불립니다.
 * 업적 판정이 여기 붙습니다. 판정이 다시 그리기 뒤로 가면 방금 받은 보상이
 * 화면의 코인에 안 잡혀서, 상점을 나갔다 들어와야 맞는 숫자가 보입니다.
 */
export function showShop(save: SaveData, onBack: () => void, onChange?: () => void): () => void {
  let tab: Tab = 'perm';
  /** 첫 방문 도움말이 지금 떠 있는가. Esc 는 이걸 먼저 닫습니다 */
  let intro = !save.shopHelpSeen;

  const closeIntro = () => {
    intro = false;
    save.shopHelpSeen = true;
    saveGame(save);
    render();
  };

  /**
   * 구매하면 화면을 통째로 다시 그리므로 스크롤이 맨 위로 돌아갑니다.
   * 목록 아래쪽 항목을 연달아 사려면 매번 다시 내려야 해서, 산 자리를 그대로 둡니다.
   * 탭을 바꿀 때는 다른 목록이라 맨 위에서 시작하는 것이 맞습니다.
   */
  const render = (keepScroll = false) => {
    const kept = keepScroll ? scrollTopOf() : 0;
    clearOverlay();

    const refresh = () => {
      onChange?.();
      render(true);
    };

    // 지금 탭의 설명은 탭 줄 오른쪽 끝 `?` 안에 접혀 있습니다
    const tabs = h('div', { class: 'tabs' }, [
      ...tabOrder(save).map((t) =>
        tabButton(TAB_LABEL[t], tab === t, () => {
          tab = t;
          render();
        }),
      ),
      helpDot(tabHelp(tab, save), 'tabs-help'),
    ]);

    const top = h('div', { class: 'topbar' }, [h('div', { class: 'coins' }, [`코인 ${save.coins}`])]);

    const body =
      tab === 'perm'
        ? permTab(save, refresh)
        : tab === 'passive'
          ? passiveTab(save, refresh)
          : tab === 'hard'
            ? hardTab(save, refresh)
            : skillTab(save, refresh, tab === 'attack' ? 'attack' : 'utility');

    overlayEl().append(screen('상점', '', [top, tabs, body], '', onBack));

    if (kept > 0) {
      const el = scrollEl();
      // 목록이 짧아졌으면(상한 도달로 항목이 빠졌으면) 가능한 만큼만 내려갑니다
      if (el) el.scrollTop = Math.min(kept, el.scrollHeight - el.clientHeight);
    }

    // 도움말은 상점 **위에 뜨는 대화상자**입니다. 상점 안에 끼워 넣으면 탭과 목록이
    // 아래로 밀려서 첫 화면의 짜임이 통째로 달라 보입니다. 뒷배경이 상점을 덮으므로
    // 닫기 전에는 아무것도 누를 수 없습니다
    if (intro) overlayEl().append(introDialog(save, closeIntro));
  };

  render();

  return bindKeys((code) => {
    if (code === 'Escape' || code === 'Backspace') {
      // 도움말이 떠 있으면 그것부터 닫습니다. 안 그러면 처음 들어온 사람이
      // Esc 한 번에 상점 밖으로 튕겨 나가면서 도움말도 읽은 것으로 처리됩니다
      if (intro) {
        closeIntro();
        return;
      }
      onBack();
    }
  });
}

/**
 * 첫 방문에만 뜨는 도움말 대화상자. 탭 넷이 각각 무엇을 파는 자리인지 한 번에 폅니다.
 *
 * 상점 화면 **위에** 뜹니다. 목록 안에 끼워 넣으면 탭과 카드가 아래로 밀려서
 * 처음 본 사람에게는 그것이 상점의 원래 모습으로 보입니다.
 *
 * 닫으면 저장에 남아 다시 뜨지 않습니다 (`SaveData.shopHelpSeen`).
 * 그 뒤로는 탭 줄 오른쪽 `?` 가 같은 글을 탭마다 나눠서 보여줍니다.
 */
function introDialog(save: SaveData, onClose: () => void): HTMLElement {
  const rows = tabOrder(save).map((t) =>
    h('div', { class: 'shop-intro-row' }, [
      h('b', {}, [TAB_LABEL[t]]),
      h('span', {}, [tabHelp(t, save).join(' ')]),
    ]),
  );

  const box = h('div', { class: 'shop-intro', role: 'dialog', 'aria-modal': 'true' }, [
    h('h2', {}, ['상점']),
    ...rows,
    h('button', { class: 'shop-intro-close', type: 'button', onclick: onClose }, ['확인']),
  ]);

  // 뒷배경이 상점을 덮어서 클릭을 막습니다. 실수로 닫히지 않도록 배경 클릭에는
  // 닫기를 붙이지 않았습니다. 닫는 길은 확인 버튼과 Esc 둘뿐입니다
  return h('div', { class: 'modal-back' }, [box]);
}

/** 실제로 스크롤되는 칸 (screen 안쪽의 본문) */
function scrollEl(): HTMLElement | null {
  return overlayEl().querySelector('.screen-body');
}

function scrollTopOf(): number {
  return scrollEl()?.scrollTop ?? 0;
}

function tabButton(label: string, active: boolean, onClick: () => void): HTMLElement {
  return h('button', { class: `tab${active ? ' active' : ''}`, onclick: onClick }, [label]);
}

function permTab(save: SaveData, refresh: () => void): HTMLElement {
  const rows: Node[] = [];

  for (const up of PERM_UPGRADES) {
    const lv = permLevel(save, up.key);
    const max = permMaxLevel(save, up.key);
    const cost = permNextCost(save, up.key);
    // 21단계부터는 한 단계가 두 배씩 오릅니다. 같은 카드가 이어지는 것이라 뱃지로만
    // 갈라 보이고, 설명도 그때의 상승량으로 바뀝니다
    const inHard = lv >= PERM_MAX_LEVEL;
    rows.push(
      card({
        title: `${up.name}  ${lv}/${max}`,
        desc: inHard ? hardStepDesc(up) : up.desc,
        hard: inHard,
        price: cost === null ? '최대' : `${cost} 코인`,
        disabled: cost === null || save.coins < cost,
        onClick: () => {
          if (buyPerm(save, up.key)) {
            saveGame(save);
            refresh();
          }
        },
      }),
    );
  }

  for (const special of [REVIVE_UPGRADE, REROLL_UPGRADE, SKIP_UPGRADE]) {
    const lv = permLevel(save, special.key);
    const cost = permNextCost(save, special.key);
    // 건너뛰기 마지막 단계는 횟수가 아니라 무제한이라 단계 표시로는 뜻이 안 드러납니다
    const unlimited = special.key === SKIP_UPGRADE.key && isSkipUnlimited(save);
    rows.push(
      card({
        title: `${special.name}  ${unlimited ? '무제한' : `${lv}/${special.costs.length}`}`,
        desc: special.desc,
        price: cost === null ? '최대' : `${cost} 코인`,
        disabled: cost === null || save.coins < cost,
        onClick: () => {
          if (buyPerm(save, special.key)) {
            saveGame(save);
            refresh();
          }
        },
      }),
    );
  }

  return h('div', { class: 'rowlist' }, rows);
}

/**
 * 하드 구간에 들어간 스탯 카드의 설명.
 *
 * `desc` 의 끝에 붙은 상승량만 `hardStep` 으로 갈아끼웁니다. 항목마다 하드용 문구를
 * 따로 적어두면 값을 고칠 때 한쪽만 고쳐서 화면이 거짓말을 합니다.
 * 형태가 안 맞으면 원본이 그대로 나오므로, `scripts/smoke.ts` 가 실제로 바뀌는지 잽니다.
 */
function hardStepDesc(up: PermUpgradeDef): string {
  return up.desc.replace(/\+[\d.]+%?$/, formatGain(up.stat, up.hardStep));
}

/**
 * 하드모드 상점 ("심연").
 *
 * 셋 중 둘(경험치 · 시작 스킬 숙련)은 일반 판에도 적용되고 무장 확장만 하드 전용입니다.
 * 그 사실은 탭 줄의 `?` 한 곳에만 적습니다 (`tabHelp`).
 */
function hardTab(save: SaveData, refresh: () => void): HTMLElement {
  const rows: Node[] = [];

  const row = (key: string, name: string, desc: string, max: number) => {
    const lv = permLevel(save, key);
    const cost = permNextCost(save, key);
    rows.push(
      card({
        title: `${name}  ${lv}/${max}`,
        desc,
        hard: true,
        price: cost === null ? '최대' : `${cost} 코인`,
        disabled: cost === null || save.coins < cost,
        onClick: () => {
          if (buyPerm(save, key)) {
            saveGame(save);
            refresh();
          }
        },
      }),
    );
  };

  row(
    XP_UPGRADE.key,
    XP_UPGRADE.name,
    `${XP_UPGRADE.desc} · 지금 x${xpMultiplier(save).toFixed(2)}`,
    XP_UPGRADE.costs.length,
  );
  row(
    START_SKILL_LEVEL_UPGRADE.key,
    START_SKILL_LEVEL_UPGRADE.name,
    `${START_SKILL_LEVEL_UPGRADE.desc} · 지금 Lv.${startSkillLevel(save)}`,
    START_SKILL_LEVEL_UPGRADE.costs.length,
  );

  // 무장 확장은 단계마다 늘어나는 것이 달라서(장착 / 슬롯) 지금 값을 그대로 적습니다
  const armsLv = Math.min(permLevel(save, ARMS_UPGRADE.key), ARMS_UPGRADE.costs.length);
  row(
    ARMS_UPGRADE.key,
    ARMS_UPGRADE.name,
    `하드에서 시작 장착 ${ARMS_UPGRADE.startAttacks[armsLv]}칸 · 공격 슬롯 ${ARMS_UPGRADE.slots[armsLv]}칸`,
    ARMS_UPGRADE.costs.length,
  );

  return h('div', { class: 'rowlist' }, rows);
}

/**
 * 성장 패시브 탭.
 *
 * 화면에는 **실제 확률만** 적습니다. 예전 가중치 상점이 못 쓰게 된 이유가
 * "산 +15%p 와 실제 +13.0%p 가 다르다" 였으므로, 여기서는 `passiveChancePercent` 가
 * 내는 값을 그대로 보여줍니다. 계산해서 보여줄 수 없는 시스템은 만들지 마십시오.
 */
function passiveTab(save: SaveData, refresh: () => void): HTMLElement {
  const rows: Node[] = [];
  const open = openSlots(save);
  const sealed = sealedSlots(save);

  // --- 칸 ---
  for (let i = 0; i < PASSIVE.slots; i++) {
    const isSealed = i >= open;
    const key = save.equippedPassives[i];
    const def = key ? STAT_DEFS.find((d) => d.key === key) : null;
    rows.push(
      card({
        info: true,
        // 칸은 제목 한 줄이 전부입니다. 그 `18%` 가 무엇의 확률이고 빈 칸과 봉인이
        // 무슨 뜻인지는 탭 줄의 `?` 한 곳에만 둡니다 (`tabHelp`)
        title: `${i + 1}번 칸  ${isSealed ? '[봉인됨]' : def ? `${def.name}  ${passiveChancePercent(save, def.key).toFixed(0)}%` : '비어 있음'}`,
      }),
    );
  }

  // --- 봉인 ---
  const sealCost = nextSealCost(save);
  const maxSeal = Math.min(PASSIVE.sealCosts.length, PASSIVE.slots - 1);
  if (sealCost !== null) {
    rows.push(
      card({
        title: `봉인 구매  (${save.sealsOwned} / ${maxSeal})`,
        desc: '칸 하나를 잠급니다',
        price: `${sealCost} 코인`,
        disabled: save.coins < sealCost,
        onClick: () => {
          if (buySeal(save)) {
            saveGame(save);
            refresh();
          }
        },
      }),
    );
  }
  if (save.sealsOwned > 0) {
    for (let n = 0; n <= Math.min(save.sealsOwned, maxSeal); n++) {
      const openIfN = PASSIVE.slots - n;
      rows.push(
        card({
          title: `${n === 0 ? '봉인 해제' : `${n}칸 봉인`}${sealed === n ? '  [적용 중]' : ''}`,
          desc: `칸 ${openIfN}개 · 칸당 ${Math.round((PASSIVE.chance / openIfN) * 100)}%`,
          price: sealed === n ? '적용 중' : '적용',
          disabled: sealed === n,
          onClick: () => {
            if (setSealed(save, n)) {
              saveGame(save);
              refresh();
            }
          },
        }),
      );
    }
  }

  // --- 패시브 ---
  for (const key of passiveKeys()) {
    const def = STAT_DEFS.find((d) => d.key === key)!;
    const unlocked = isPassiveUnlocked(save, key);
    const cost = passiveCost(key);
    const slot = save.equippedPassives.indexOf(key);
    const equipped = slot >= 0 && slot < open;
    const capText = def.cap !== undefined ? ` · 상한 ${def.cap}` : '';

    rows.push(
      card({
        title: `${def.name}${equipped ? `  [${slot + 1}번 칸]` : ''}`,
        // 낀 것에는 설명을 안 답니다. 이미 고른 것을 매번 다시 읽을 이유가 없고,
        // 위쪽 칸 목록과 아래쪽 목록에 같은 스탯이 두 번 나오는데 설명까지 붙으면
        // 무엇이 지금 낀 것인지가 글에 묻힙니다
        desc: equipped ? undefined : `${def.major ? '주요' : '부가'} 스탯 · ${def.desc}${capText}`,
        price: unlocked ? (equipped ? '빼기' : '끼우기') : `${cost} 코인`,
        // 아직 안 산 것은 "잠긴 것"이 아니라 "파는 것"입니다 (시작 스킬 탭과 같은 규칙)
        disabled: !unlocked && save.coins < cost,
        onClick: () => {
          if (!unlocked) {
            if (buyPassive(save, key)) {
              saveGame(save);
              refresh();
            }
            return;
          }
          // 낀 것을 다시 누르면 빠지고, 안 낀 것은 첫 빈 칸에 들어갑니다
          const target = equipped ? slot : save.equippedPassives.slice(0, open).indexOf(null);
          if (target < 0) return;
          if (togglePassive(save, target, key)) {
            saveGame(save);
            refresh();
          }
        },
      }),
    );
  }

  // 확률 설명은 탭 줄의 `?` 로 옮겼습니다 (`tabHelp`)
  return h('div', { class: 'rowlist' }, rows);
}

/**
 * 시작 스킬 탭. 공격과 유틸을 **다른 탭으로** 나눠서 같은 함수로 그립니다.
 *
 * 한 목록에 섞어 놓으면 "둘이 같은 칸을 다툰다"로 읽힙니다. 실제로는 주머니가
 * 따로라(`MAX_START_ATTACKS` / `MAX_START_UTILITIES`) 유틸을 끼워도 공격 칸이 안 줄어듭니다.
 */
function skillTab(save: SaveData, refresh: () => void, kind: 'attack' | 'utility'): HTMLElement {
  const rows: Node[] = [];
  const ids = kind === 'attack' ? ATTACK_SKILL_IDS : UTILITY_SKILL_IDS;
  const max = maxStartFor(save, kind);
  const worn = equippedStartCount(save, kind);

  for (const id of ids) {
    const def = getSkillDef(id);
    const unlocked = isStartSkillUnlocked(save, id);
    const equipped = save.equippedStartSkills.includes(id);
    const cost = startSkillCost(id);
    // 칸이 다 찼으면 "장착"을 눌러도 아무 일이 안 일어납니다. 그 사실을 값에 적습니다
    const full = !equipped && worn >= max;

    rows.push(
      card({
        // 계열은 패시브가 그대로 부르는 이름이라 제목에 남깁니다.
        // 스킬이 무엇을 하는지는 안 적습니다. 사기 전에 이미 판에서 겪어보고 오는 자리라,
        // 처음 보는 것을 설명해야 하는 화면이 아닙니다
        title: `${def.name}${def.family ? ` (${SKILL_FAMILY_LABEL[def.family]})` : ''}${equipped ? '  [장착]' : ''}`,
        price: unlocked ? (equipped ? '해제' : full ? '칸 없음' : '장착') : `${cost} 코인`,
        // 아직 안 산 스킬은 "잠긴 것"이 아니라 "파는 것"입니다.
        // locked 를 걸면 코인이 충분해도 흐려져서 못 사는 항목처럼 보입니다.
        // 살 수 있는지는 disabled 하나로만 판단합니다
        disabled: unlocked ? full : save.coins < cost,
        onClick: () => {
          if (!unlocked) {
            if (buyStartSkill(save, id)) {
              saveGame(save);
              refresh();
            }
            return;
          }
          if (toggleStartSkill(save, id)) {
            saveGame(save);
            refresh();
          }
        },
      }),
    );
  }

  // 규칙 설명은 탭 줄의 `?` 로 옮겼습니다 (`tabHelp`). 여기 남는 것은 지금 값뿐입니다
  const wornLine = h('div', { class: 'hint' }, [`장착 ${worn} / ${max}`]);

  return h('div', {}, [h('div', { class: 'rowlist' }, rows), wornLine]);
}
