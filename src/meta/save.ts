import { DIFFICULTY, PASSIVE, SKILLS, STAT_DEFS, type StatKey } from '../data/balance';
import type { SkillId } from '../skills/types';

const STORAGE_KEY = 'dodge-game-save';
const VERSION = 1;

export interface BestiaryEntry {
  seen: boolean;
  kills: number;
}

export interface Records {
  bestTime: number;
  bestKills: number;
  bestLevel: number;
  bestBuild: SkillId[];
  totalRuns: number;
  totalKills: number;
  /** 난이도별 최고 생존 시간. key 는 난이도 숫자 */
  bestTimeByDifficulty: Record<string, number>;
}

/**
 * 업적 판정에 필요한데 다른 곳에서는 안 세는 누적값.
 *
 * `records` 에 이미 있는 것(총 처치, 총 판 수, 난이도별 최고 기록)은 여기 넣지 않습니다.
 * 같은 값을 두 곳에서 세면 반드시 갈라집니다.
 */
export interface AchieveStats {
  /** 누적 플레이 시간(초) */
  playTime: number;
  /** 지금까지 판에서 벌어온 코인 총액 (쓴 것과 무관하게 누적) */
  coinsEarned: number;
  /** 누적 정예 처치 */
  eliteKills: number;
  /** 누적 파편 처치 */
  shardKills: number;
  /** 나를 죽여본 적의 종류 (사인 수집가) */
  deathCauses: string[];
}

export interface SaveData {
  version: number;
  coins: number;
  /** 영구 강화 단계. key 는 PERM_UPGRADES 의 key (+ 'revive') */
  perm: Record<string, number>;
  /** 코인으로 해금한 성장 패시브 (스탯 키). 해금해야 칸에 장착할 수 있습니다 */
  unlockedPassives: StatKey[];
  /**
   * 패시브 칸 (`PASSIVE.slots` 개). 빈 칸은 null 입니다.
   *
   * **빈 칸도 지정 추첨에 참여하고 그 몫은 그냥 흘러갑니다.** 그래서 안 쓸 칸은
   * 봉인해야 이득입니다 (`PASSIVE` 주석 참고). 배열 길이는 항상 `PASSIVE.slots` 입니다.
   */
  equippedPassives: (StatKey | null)[];
  /** 사 둔 봉인 개수 (0 ~ PASSIVE.sealCosts.length) */
  sealsOwned: number;
  /** 지금 실제로 봉인해 둔 칸 수 (0 ~ sealsOwned). 산 뒤에도 켜고 끌 수 있습니다 */
  sealedSlots: number;
  unlockedStartSkills: SkillId[];
  equippedStartSkills: SkillId[];
  bestiary: Record<string, BestiaryEntry>;
  records: Records;
  /** 업적 id → 달성한 단계 수. 단계가 없는 업적은 1 입니다 */
  achievements: Record<string, number>;
  achieveStats: AchieveStats;
  /**
   * 고를 수 있는 최고 난이도.
   * 난이도 N 으로 15분을 버티면 N+1 이 열립니다. 0 이면 아직 난이도 선택이 안 열린 상태입니다.
   */
  maxDifficulty: number;
  /**
   * 마지막으로 시작한 난이도. 다음에 켤 때 다이얼이 그 자리에서 시작합니다.
   *
   * 난이도 10 을 파고 있는 사람이 매번 0 부터 화살표를 열 번 누르게 두면,
   * 그 열 번이 판마다 붙습니다. **`maxDifficulty` 와는 다른 값입니다.**
   * 저건 "어디까지 열렸는가"고 이건 "직전에 무엇을 골랐는가"라, 낮은 난이도로
   * 내려가서 논 다음에도 그 자리에서 이어집니다.
   */
  lastDifficulty: number;
  /**
   * 상점 첫 방문 도움말을 이미 닫았는가.
   *
   * 탭 넷이 각각 무엇을 파는지는 처음 한 번만 알면 되는 정보라, 늘 펼쳐두지 않고
   * 첫 방문에만 띄웁니다. 그 뒤로는 탭 줄 오른쪽 `?` 로 언제든 다시 볼 수 있습니다.
   */
  shopHelpSeen: boolean;
}

export function emptySave(): SaveData {
  return {
    version: VERSION,
    coins: 0,
    perm: {},
    unlockedPassives: [],
    equippedPassives: new Array(PASSIVE.slots).fill(null),
    sealsOwned: 0,
    sealedSlots: 0,
    unlockedStartSkills: [],
    equippedStartSkills: [],
    bestiary: {},
    records: {
      bestTime: 0,
      bestKills: 0,
      bestLevel: 0,
      bestBuild: [],
      totalRuns: 0,
      totalKills: 0,
      bestTimeByDifficulty: {},
    },
    achievements: {},
    achieveStats: emptyAchieveStats(),
    maxDifficulty: 0,
    lastDifficulty: 0,
    shopHelpSeen: false,
  };
}

export function emptyAchieveStats(): AchieveStats {
  return { playTime: 0, coinsEarned: 0, eliteKills: 0, shardKills: 0, deathCauses: [] };
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptySave();
    const parsed = JSON.parse(raw) as Partial<SaveData>;
    return migrate(parsed);
  } catch {
    // 저장 데이터가 깨졌으면 조용히 새로 시작합니다 (게임을 못 켜는 것보다 낫습니다)
    return emptySave();
  }
}

export function saveGame(data: SaveData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // 저장 실패는 치명적이지 않으므로 진행을 막지 않습니다
  }
}

/**
 * 이미 파싱된 객체를 저장 데이터로 읽어들입니다.
 * `loadSave` 는 localStorage 를 타므로 브라우저 없는 점검(`scripts/smoke.ts`)에서 못 씁니다.
 */
export function fromJSON(parsed: unknown): SaveData {
  return migrate(isRecord(parsed) ? (parsed as Partial<SaveData>) : {});
}

export function resetSave(): SaveData {
  const fresh = emptySave();
  saveGame(fresh);
  return fresh;
}

/**
 * 예전 가중치 상점에 쓴 코인을 되돌려 줍니다 (2026-08-12).
 *
 * 가중치 시스템을 통째로 걷어냈으므로, 환불을 안 하면 이미 쓴 코인이 그냥 증발합니다.
 * 예전 값(주요 1%p / 30코인, 부가 2%p / 16코인)으로 되계산합니다. 이 함수는 옛 저장을
 * 한 번 읽어 올릴 때만 쓰이므로, 그 시절 상수를 여기에 박아둔 것이 맞습니다.
 * `balance.ts` 에서 지운 값을 다시 살려두면 지금 시스템이 그것을 참조하게 됩니다.
 */
const OLD_WEIGHT_COST = { majorStep: 1, majorCost: 30, minorStep: 2, minorCost: 16 } as const;

function refundOldWeights(weights: unknown): number {
  if (!isRecord(weights)) return 0;
  let coins = 0;
  for (const def of STAT_DEFS) {
    const points = weights[def.key];
    if (typeof points !== 'number' || !Number.isFinite(points) || points <= 0) continue;
    const step = def.major ? OLD_WEIGHT_COST.majorStep : OLD_WEIGHT_COST.minorStep;
    const cost = def.major ? OLD_WEIGHT_COST.majorCost : OLD_WEIGHT_COST.minorCost;
    coins += Math.round(points / step) * cost;
  }
  return coins;
}

/**
 * 지금 표에 있는 스킬만 남깁니다.
 *
 * **배열인지만 보고 통과시키면 안 됩니다.** 스킬 id 를 하나라도 바꾸거나 없애면, 그
 * 이름을 들고 있던 저장이 `getSkillDef` 에서 `undefined` 를 받아 `.kind` 를 읽다가
 * 터집니다. 터지는 자리가 판 시작(`player.ts`)과 상점(`shop.ts`) 둘 다라, 게임을 켤 수도
 * 없고 고칠 화면에 들어갈 수도 없어서 저장을 통째로 지우는 것 말고는 길이 없습니다.
 * 바로 위의 `equippedPassives` 가 해금 목록과 대조하는 것과 같은 이유입니다.
 */
function knownSkills(value: unknown): SkillId[] {
  if (!Array.isArray(value)) return [];
  return value.filter((s): s is SkillId => typeof s === 'string' && s in SKILLS);
}

/** 예전 버전이나 손상된 필드를 기본값으로 채웁니다 */
function migrate(data: Partial<SaveData>): SaveData {
  const validKeys = new Set(STAT_DEFS.map((d) => d.key));
  const unlockedPassives = Array.isArray(data.unlockedPassives)
    ? data.unlockedPassives.filter((k): k is StatKey => validKeys.has(k as StatKey))
    : [];

  // 칸 길이는 항상 PASSIVE.slots 로 맞춥니다. 해금 안 한 것이 끼워져 있으면 비웁니다
  const equipped: (StatKey | null)[] = new Array(PASSIVE.slots).fill(null);
  if (Array.isArray(data.equippedPassives)) {
    for (let i = 0; i < PASSIVE.slots; i++) {
      const k = data.equippedPassives[i];
      if (typeof k === 'string' && unlockedPassives.includes(k as StatKey)) equipped[i] = k as StatKey;
    }
  }
  const sealsOwned = clampInt(numberOr(data.sealsOwned, 0), 0, PASSIVE.sealCosts.length);

  return {
    version: VERSION,
    // 예전 가중치에 쓴 코인은 전액 돌려줍니다
    coins: numberOr(data.coins, 0) + refundOldWeights((data as { weights?: unknown }).weights),
    perm: isRecord(data.perm) ? (data.perm as Record<string, number>) : {},
    unlockedPassives,
    equippedPassives: equipped,
    sealsOwned,
    sealedSlots: clampInt(numberOr(data.sealedSlots, 0), 0, sealsOwned),
    unlockedStartSkills: knownSkills(data.unlockedStartSkills),
    equippedStartSkills: knownSkills(data.equippedStartSkills),
    bestiary: isRecord(data.bestiary) ? (data.bestiary as Record<string, BestiaryEntry>) : {},
    records: {
      bestTime: numberOr(data.records?.bestTime, 0),
      bestKills: numberOr(data.records?.bestKills, 0),
      bestLevel: numberOr(data.records?.bestLevel, 0),
      // 기록 화면이 이 목록으로 스킬 이름을 뽑습니다 (`menus.ts`). 거르지 않으면 거기서 터집니다
      bestBuild: knownSkills(data.records?.bestBuild),
      totalRuns: numberOr(data.records?.totalRuns, 0),
      totalKills: numberOr(data.records?.totalKills, 0),
      bestTimeByDifficulty: numberMap(data.records?.bestTimeByDifficulty),
    },
    achievements: numberMap(data.achievements),
    achieveStats: {
      playTime: numberOr(data.achieveStats?.playTime, 0),
      coinsEarned: numberOr(data.achieveStats?.coinsEarned, 0),
      eliteKills: numberOr(data.achieveStats?.eliteKills, 0),
      shardKills: numberOr(data.achieveStats?.shardKills, 0),
      deathCauses: Array.isArray(data.achieveStats?.deathCauses) ? data.achieveStats!.deathCauses : [],
    },
    // 난이도는 15 가 끝입니다. 예전 저장 데이터에 그보다 큰 값이 있어도 잘라서 읽습니다
    maxDifficulty: Math.min(DIFFICULTY.max, Math.max(0, Math.floor(numberOr(data.maxDifficulty, 0)))),
    // 이쪽은 아래로 -1(입문)까지 내려갑니다. 해금 여부는 난이도 화면이 다시 봅니다
    lastDifficulty: Math.min(
      DIFFICULTY.max,
      Math.max(DIFFICULTY.min, Math.floor(numberOr(data.lastDifficulty, 0))),
    ),
    shopHelpSeen: data.shopHelpSeen === true,
  };
}

/** 값이 숫자인 항목만 남깁니다 (난이도별 기록처럼 키가 자유로운 맵) */
function numberMap(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isRecord(v)) return out;
  for (const [k, n] of Object.entries(v)) {
    if (typeof n === 'number' && Number.isFinite(n)) out[k] = n;
  }
  return out;
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.floor(v)));
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
