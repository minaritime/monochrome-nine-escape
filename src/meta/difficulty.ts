import {
  DIFFICULTY,
  DIFFICULTY_EASY,
  DIFFICULTY_STEPS,
  HARD,
  HARD_DIFFICULTY_STEPS,
  type DifficultyStep,
  type EnemyId,
  type WaveSpec,
} from '../data/balance';
import type { SaveData } from './save';

/** 레벨업에 기본으로 뜨는 선택지 수 */
export const BASE_SKILL_CHOICES = 3;

/**
 * 난이도로 결정되는 적 강화 배율 묶음.
 * 난이도 0 은 지금까지의 기본 게임과 완전히 같습니다 (모든 값이 1 또는 0 또는 null).
 */
export interface DifficultyMods {
  level: number;
  hpMul: number;
  damageMul: number;
  speedMul: number;
  rangeMul: number;
  spawnRateMul: number;
  eliteRatioMul: number;
  maxAliveAdd: number;
  bossHpMul: number;
  bossDamageMul: number;
  bulletSpeedMul: number;
  contactDamageMul: number;
  bomberSpeedMul: number;
  bomberDamageMul: number;
  cowardPatienceMul: number;
  hazardDurationMul: number;
  /** 이 난이도로 다음 단계를 열려면 버텨야 하는 시간(초) */
  clearTime: number;
  /** 레벨업에 뜨는 선택지 수 */
  skillChoices: number;
  wave: WaveSpec | null;
  bomberWave: WaveSpec | null;
  allElite: boolean;
  chargerNoStun: boolean;
  chargerNoCooldown: boolean;
  splitterShoot: boolean;
  foolInvuln: boolean;
  foolShotDirs: number | null;
  /** 포식자 보스가 거대 포식자가 됩니다 (하드 1) */
  bossPredatorHard: boolean;
  /** 폭격기 보스의 폭격이 강화됩니다 (하드 4). 표는 `BOSS_BOMBARD_HARD` */
  bossBombardHard: boolean;
  /** 방패적의 방패 내구도 배율 (하드 2) */
  shieldDurabilityMul: number;
  /** 은신적이 숨어 있는 동안 완전히 투명해집니다 (하드 3) */
  stealthDeep: boolean;
  /** 이 판에서 추가로 나오는 하드 전용 적 */
  extraEnemies: EnemyId[];
  /** 판 종료 시 주운 코인에 곱해집니다 */
  coinMul: number;
  /** 보스가 떨어뜨리는 코인 개수에 곱해집니다 */
  bossCoinMul: number;
}

/**
 * 고를 수 있는 범위로 자릅니다.
 *
 * **하드모드에는 입문(-1)이 없습니다** (2026-09-06). 일부러 쉽게 만든 난이도라
 * 하드에 둘 자리가 없고, 하드 0 자체가 이미 일반 15 위에서 시작합니다.
 */
export function clampDifficulty(level: number, hard = false): number {
  const min = hard ? 0 : DIFFICULTY.min;
  return Math.min(DIFFICULTY.max, Math.max(min, Math.floor(level)));
}

/**
 * 배율을 1 쪽으로 당깁니다 (하드 0 의 출발선).
 *
 * **"1 로부터의 거리"에 곱합니다.** 체력 x2.10 에 0.7 이면 1 + 1.10 x 0.7 = x1.77 입니다.
 * 배율 자체에 곱하면 x1.47 이 되어 1 아래로 내려가는 값이 생기고, 그러면 난이도가
 * 오히려 쉬워지는 자리가 만들어집니다.
 *
 * **배율만 건드립니다.** 장치(불리언 · 웨이브 · 선택지 수 · 클리어 시간)는 그대로
 * 가져옵니다. 그것이 하드 0 을 일반 15 와 같은 판으로 만드는 부분입니다.
 */
function softenMuls(mods: DifficultyMods, ratio: number): void {
  const keys = [
    'hpMul',
    'damageMul',
    'speedMul',
    'rangeMul',
    'spawnRateMul',
    'eliteRatioMul',
    'bossHpMul',
    'bossDamageMul',
    'bulletSpeedMul',
    'contactDamageMul',
    'bomberSpeedMul',
    'bomberDamageMul',
    'cowardPatienceMul',
    'hazardDurationMul',
  ] as const;
  for (const k of keys) mods[k] = 1 + (mods[k] - 1) * ratio;
}

export function noDifficulty(): DifficultyMods {
  return difficultyMods(0);
}

/**
 * 배율은 **곱하지 않고 더합니다.**
 *
 * 1단계 체력 +20% 위에 3단계 체력 +10% 가 오면 최종은 +30%(x1.30) 입니다.
 * 곱하면 x1.20 * x1.10 = x1.32 가 되어, 표에 적힌 숫자를 다 더한 값과 결과가 달라집니다.
 * 표를 읽고 "그래서 최종이 얼마인가"를 암산할 수 없으면 표의 값을 손볼 수가 없습니다.
 *
 * 구현은 "1 로부터 떨어진 거리"를 누적하는 것입니다. x0.8 은 -0.2 로 더해집니다.
 */
function addMul(current: number, step: number | undefined): number {
  if (step === undefined) return current;
  // 표가 잘못 쌓여 0 이하로 내려가면 속도나 스폰율이 뒤집힙니다. 그 앞에서 막습니다
  return Math.max(0.05, current + (step - 1));
}

/** 기본값(난이도 0)에 단계 효과를 차례로 얹습니다 */
function applyStep(mods: DifficultyMods, step: DifficultyStep): void {
  mods.hpMul = addMul(mods.hpMul, step.hpMul);
  mods.damageMul = addMul(mods.damageMul, step.damageMul);
  mods.speedMul = addMul(mods.speedMul, step.speedMul);
  mods.rangeMul = addMul(mods.rangeMul, step.rangeMul);
  mods.spawnRateMul = addMul(mods.spawnRateMul, step.spawnRateMul);
  mods.eliteRatioMul = addMul(mods.eliteRatioMul, step.eliteRatioMul);
  mods.maxAliveAdd += step.maxAliveAdd ?? 0;
  mods.bossHpMul = addMul(mods.bossHpMul, step.bossHpMul);
  mods.bossDamageMul = addMul(mods.bossDamageMul, step.bossDamageMul);
  mods.bulletSpeedMul = addMul(mods.bulletSpeedMul, step.bulletSpeedMul);
  mods.contactDamageMul = addMul(mods.contactDamageMul, step.contactDamageMul);
  mods.bomberSpeedMul = addMul(mods.bomberSpeedMul, step.bomberSpeedMul);
  mods.bomberDamageMul = addMul(mods.bomberDamageMul, step.bomberDamageMul);
  mods.cowardPatienceMul = addMul(mods.cowardPatienceMul, step.cowardPatienceMul);
  mods.hazardDurationMul = addMul(mods.hazardDurationMul, step.hazardDurationMul);
  mods.shieldDurabilityMul = addMul(mods.shieldDurabilityMul, step.shieldDurabilityMul);
  mods.clearTime += step.clearTimeAdd ?? 0;
  mods.skillChoices += step.skillChoiceAdd ?? 0;

  // 웨이브만은 곱하지 않고 갈아끼웁니다 ("1분마다 5마리"와 "1분마다 15마리"는 동시에 성립하지 않습니다)
  if (step.wave) mods.wave = step.wave;
  if (step.bomberWave) mods.bomberWave = step.bomberWave;

  if (step.allElite) mods.allElite = true;
  if (step.chargerNoStun) mods.chargerNoStun = true;
  if (step.chargerNoCooldown) mods.chargerNoCooldown = true;
  if (step.splitterShoot) mods.splitterShoot = true;
  if (step.foolInvuln) mods.foolInvuln = true;
  if (step.foolShotDirs !== undefined) mods.foolShotDirs = step.foolShotDirs;
  if (step.bossPredatorHard) mods.bossPredatorHard = true;
  if (step.bossBombardHard) mods.bossBombardHard = true;
  if (step.stealthDeep) mods.stealthDeep = true;
  if (step.enemyUnlock && !mods.extraEnemies.includes(step.enemyUnlock)) mods.extraEnemies.push(step.enemyUnlock);
}

/**
 * 1단계부터 level 단계까지의 효과를 전부 더합니다 (누적).
 *
 * **하드모드는 일반 15 를 출발선으로 삼습니다** (2026-09-06). 장치는 전부 그대로
 * 가져오고 배율만 `HARD.startMul` 만큼 줄인 뒤, 그 위에 하드 표를 쌓습니다.
 */
export function difficultyMods(level: number, hard = false): DifficultyMods {
  if (hard) return hardMods(level);
  const lv = clampDifficulty(level);
  const mods: DifficultyMods = {
    level: lv,
    hpMul: 1,
    damageMul: 1,
    speedMul: 1,
    rangeMul: 1,
    spawnRateMul: 1,
    eliteRatioMul: 1,
    maxAliveAdd: 0,
    bossHpMul: 1,
    bossDamageMul: 1,
    bulletSpeedMul: 1,
    contactDamageMul: 1,
    bomberSpeedMul: 1,
    bomberDamageMul: 1,
    cowardPatienceMul: 1,
    hazardDurationMul: 1,
    shieldDurabilityMul: 1,
    clearTime: DIFFICULTY.baseClearTime,
    skillChoices: BASE_SKILL_CHOICES,
    wave: null,
    bomberWave: null,
    allElite: false,
    chargerNoStun: false,
    chargerNoCooldown: false,
    splitterShoot: false,
    foolInvuln: false,
    foolShotDirs: null,
    bossPredatorHard: false,
    bossBombardHard: false,
    stealthDeep: false,
    extraEnemies: [],
    coinMul: lv < 0 ? DIFFICULTY.easyCoinMul : 1 + lv * DIFFICULTY.coinMulPerLevel,
    // 보스 코인은 난이도 3당 +20%p. 다른 배율과 같이 합으로 쌓습니다 (3당 x1.2 를 곱하면 15단계에서 2.49 가 됩니다).
    // -1 은 전체 코인 배율에서 이미 30% 를 깎았으므로 여기서는 1 그대로 둡니다
    bossCoinMul:
      1 +
      (DIFFICULTY.bossCoinMul - 1) * Math.floor(Math.max(0, lv) / DIFFICULTY.bossCoinPerLevels),
  };

  if (lv < 0) {
    applyStep(mods, DIFFICULTY_EASY);
    return mods;
  }

  for (let i = 0; i < lv; i++) applyStep(mods, DIFFICULTY_STEPS[i]);
  return mods;
}

/**
 * 하드모드의 배율 묶음.
 *
 * 출발선은 **일반 15** 이고, 거기서 배율만 낮춘 뒤 하드 표를 쌓습니다.
 * 코인은 일반 15(x3.25) 위에서 이어집니다.
 */
function hardMods(level: number): DifficultyMods {
  const lv = clampDifficulty(level, true);
  const mods = difficultyMods(DIFFICULTY.max);
  softenMuls(mods, HARD.startMul);

  mods.level = lv;
  // 하드 0 이 x3.5, 하드 15 가 x7.25 입니다. 일반과 같은 배율로는 하드 상점을
  // 채우는 데 300판이 걸립니다
  mods.coinMul = HARD.coinBase + (lv + 1) * HARD.coinPerLevel;
  mods.bossCoinMul = DIFFICULTY.bossCoinMul + (DIFFICULTY.bossCoinMul - 1) * (lv / DIFFICULTY.max);

  for (let i = 0; i < lv; i++) applyStep(mods, HARD_DIFFICULTY_STEPS[i]);
  return mods;
}

/**
 * 그 난이도로 다음 단계를 열려면 버텨야 하는 시간(초).
 * 기본 15분이고, 난이도 3의 "클리어 조건 +15분"이 붙으면 그 뒤로는 30분입니다.
 * 하드는 출발선이 일반 15 라 언제나 30분입니다.
 */
export function unlockTimeFor(level: number, hard = false): number {
  return difficultyMods(level, hard).clearTime;
}

/**
 * 난이도별 최고 기록을 담는 키.
 *
 * **하드는 `'h0'` ~ `'h15'` 로 나눕니다** (2026-09-06). 같은 키를 쓰면 하드 기록이
 * 일반 기록을 덮어써서 **일반모드의 최고 기록이 사라집니다.** 난이도 숫자는 같은데
 * 판의 내용이 완전히 다르므로 같은 칸에 넣을 수 없습니다.
 */
export function difficultyKey(level: number, hard: boolean): string {
  return hard ? `h${level}` : String(level);
}

/**
 * `from` 부터 최고 난이도까지 전부 클리어했는가.
 *
 * **범위를 인자로 받는 이유**는 쓰는 곳마다 시작점이 다르기 때문입니다.
 * 업적 "완주" 는 입문(-1)까지 포함한 완전 제패라 `DIFFICULTY.min` 에서 시작하고,
 * 하드모드 해금은 **입문을 빼고** 0 에서 시작합니다. 입문은 일부러 쉽게 만든
 * 난이도라 도전의 증거로 삼기에 어울리지 않습니다.
 *
 * **계산은 한 곳이어야 합니다.** 두 벌로 적어두면 클리어 판정 방식을 바꿀 때
 * 한쪽만 고쳐서 "업적은 열렸는데 하드모드는 안 열리는" 일이 생깁니다.
 */
export function clearedAllFrom(save: SaveData, from: number, hard = false): boolean {
  for (let lv = from; lv <= DIFFICULTY.max; lv++) {
    const best = save.records.bestTimeByDifficulty[difficultyKey(lv, hard)] ?? 0;
    if (best < unlockTimeFor(lv, hard)) return false;
  }
  return true;
}

/** 그 난이도에서 새로 붙는 효과 한 줄 */
export function difficultyStepLabel(level: number, hard = false): string {
  if (hard) {
    // 하드 0 은 "추가 효과 없음"이 아닙니다. 일반 15 위에서 시작합니다
    if (level === 0) return '일반 15 의 장치 전부 · 배율은 낮춰서 시작';
    return HARD_DIFFICULTY_STEPS[level - 1]?.label ?? '추가 효과 없음';
  }
  if (level < 0) return DIFFICULTY_EASY.label;
  if (level === 0) return '추가 효과 없음';
  return DIFFICULTY_STEPS[level - 1]?.label ?? '추가 효과 없음';
}

/** 화면에 한 줄씩 늘어놓기 위한 효과 한 항목 */
export interface DifficultyEffect {
  label: string;
  value: string;
  /** 플레이어에게 불리한 항목인가 (색을 다르게 씁니다) */
  bad: boolean;
  /** 배율이 아니라 규칙 자체를 바꾸는 항목인가 */
  device: boolean;
}

/**
 * 그 난이도에서 무엇인가 붙은 적 종류의 이름.
 *
 * 수치 강화든 규칙 변경이든 한 종류에 하나로 접습니다. 자폭병에 속도와 공격력이
 * 같이 붙어도 "자폭병" 한 줄입니다. 무적 바보적은 여기 넣지 않습니다 (따로 그립니다).
 */
function buffedKinds(m: DifficultyMods): string[] {
  const out: string[] = [];
  const add = (name: string, on: boolean) => {
    if (on) out.push(name);
  };

  add('자폭병', m.bomberSpeedMul !== 1 || m.bomberDamageMul !== 1);
  add('겁쟁이', m.cowardPatienceMul !== 1);
  add('장판적', m.hazardDurationMul !== 1);
  add('돌진적', m.chargerNoStun || m.chargerNoCooldown);
  add('분열적', m.splitterShoot);
  add('바보적', m.foolShotDirs !== null);
  return out;
}

/**
 * 그 난이도까지 쌓인 효과 전체.
 * 한 문장으로 이어 붙이면 열 줄이 넘는 후반 난이도에서 읽을 수가 없어서 항목별로 돌려줍니다.
 */
export function difficultyEffects(level: number, hard = false): DifficultyEffect[] {
  const lv = clampDifficulty(level, hard);
  // 일반 0 은 아무것도 안 붙지만, **하드 0 은 이미 일반 15 위에서 시작합니다**
  if (lv === 0 && !hard) return [];

  const m = difficultyMods(lv, hard);
  const out: DifficultyEffect[] = [];
  // 1 보다 크면 "+N%", 작으면 "-N%" 로 읽힙니다
  const pct = (v: number) => `${v >= 1 ? '+' : ''}${Math.round((v - 1) * 100)}%`;
  /** 배율 항목. rising 은 "그 값이 오르는 것이 플레이어에게 나쁜가" 입니다 */
  const mul = (label: string, v: number, risingIsBad = true) => {
    if (v === 1) return;
    out.push({ label, value: pct(v), bad: v > 1 ? risingIsBad : !risingIsBad, device: false });
  };
  const device = (label: string, value: string, bad = true) => out.push({ label, value, bad, device: true });

  mul('적 체력', m.hpMul);
  mul('적 공격력', m.damageMul);
  mul('접촉 피해', m.contactDamageMul);
  mul('적 이동속도', m.speedMul);
  mul('적 사거리', m.rangeMul);
  mul('적탄 속도', m.bulletSpeedMul);
  mul('스폰율', m.spawnRateMul);
  if (m.eliteRatioMul !== 1) out.push({ label: '정예 비율', value: `x${m.eliteRatioMul.toFixed(1)}`, bad: true, device: false });
  if (m.maxAliveAdd > 0) out.push({ label: '동시 등장 상한', value: `+${m.maxAliveAdd}마리`, bad: true, device: false });
  mul('보스 체력', m.bossHpMul);
  mul('보스 공격력', m.bossDamageMul);

  // 적 종류별로 붙는 것은 수치도 규칙도 펼치지 않고 "능력 강화" 한 줄로 접습니다.
  // "자폭병 속도 -20%" 는 약화로 읽혀서 오해만 주고, 종류마다 두세 줄씩 늘어나면
  // 정작 판 전체를 바꾸는 항목이 그 사이에 묻힙니다. 세부는 들어가서 겪을 일입니다
  for (const name of buffedKinds(m)) {
    out.push({ label: name, value: '능력 강화', bad: true, device: false });
  }

  if (m.wave) device('스폰 웨이브', `${fmtMin(m.wave.startTime)}부터 ${fmtSec(m.wave.interval)}마다 ${m.wave.count}마리`);
  if (m.bomberWave) {
    device('자폭병 웨이브', `${fmtMin(m.bomberWave.startTime)}부터 ${fmtSec(m.bomberWave.interval)}마다 ${m.bomberWave.count}마리`);
  }
  if (m.skillChoices !== BASE_SKILL_CHOICES) device('레벨업 선택지', `${m.skillChoices}개`);
  if (m.allElite) device('정예', '모든 적이 정예');
  // 이것만은 접지 않습니다. 강화된 적이 아니라 판 내내 남는 못 죽이는 장애물이라,
  // 있는 줄 모르고 들어가면 대응 자체가 달라집니다
  if (m.foolInvuln) device('무적 바보적', '1마리가 판 내내 남음');

  if (m.clearTime !== DIFFICULTY.baseClearTime) {
    device('다음 난이도 해금', `${Math.round(m.clearTime / 60)}분 생존`);
  }

  // 보상은 마지막에. 유일하게 플레이어에게 좋은 항목입니다
  out.push({ label: '코인 획득', value: `x${m.coinMul.toFixed(2)}`, bad: m.coinMul < 1, device: false });
  if (m.bossCoinMul !== 1) {
    out.push({ label: '보스 코인', value: `x${m.bossCoinMul.toFixed(2)}`, bad: false, device: false });
  }

  return out;
}

/** 그 난이도까지 쌓인 효과 전체를 한 줄로 (기록 화면 등 좁은 자리용) */
export function difficultySummary(level: number, hard = false): string {
  const lines = difficultyEffects(level, hard);
  if (lines.length === 0) return '기본 난이도입니다';
  return lines.map((e) => `${e.label} ${e.value}`).join(' · ');
}

function fmtMin(seconds: number): string {
  return `${Math.round(seconds / 60)}분`;
}

function fmtSec(seconds: number): string {
  return seconds >= 60 ? `${Math.round(seconds / 60)}분` : `${seconds}초`;
}
