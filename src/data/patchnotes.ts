/**
 * 패치로그 (2026-09-10 시작).
 *
 * **여기는 "무엇이 바뀌었나"만 적습니다.** "왜 그렇게 했나"는 `docs/기획/` 쪽이고,
 * 둘을 섞으면 이 화면이 개발 문서가 됩니다. 읽는 사람은 판을 도는 사람입니다.
 *
 * 적는 규칙입니다.
 *
 * - **개조식.** 짧게 끊고 문장으로 늘리지 않습니다
 * - **수치를 적지 않습니다.** 반경 380 이 아니라 "범위 증가"입니다. 판마다 배율이
 *   달라서 그 숫자가 화면에서 뜻을 갖지 않고, 무엇보다 다음에 손볼 때 여기까지
 *   고쳐야 합니다
 * - **화면과 문구 변경은 안 적습니다.** 플레이에 영향이 없으면 뺍니다
 * - **매번 안 씁니다.** 사용자가 "정리됐다"고 할 때 한 번에 묶습니다
 *
 * **`hardOnly` 는 반드시 지키십시오.** 하드모드는 히든 요소라, 안 연 사람에게
 * 하드 항목을 보여주면 존재를 알리게 됩니다. 잠겨 있을 때 흐린 카드로 자리를
 * 잡아두지 않는 것과 같은 문제입니다.
 */

/**
 * 한 줄의 성격 (2026-09-14 사용자 확정).
 *
 * **`+ ` 는 플레이어에게 버프(초록), `- ` 는 너프(빨강), `~ ` 는 버프도 너프도 아닌
 * 조정(노랑)입니다.** v0.2.02 부터는 모든 줄에 셋 중 하나를 붙입니다. 부호가 없는 줄은
 * 그 전 버전들이라 색 없이 `- ` 만 붙여 그립니다. 그때는 `-` 가 너프라는 뜻이 아니었으므로
 * 빨강으로 칠하면 거짓말이 됩니다.
 *
 * **올린 것과 내린 것은 `+` 와 `-` 두 줄로 나눕니다** (2026-09-14 사용자 확정). `~` 는
 * 나눌 수 없는 것, 즉 성격 자체가 바뀐 경우(분열 → 관통)에만 씁니다. 안 그러면 `~` 가
 * "애매하면 다 넣는 칸"이 되어 색이 뜻을 잃습니다
 */
export type PatchTone = 'buff' | 'nerf' | 'tweak' | 'plain';

export function lineTone(line: string): PatchTone {
  if (line.startsWith('+ ')) return 'buff';
  if (line.startsWith('- ')) return 'nerf';
  if (line.startsWith('~ ')) return 'tweak';
  return 'plain';
}

/** 부호가 반드시 붙어야 하는 첫 버전. 이 버전과 그 뒤는 `plain` 줄이 있으면 안 됩니다 */
export const TONE_SINCE = 'v0.2.02';

/** 한 묶음 (`* 스킬 변경점` 아래의 `1. 추적 미사일`) */
export interface PatchItem {
  title: string;
  lines: string[];
  /** 하드모드를 연 사람에게만 보입니다 */
  hardOnly?: boolean;
  /**
   * 일반 난이도 이 단계를 **열어야** 보입니다 (2026-09-14 사용자 확정).
   * 잠긴 난이도에 붙은 강화는 아직 모르는 사람에게 스포일러라 하드 항목처럼 가립니다.
   * 예: 난이도 15 의 무적 바보적 조정 → `unlockDifficulty: 15`
   */
  unlockDifficulty?: number;
  /** 하드 난이도 이 단계를 열어야 보입니다. 하드모드를 안 열었으면 당연히 안 보입니다 */
  unlockHardDifficulty?: number;
}

/** 패치로그를 보는 사람이 무엇을 열었는가. `SaveData` 에서 이 셋만 봅니다 */
export interface PatchViewer {
  hardUnlocked: boolean;
  maxDifficulty: number;
  maxHardDifficulty: number;
}

/** 조건이 붙어 누군가에게는 가려질 수 있는 항목인가 */
export function isGatedItem(it: PatchItem): boolean {
  return !!it.hardOnly || it.unlockDifficulty !== undefined || it.unlockHardDifficulty !== undefined;
}

/** 이 사람에게 이 항목이 보이는가. **거르는 규칙은 여기 한 곳입니다** */
export function patchItemVisible(it: PatchItem, v: PatchViewer): boolean {
  if (it.hardOnly && !v.hardUnlocked) return false;
  if (it.unlockDifficulty !== undefined && v.maxDifficulty < it.unlockDifficulty) return false;
  if (it.unlockHardDifficulty !== undefined && (!v.hardUnlocked || v.maxHardDifficulty < it.unlockHardDifficulty)) return false;
  return true;
}

/** 한 갈래 (`* 스킬 변경점`) */
export interface PatchGroup {
  title: string;
  items: PatchItem[];
}

export interface PatchNote {
  version: string;
  date: string;
  /**
   * 그 판을 한 줄로 여는 머리말. 없어도 됩니다.
   *
   * **여기까지만 문장을 씁니다.** 아래 항목은 개조식 그대로이고, 이 자리에
   * 항목마다 붙을 설명을 몰아 적기 시작하면 그때부터 패치로그가 글이 됩니다
   */
  intro?: string;
  groups: PatchGroup[];
}

/** **최신이 맨 앞입니다.** 화면이 이 순서를 그대로 씁니다 */
export const PATCH_NOTES: readonly PatchNote[] = [
  {
    version: 'v0.2.04',
    date: '2026-09-15',
    intro:
      '한 판 플레이 시간이 15분이 적당하니 더 늘리지 말라는 협박을 받았습니다. 따라서 특정 난이도부터 증가하는 클리어 시간을 없애고 모두 15분으로 통일하였습니다. 이 작업에서 밸런스에 영향이 가지않도록 적의 스펙이 더 증가하고 난이도에 비례하여 경험치가 증가합니다. 또한 코인을 추가로 조정하여 코인수급을 원할하게 만들었습니다.',
    groups: [
      {
        title: '',
        items: [
          {
            title: '코인',
            lines: [
              '- 난이도 클리어 업적의 코인 보상이 사라졌습니다.',
              '+ 난이도의 첫 클리어 코인이 증감하였습니다.',
              '+ 반복 클리어 보너스 코인이 증가했습니다.',
            ],
          },
          {
            title: '플레이어',
            lines: ['+ 난이도에 비례하여 얻는 경험치가 증가했습니다.'],
          },
          {
            title: '적',
            lines: ['- 적의 탄환이 더이상 중간에 사라지지 않습니다.'],
          },
          {
            // 무적바보적은 난이도 15 장치라 연 사람에게만 보입니다 (가리는 단위가 항목이라 적에서 뗐습니다)
            title: '무적바보적',
            unlockDifficulty: 15,
            lines: [
              '- 무적바보적의 등장 방식이 변경되었습니다.',
              '- 무적바보적이 시간에 따라 강화됩니다.',
              '- 군체왕이 무적바보적을 흡수하는 현상이 수정되었습니다.',
            ],
          },
          {
            title: '업적',
            lines: ['- "폭주"가 삭제되었습니다.'],
          },
          {
            // 두 줄 모두 난이도 3 이상에서만 겪는 변경입니다 (예전 30분 클리어 · 공격력 기울기)
            title: '난이도',
            unlockDifficulty: 3,
            lines: [
              '+ 전체 난이도의 클리어시간이 15분으로 감소했습니다.',
              '- 시간이 지날수록 더 큰폭으로 적의 공격력이 증가합니다.',
            ],
          },
        ],
      },
    ],
  },
  {
    version: 'v0.2.03',
    date: '2026-09-14',
    intro:
      '코인 수급량이 너무 적어서 난이도가 높아지면 본래의 코인드랍율로 올라갑니다. 난이도가 낮으면 그만큼 드랍이 덜되니 빠르게 등반하십쇼. 강화버전 분열적이 과하게 강하다고 판단하여 능력을 조정하였습니다.',
    groups: [
      {
        title: '',
        items: [
          {
            title: '코인',
            lines: ['+ 난이도에 비례하여 코인드랍율이 올라갑니다.'],
          },
          {
            title: '적',
            lines: [
              '+ 더이상 분열적이 여러발의 탄환을 발사하지 않습니다.',
              '- 보스의 체력이 난이도에 비례하여 대폭 증가합니다.',
            ],
          },
          {
            title: '스킬',
            lines: ['- 스나이퍼의 최대체력 비율이 감소하였습니다.'],
          },
        ],
      },
    ],
  },
  {
    version: 'v0.2.02',
    date: '2026-09-14',
    intro:
      '미라가 원래 의도보다 존나 약한 점을 수정하였습니다. 미라는 부활 직후에 서서히 죽어가지만 그대신 줠라 강합니다. 다만, 상태이상의 약하게 조정하여 약점을 추가했으니 약점을 잘 이용하시길 바랍니다. 추가로 스탯 고정의 사기성을 인지하여 대폭 너프하였으니 상점에 방문하여 변경된 점을 확인해주시길 바랍니다. 스킬도 도감에서 확인할 수 있도록 하였습니다. 야르~',
    groups: [
      {
        title: '적',
        items: [
          {
            title: '미라',
            lines: [
              '- 더이상 미라는 부활 후 느리지 않습니다.',
              '- 더이상 미라는 만만하지 않습니다.',
              '+ 부활 후 상태이상 효과를 더 오래 받습니다.',
            ],
          },
          {
            title: '스탯 고정',
            lines: ['- 칸봉인을 제거했습니다.', '- 칸이 주요 스텟1개, 부가 스텟2개만 넣을 수 있습니다.', '- 가격이 대폭 인상되었습니다.'],
          },
          {
            title: '스킬 도감',
            lines: ['+ 스킬을 낀채로 클리어 시 해당 스킬의 정보를 열람할 수 있습니다.', '- 죽으면 안보여줌ㅎ'],
          },
        ],
      },
    ],
  },
  {
    version: 'v0.2.01',
    date: '2026-09-12',
    intro:
      '코인 수급 방식에 대한 조정입니다. 기존의 막대한 코인 수급량을 조정하고 클리어 이후 버티는 것을 최소한으로 하여 수급을 막았습니다. 꼬와도 개발자 맘입니다.',
    groups: [
      {
        title: '시스템 변경점',
        items: [
          {
            title: '코인',
            lines: [
              '일반 적과 정예의 코인 드랍 확률 감소',
              '클리어 이후 코인 드랍 확률 추가 감소',
              '클리어 보너스 코인 추가 (반복 클리어 시 보너스 코인량이 감소합니다.)',
            ],
          },
          {
            title: '클리어 이후',
            lines: [
              '적 이동속도 대폭 증가',
              '적 체력, 공격력 상승폭 대폭 증가',
              '스폰량 상승폭 대폭 증가',
            ],
          },
        ],
      },
    ],
  },
  {
    version: 'v0.2.0',
    date: '2026-09-10',
    groups: [
      {
        title: '스킬 변경점',
        items: [
          {
            title: '추적 미사일',
            lines: ['분열 미사일의 분열 수 대폭 감소', '치명타 관련 버그 수정'],
          },
          {
            title: '도탄',
            lines: ['강화 방향 중 분열에서 관통으로 교체', '강화 도탄 공격력 감소'],
          },
        ],
      },
      {
        title: '시스템 변경점',
        items: [
          {
            title: '클리어',
            lines: [
              '클리어 조건을 보스 처치로 변경',
              '보스 처치 후 사망해도 클리어 인정',
              '클리어 판정 이후 적 점차 대폭 강화',
              '기존에 시간으로 깬 기록은 클리어로 인정',
            ],
          },
        ],
      },
    ],
  },
  {
    version: 'v0.1.0',
    date: '2026-09-09',
    groups: [
      {
        title: '스킬 변경점',
        items: [
          {
            title: '추적 미사일',
            lines: ['수명 증가', '수명이 다하면 그 자리에서 폭발'],
          },
          {
            title: '도탄',
            lines: ['수명 제한 삭제, 명중 횟수로만 종료'],
          },
          {
            title: '넉백 폭발',
            lines: ['체력이 모자라면 발동 안 함', '공격력 대폭 증가'],
          },
        ],
      },
      {
        title: '적 변경점',
        items: [
          {
            title: '소환적',
            lines: ['하수인 처치 가능', '하수인 처치 보상 삭제, 본체 처치 보상으로 이동'],
          },
          {
            title: '분열적',
            lines: ['분열체는 처치 수에 미포함'],
          },
          {
            title: '폭격기 (하드 4)',
            lines: ['폭격 발수와 범위 증가', '폭격이 적군에게도 피해', '터진 자리에 불이 남음'],
            hardOnly: true,
          },
        ],
      },
    ],
  },
];

/**
 * 하드 항목을 가린 버전 끝에 붙는 한 줄 (2026-09-14 사용자 확정).
 *
 * 무엇이 바뀌었는지는 안 알리고 **무언가가 있다는 것만** 흘립니다. 하드모드를 연
 * 사람에게는 원문이 그대로 보이므로 이 줄이 안 뜹니다
 */
export const HIDDEN_PATCH_HINT = '무언가가 패치되었습니다...';

/** 화면에 그릴 버전. 가려진 하드 항목이 있었는지를 같이 들고 갑니다 */
export interface VisiblePatchNote extends PatchNote {
  hiddenPatched: boolean;
}

/** 가장 최근 버전. 안 읽은 것이 있는지 판단하는 기준입니다 */
export const LATEST_PATCH = PATCH_NOTES[0].version;

/**
 * 하드 항목을 걸러낸 목록. **화면과 점검이 같은 함수를 봐야 합니다.**
 *
 * 거르는 규칙을 화면 쪽에 두면 브라우저 없이 잴 수가 없어서, 하드 항목이 새는 것을
 * 아무도 못 잡습니다. 빈 묶음은 통째로 뺍니다.
 *
 * **하드 항목을 가렸으면 `hiddenPatched` 가 켜집니다** (2026-09-14). 화면이 그 버전 끝에
 * `HIDDEN_PATCH_HINT` 를 붙입니다. 하드 항목만 있던 버전도 그 한 줄로 남습니다.
 * 빼버리면 "무언가가 패치됐다"를 알릴 자리가 없어집니다.
 */
export function visiblePatchNotes(viewer: PatchViewer): VisiblePatchNote[] {
  const out: VisiblePatchNote[] = [];
  for (const note of PATCH_NOTES) {
    const groups: PatchGroup[] = [];
    let hiddenPatched = false;
    for (const g of note.groups) {
      // 하드 항목과 **잠긴 난이도 항목**을 같은 규칙으로 가립니다 (2026-09-14)
      const items = g.items.filter((it) => patchItemVisible(it, viewer));
      if (items.length < g.items.length) hiddenPatched = true;
      if (items.length > 0) groups.push({ title: g.title, items });
    }
    // **칸을 새로 만들 때 빠뜨리기 쉽습니다.** 여기서 새 객체를 짓는 이유는 하드
    // 항목을 걸러낸 `groups` 를 갈아끼우기 위해서인데, 나머지 칸을 손으로 옮기다
    // 하나를 놓치면 그 값만 화면에서 조용히 사라집니다 (머리말이 실제로 그랬습니다)
    if (groups.length > 0 || hiddenPatched) out.push({ ...note, groups, hiddenPatched });
  }
  return out;
}
