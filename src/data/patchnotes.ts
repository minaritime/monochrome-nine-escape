/**
 * 패치로그 (2026-09-10 시작).
 *
 * **여기는 "무엇이 바뀌었나"만 적습니다.** "왜 그렇게 했나"는 `CLAUDE.md` 쪽이고,
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

/** 한 묶음 (`* 스킬 변경점` 아래의 `1. 추적 미사일`) */
export interface PatchItem {
  title: string;
  lines: string[];
  /** 하드모드를 연 사람에게만 보입니다 */
  hardOnly?: boolean;
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

/** 가장 최근 버전. 안 읽은 것이 있는지 판단하는 기준입니다 */
export const LATEST_PATCH = PATCH_NOTES[0].version;

/**
 * 하드 항목을 걸러낸 목록. **화면과 점검이 같은 함수를 봐야 합니다.**
 *
 * 거르는 규칙을 화면 쪽에 두면 브라우저 없이 잴 수가 없어서, 하드 항목이 새는 것을
 * 아무도 못 잡습니다. 빈 묶음과 빈 버전은 통째로 뺍니다.
 */
export function visiblePatchNotes(hardUnlocked: boolean): PatchNote[] {
  const out: PatchNote[] = [];
  for (const note of PATCH_NOTES) {
    const groups: PatchGroup[] = [];
    for (const g of note.groups) {
      const items = g.items.filter((it) => !it.hardOnly || hardUnlocked);
      if (items.length > 0) groups.push({ title: g.title, items });
    }
    // **칸을 새로 만들 때 빠뜨리기 쉽습니다.** 여기서 새 객체를 짓는 이유는 하드
    // 항목을 걸러낸 `groups` 를 갈아끼우기 위해서인데, 나머지 칸을 손으로 옮기다
    // 하나를 놓치면 그 값만 화면에서 조용히 사라집니다 (머리말이 실제로 그랬습니다)
    if (groups.length > 0) out.push({ ...note, groups });
  }
  return out;
}
