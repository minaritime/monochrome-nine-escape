import {
  ACHIEVEMENT,
  BOSS,
  DIFFICULTY,
  ENEMY_BASE,
  ENEMY_TABLE,
  SKILL_MAX_LEVEL,
  STAT_DEFS,
  type StatKey,
} from './balance';
import { ALL_ENEMY_IDS } from '../enemies/registry';
import { eliteStatMul } from '../enemies/elite';
import { isStatRollable } from '../game/stats';
import { ownedSlots } from '../game/player';
import { clearedAllFrom, unlockTimeFor } from '../meta/difficulty';
import { purchasedCount, totalPurchasable } from '../meta/shop';
import type { SaveData } from '../meta/save';
import type { World } from '../game/world';

/**
 * 업적 목록.
 *
 * 코인 값은 `ACHIEVEMENT` 의 등급 상수에서 가져옵니다. 여기에 숫자를 직접 쓰는 것은
 * 난이도 클리어 사다리(`ACHIEVEMENT.difficultyClear`)와 단계형 업적의 목표치뿐입니다.
 * 전체 명세는 `업적.md` 에 있습니다.
 */

const A = ACHIEVEMENT;

/** 조건식이 보는 것 */
export interface AchieveCtx {
  save: SaveData;
  /** 판이 돌고 있으면 그 월드. 메뉴에서 볼 때는 null */
  w: World | null;
  /** 방금 끝난 판인가. "클리어했는가"를 묻는 업적은 이때만 참이 됩니다 */
  runEnded: boolean;
}

export interface AchieveTier {
  /** 단계형이면 이 값에 도달해야 합니다. 단발형은 없습니다 */
  goal?: number;
  coin: number;
  /**
   * 이 단계의 이름. 없으면 업적 이름을 그대로 씁니다.
   *
   * 단계마다 이름이 달라지는 업적이 있습니다 (부자 → 집주인 → 땅주인).
   * 숫자만 커지는 것보다 무엇이 되어가는지가 보입니다.
   */
  name?: string;
}

export interface AchieveDef {
  id: string;
  name: string;
  desc: string;
  /** 달성 전까지 이름과 조건을 가립니다 */
  hidden?: boolean;
  /**
   * 같은 사슬로 묶인 업적은 화면에 **다음 한 칸만** 보입니다 (`visibleAchievements`).
   * 난이도 클리어처럼 같은 모양이 열일곱 줄 늘어서면, 아직 손도 못 댄 뒤쪽까지
   * 전부 보이면서 "지금 무엇을 하면 되는가"는 오히려 안 보이게 됩니다.
   * 사슬 안의 순서는 `ACHIEVEMENTS` 에 넣은 순서입니다.
   */
  chain?: string;
  tiers: readonly AchieveTier[];
  /** 단계형: 지금 값 */
  progress?: (c: AchieveCtx) => number;
  /** 단발형: 지금 조건을 만족하는가 */
  check?: (c: AchieveCtx) => boolean;
}

// ---------------------------------------------------------------------------
// 도우미
// ---------------------------------------------------------------------------

/** 단발형 업적 한 줄 */
function one(id: string, name: string, desc: string, coin: number, check: (c: AchieveCtx) => boolean): AchieveDef {
  return { id, name, desc, tiers: [{ coin }], check };
}

/** 히든 단발형 */
function hidden(id: string, name: string, desc: string, coin: number, check: (c: AchieveCtx) => boolean): AchieveDef {
  return { ...one(id, name, desc, coin, check), hidden: true };
}

/** 단계형 업적 */
function steps(
  id: string,
  name: string,
  desc: string,
  goals: readonly number[],
  coins: readonly number[],
  progress: (c: AchieveCtx) => number,
  /** 단계마다 이름이 다른 경우에만 넘깁니다. 없으면 전부 업적 이름을 씁니다 */
  names?: readonly string[],
): AchieveDef {
  return {
    id,
    name,
    desc,
    tiers: goals.map((goal, i) => ({ goal, coin: coins[i], name: names?.[i] })),
    progress,
  };
}

/**
 * 그 단계의 이름.
 *
 * **이름을 읽는 곳은 전부 이 함수를 거쳐야 합니다.** 한 곳이라도 `def.name` 을 그대로
 * 쓰면 단계마다 이름이 다른 업적에서 화면과 알림이 서로 다른 이름을 말합니다.
 */
export function tierName(def: AchieveDef, tierIndex: number): string {
  return def.tiers[tierIndex]?.name ?? def.name;
}

/** 이번 판이 그 난이도의 요구 시간을 채웠는가 */
function clearedNow(c: AchieveCtx): boolean {
  const w = c.w;
  return !!w && c.runEnded && w.time >= unlockTimeFor(w.difficulty);
}

/**
 * 이 게임에 나오는 **모든 적 종류** 중 가장 빠른 이동속도.
 *
 * 화면에 지금 떠 있는 적만 재면 "빠른적이 마침 하나도 없는 순간"에 열립니다.
 * 그건 내가 빨라진 것이 아니라 운이 좋았던 것이라, 표에 있는 적 전부를 놓고 잽니다.
 *
 * **능력으로 순간 빨라지는 것은 안 셉니다.** 돌진적의 돌진(950)이나 겁쟁이의 돌진은
 * 이동속도가 아니라 그 적의 기술이고, 그것까지 넘으라고 하면 달성이 불가능합니다.
 *
 * **정예 배율은 셉니다.** 정예도 그 판에 나오는 적이고, 빼면 기준이 133 까지 내려가
 * 플레이어 기본 이동속도(205)만으로 시작하자마자 열립니다.
 *
 * 시간·난이도 배율은 그 판의 실제 값을 씁니다. 적이 지금 내는 속도가 기준입니다.
 */
export function fastestEnemySpeed(): number {
  let top = 0;
  for (const id of ALL_ENEMY_IDS) {
    // 시간 강화도 난이도 배율도 빼고 **표에 적힌 기본 이속**만 봅니다.
    // 시간 배율을 넣으면 기준선이 판이 갈수록 달아나서, 같은 이동속도로도
    // 1분에는 열리고 20분에는 안 열립니다. 판마다 달라지는 기준은 업적이 될 수 없습니다
    const speed = ENEMY_BASE.speed * ENEMY_TABLE[id].speed * eliteStatMul(id, true, 'speedMul');
    if (speed > top) top = speed;
  }
  return top;
}

/** 지금 든 스킬이 하나뿐인가 */
function onlyOneSkill(w: World): boolean {
  return ownedSlots(w.player).length === 1;
}

const ROLLABLE_STATS = STAT_DEFS.filter((s) => isStatRollable(s.key)).map((s) => s.key as StatKey);

// ---------------------------------------------------------------------------
// 1. 난이도 첫 클리어
// ---------------------------------------------------------------------------

const difficultyClears: AchieveDef[] = [];
for (let lv = DIFFICULTY.min; lv <= DIFFICULTY.max; lv++) {
  const coin = A.difficultyClear[lv - DIFFICULTY.min] ?? A.gold;
  difficultyClears.push({
    id: `clear${lv}`,
    name: `난이도 ${lv} 클리어`,
    desc: `난이도 ${lv} 에서 ${Math.round(unlockTimeFor(lv) / 60)}분을 버팁니다`,
    /**
     * **입문(-1)만 사슬 밖입니다.** 해금 사슬은 0 에서 시작하므로 -1 을 건너뛴 채
     * 0, 1, 2 … 를 깨는 것이 정상 경로입니다. -1 을 사슬 맨 앞에 두면 그 한 칸이
     * 안 깨진 동안 뒤쪽이 통째로 가려져서, 정작 지금 노릴 난이도가 안 보입니다.
     */
    chain: lv === DIFFICULTY.min ? undefined : 'clear',
    tiers: [{ coin }],
    // 저장에 남은 난이도별 최고 기록으로 봅니다. 예전 판도 그대로 인정됩니다
    check: (c) => (c.save.records.bestTimeByDifficulty[String(lv)] ?? 0) >= unlockTimeFor(lv),
  });
}

// ---------------------------------------------------------------------------
// 전체 목록
// ---------------------------------------------------------------------------

export const ACHIEVEMENTS: readonly AchieveDef[] = [
  ...difficultyClears,

  // --- 2. 진행형 누적 -------------------------------------------------------
  steps(
    'kills',
    '학살자',
    '적을 누적으로 처치합니다',
    [50, 200, 500, 1000, 5000, 10000],
    [20, 40, 70, 120, 250, 400],
    (c) => c.save.records.totalKills,
  ),
  steps(
    'flex',
    '플렉스',
    '상점에서 물건을 삽니다',
    [5, 10, 15, 20, 30, 50, totalPurchasable()],
    [20, 30, 50, 80, 120, 200, 400],
    (c) => purchasedCount(c.save),
  ),
  steps(
    'shard',
    '자살전략',
    '죽는 순간 흩어진 파편으로 적을 데려갑니다',
    [1, 5, 10],
    [50, 120, 250],
    (c) => c.save.achieveStats.shardKills,
  ),
  steps(
    'playtime',
    '이 시간에 공부를 했으면',
    '이 게임에 시간을 씁니다',
    [3600, 18000, 36000],
    [40, 120, 250],
    (c) => c.save.achieveStats.playTime,
  ),
  steps(
    'rich',
    '부자',
    '코인을 누적으로 벌어들입니다',
    [1000, 5000, 30000],
    [60, 200, 500],
    (c) => c.save.achieveStats.coinsEarned,
    // 단계마다 이름이 바뀝니다. 숫자만 커지는 것보다 무엇이 되어가는지가 보입니다
    ['부자', '집주인', '땅주인'],
  ),
  steps('elite', '정예 사냥꾼', '정예를 누적으로 처치합니다', [500], [200], (c) => c.save.achieveStats.eliteKills),
  steps('regular', '단골', '판을 거듭합니다', [100], [150], (c) => c.save.records.totalRuns),

  // --- 3. 기술 업적 ---------------------------------------------------------
  one(
    'shield-intact',
    '캡틴 처치법',
    '난이도 6 이상에서 방패가 멀쩡히 남은 채로 방패적을 처치합니다',
    A.gold,
    (c) => !!c.w?.track.shieldIntactKill && c.w.difficulty >= 6,
  ),
  one(
    'tank-alive',
    '게임 잘못만들었네',
    '난이도 9 이상에서 탱커 한 마리를 3분 이상 살려둡니다',
    A.gold,
    (c) =>
      !!c.w &&
      c.w.difficulty >= 9 &&
      c.w.enemies.some((e) => !e.dead && e.defId === 'tank' && c.w!.time - e.spawnTime >= 180),
  ),
  one(
    'outrun',
    '이제 무적이지?',
    '이동속도가 모든 적(정예 포함)의 기본 이속보다 20% 이상 빨라집니다',
    A.gold,
    (c) => {
      const w = c.w;
      if (!w) return false;
      const top = fastestEnemySpeed();
      return top > 0 && w.player.stats.moveSpeed >= top * 1.2;
    },
  ),
  one(
    'knockdown',
    'Nock-Down',
    '넉백이 실린 피해로 보스를 끝냅니다',
    A.gold,
    (c) => !!c.w?.track.knockbackBossKill,
  ),
  one(
    'revenge-failed',
    '복수실패',
    '난이도 3 이상에서 5분 넘게 버티고 죽었는데 파편이 한 마리도 못 데려갑니다',
    A.silver,
    (c) => !!c.w && c.runEnded && c.w.difficulty >= 3 && c.w.time >= 300 && c.w.shardKills === 0,
  ),
  one(
    'plant',
    '나는 식물로 환생할테야',
    '강화된 돌진적을 한 번도 돌진시키지 않고 처치합니다',
    A.platinum,
    (c) => !!c.w?.track.chargerNoDashKill,
  ),
  one(
    'quickdraw',
    '신속정확',
    '난이도 3 이상에서 보스를 10초 안에 처치합니다',
    A.platinum,
    (c) => !!c.w && c.w.difficulty >= 3 && c.w.track.fastestBossKill <= 10,
  ),
  one(
    'solo6',
    '난 하나만 써',
    '스킬 하나만 든 채로 난이도 6 이상을 클리어합니다',
    A.platinum,
    (c) => clearedNow(c) && c.w!.difficulty >= 6 && onlyOneSkill(c.w!),
  ),
  one(
    'solo12',
    '난 진짜 하나만 써',
    '스킬 하나만 든 채로 난이도 12 이상을 클리어합니다',
    A.legend,
    (c) => clearedNow(c) && c.w!.difficulty >= 12 && onlyOneSkill(c.w!),
  ),

  // --- 4. 이 게임 고유 메커니즘 --------------------------------------------
  one(
    'corpse-tool',
    '크리퍼는 최고야',
    '자폭적의 시체 폭발 한 번으로 5마리 이상을 정리합니다 (분열체는 안 셉니다)',
    A.gold,
    (c) => (c.w?.track.corpseBlastBest ?? 0) >= 5,
  ),
  one(
    'blink-kill',
    '아둔 토리다스',
    '은신적이 모습을 드러낸 지 0.1초 안에 처치합니다',
    A.platinum,
    (c) => !!c.w?.track.stealthRevealKill,
  ),
  {
    id: 'death-collector',
    name: '사인 수집가',
    desc: `적 ${ALL_ENEMY_IDS.length}종 전부에게 한 번씩 죽어봅니다`,
    hidden: true,
    tiers: [{ coin: A.legend }],
    check: (c) => ALL_ENEMY_IDS.every((id) => c.save.achieveStats.deathCauses.includes(id)),
  },

  // --- 5. 무피해 -----------------------------------------------------------
  one('untouched', '불가능', '5분 동안 한 대도 맞지 않습니다', A.gold, (c) => (c.w?.track.noHitBest ?? 0) >= 300),
  one(
    'perfect-hunt',
    '에이스 따운',
    '보스가 나타나서 죽을 때까지 한 대도 맞지 않습니다',
    A.platinum,
    (c) => !!c.w?.track.bossNoHitKill,
  ),
  one(
    'flawless',
    '무결점',
    '난이도 6 이상을 피해 0 으로 클리어합니다',
    A.legend,
    (c) => clearedNow(c) && c.w!.difficulty >= 6 && c.w!.stats.damageTaken === 0,
  ),

  // --- 6. 성장 -------------------------------------------------------------
  one(
    'maxed',
    '만렙',
    `스킬 하나를 Lv.${SKILL_MAX_LEVEL} 까지 올립니다`,
    A.silver,
    (c) => !!c.w && ownedSlots(c.w.player).some((s) => s.level >= SKILL_MAX_LEVEL),
  ),
  // id 를 'level70' 으로 바꿨습니다. 조건이 30 → 70 으로 통째로 달라졌는데 id 를 그대로
  // 두면, 예전에 레벨 30 으로 딴 사람이 70 에 닿은 적도 없이 달성 상태로 남습니다.
  // 저장에 남은 'level30' 키는 목록에 없는 값이라 그냥 무시됩니다 (진행도 분모는 표에서 셉니다)
  one('level70', '폭주', '한 판에 레벨 70 에 도달합니다', A.gold, (c) => (c.w?.player.level ?? 0) >= 70),
  one(
    'complete-build',
    '완성형',
    `가진 스킬을 전부 Lv.${SKILL_MAX_LEVEL} 로 채웁니다 (공격 3칸 + 유틸 1칸)`,
    A.platinum,
    (c) => {
      const w = c.w;
      if (!w) return false;
      const slots = ownedSlots(w.player);
      return slots.length === 4 && slots.every((s) => s.level >= SKILL_MAX_LEVEL);
    },
  ),

  // --- 7. 히든 -------------------------------------------------------------
  hidden('mouse', '마우스 조작은 안해요', '게임 중에 화면을 클릭합니다', 100, (c) => !!c.w?.track.mouseClicked),
  hidden('konami', '치트는 없다', '상점에서 코나미 코드를 입력합니다', 100, () => false),
  hidden(
    'hasty',
    '성급함',
    '시작 10초 안에 죽습니다',
    100,
    (c) => !!c.w && c.runEnded && !c.w.player.alive && c.w.time <= 10,
  ),
  hidden(
    'novice',
    '입문인데요',
    `난이도 ${DIFFICULTY.min} 에서 죽습니다`,
    100,
    (c) => !!c.w && c.runEnded && !c.w.player.alive && c.w.difficulty === DIFFICULTY.min,
  ),
  hidden('shard-boss', '그래도 해봤다', '죽는 순간 흩어진 파편을 보스에 맞힙니다', 100, (c) => !!c.w?.track.shardHitBoss),
  hidden(
    'own-blast',
    '자업자득',
    '내가 잡은 자폭적의 시체 폭발에 내가 죽습니다',
    100,
    (c) => !!c.w?.track.diedToOwnCorpseBlast,
  ),
  hidden(
    'partner',
    '넌 내 반려자다',
    '보스를 못 잡아서 화면에 둘 이상이 겹칩니다',
    200,
    (c) => (c.w?.bossesAlive ?? 0) >= 2,
  ),
  hidden(
    'unlucky',
    '운이 없는 건가?',
    '클리어할 때까지 한 번도 안 오른 스탯이 있습니다',
    200,
    (c) => clearedNow(c) && ROLLABLE_STATS.some((k) => !c.w!.track.statGains.has(k)),
  ),
  hidden(
    'no-insurance',
    '보험 미사용',
    '부활을 사두고 한 번도 쓰지 않은 채 클리어합니다',
    200,
    (c) => clearedNow(c) && (c.save.perm.revive ?? 0) > 0 && c.w!.track.revivesUsed === 0,
  ),
  hidden(
    'redlight',
    '무궁화 꽃이 피고 있는 듯한 느낌',
    '첫 보스가 나올 때까지 한 발짝도 움직이지 않습니다',
    350,
    (c) => !!c.w && !c.w.track.moved && c.w.time >= BOSS.interval,
  ),
  hidden(
    'all-clear',
    '완주',
    `난이도 ${DIFFICULTY.min} 부터 ${DIFFICULTY.max} 까지 전부 클리어합니다`,
    600,
    // **입문(-1)까지 포함한 완전 제패입니다.** 하드모드 해금(`clearedAllFrom(save, 0)`)과
    // 시작점이 다르므로 같은 함수에 범위를 달리 넘깁니다
    (c) => clearedAllFrom(c.save, DIFFICULTY.min),
  ),
];

export function achievementById(id: string): AchieveDef | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}
