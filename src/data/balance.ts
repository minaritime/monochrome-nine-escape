/**
 * ★ 이 게임의 모든 밸런스 수치는 이 파일 한 곳에만 둡니다.
 * 적 14종을 조정하려면 값이 흩어져 있으면 안 됩니다. (기획.md 3장)
 * 다른 파일에서 숫자를 직접 쓰지 말고 항상 여기서 가져다 쓰십시오.
 */

/** 플레이 영역(경기장) 크기. 게임 좌표는 전부 이 안입니다 */
export const CANVAS = { w: 1280, h: 720 } as const;

/** 경기장 양옆 정보 패널 폭 */
export const PANEL = { w: 215 } as const;

/** 실제 캔버스 크기 = 좌측 패널 + 경기장 + 우측 패널 */
export const VIEW = { w: CANVAS.w + PANEL.w * 2, h: CANVAS.h } as const;

/** 경기장이 시작되는 x 좌표 (화면 좌표로 변환할 때 더합니다) */
export const ARENA_X = PANEL.w;

/** 물리 고정 타임스텝 (초). 렌더는 가변. */
export const FIXED_DT = 1 / 60;
/** 한 프레임에 몰아서 처리할 수 있는 물리 스텝 상한 (탭 전환 후 폭주 방지) */
export const MAX_STEPS_PER_FRAME = 5;

// ---------------------------------------------------------------------------
// 플레이어
// ---------------------------------------------------------------------------

export const PLAYER = {
  radius: 12,
  /** 벽에서 이만큼 떨어진 곳까지만 이동 가능 */
  wallMargin: 6,
  /** 피격 후 무적 시간 동안 깜빡이는 주기 */
  blinkPeriod: 0.12,
  /** 사망 시 화면 흔들림 세기 */
  deathShake: 26,
} as const;

/** 레벨업으로 오르는 12종 스탯 */
export type StatKey =
  | 'attack'
  | 'moveSpeed'
  | 'maxHp'
  | 'fireRate'
  | 'critChance'
  | 'critMult'
  | 'projSpeed'
  | 'range'
  | 'cooldownReduction'
  | 'invulnTime'
  | 'pickupRange'
  | 'regen';

export interface StatDef {
  key: StatKey;
  name: string;
  /** 주요 스탯 여부. 상점 가중치 단가가 다릅니다 */
  major: boolean;
  /** 레벨업 1회당 상승량 */
  step: number;
  /** 상한 (없으면 undefined) */
  cap?: number;
  /** UI 표기 방식 */
  format: 'int' | 'dec1' | 'dec2' | 'percent';
  desc: string;
  /**
   * 레벨업 추첨에 넣을지 여부 (생략하면 넣습니다).
   * 체감이 거의 없는 스탯이 추첨에 섞이면 레벨업이 "꽝"이 되어 성장의 재미가 죽습니다.
   * 여기서 뺀 스탯도 상점 영구 강화로는 계속 올릴 수 있습니다.
   */
  rollable?: boolean;
}

/**
 * 레벨업 1회에 오르는 스탯 개수.
 * 하나만 오르면 체감이 약해서 레벨업이 밋밋합니다. 서로 다른 스탯이 이만큼 오릅니다.
 */
export const STAT_GAINS_PER_LEVEL = 2;

export const STAT_DEFS: readonly StatDef[] = [
  { key: 'attack', name: '공격력', major: true, step: 2.2, format: 'dec1', desc: '모든 피해량이 오릅니다' },
  { key: 'moveSpeed', name: '이동속도', major: true, step: 8, cap: 510, format: 'int', desc: '더 빨리 움직입니다' },
  { key: 'maxHp', name: '최대 체력', major: true, step: 12, format: 'int', desc: '최대 체력이 늘고 그만큼 회복합니다' },
  { key: 'fireRate', name: '연사 속도', major: true, step: 0.2, format: 'dec2', desc: '기본공격이 빨라집니다' },
  { key: 'critChance', name: '치명타 확률', major: false, step: 0.03, cap: 0.75, format: 'percent', desc: '치명타가 터질 확률' },
  { key: 'critMult', name: '치명타 배율', major: false, step: 0.13, cap: 4.0, format: 'dec2', desc: '치명타 피해 배수' },
  { key: 'projSpeed', name: '투사체 속도', major: false, step: 42, format: 'int', desc: '탄이 빨라져 맞히기 쉬워집니다', rollable: false },
  { key: 'range', name: '기본공격 사거리', major: false, step: 24, cap: 500, format: 'int', desc: '자동 조준이 닿는 거리' },
  { key: 'cooldownReduction', name: '스킬 쿨다운 감소', major: false, step: 0.035, cap: 0.6, format: 'percent', desc: '스킬 재사용 대기가 짧아집니다' },
  { key: 'invulnTime', name: '피격 무적 시간', major: false, step: 0.06, cap: 1.6, format: 'dec2', desc: '맞은 뒤 무적으로 버티는 시간', rollable: false },
  { key: 'pickupRange', name: '코인 획득 범위', major: false, step: 20, format: 'int', desc: '코인을 끌어당기는 거리', rollable: false },
  { key: 'regen', name: '체력 재생', major: false, step: 0.45, cap: 5, format: 'dec2', desc: '초당 회복량' },
] as const;

/** 상점 영구 강화가 없을 때의 기본값 */
export const BASE_STATS: Record<StatKey, number> = {
  attack: 10,
  moveSpeed: 205,
  maxHp: 100,
  fireRate: 2.2,
  critChance: 0.05,
  critMult: 1.5,
  projSpeed: 520,
  range: 330,
  cooldownReduction: 0,
  invulnTime: 0.55,
  pickupRange: 75,
  regen: 0,
};

// ---------------------------------------------------------------------------
// 경험치와 레벨
// ---------------------------------------------------------------------------

export const LEVEL = {
  /** 레벨 n → n+1 에 필요한 경험치 */
  xpToNext: (level: number) => Math.floor(9 + 6.2 * level + 0.6 * level * level),
  /**
   * 스킬 선택이 오는 레벨. **3레벨마다 한 번**입니다 (2026-08-12).
   *
   * 예전에는 [3, 6, 10, 15, 21, 28, 36, 45, 55, 66, 78, 91] 처럼 초반은 촘촘하고
   * 후반으로 갈수록 벌어졌습니다. 그런데 `scripts/levelcurve.ts` 로 재보니 30분 완주가
   * Lv.55~59 라, 그 표로는 판당 선택이 **9회**뿐이었습니다. 스킬 상한이 7레벨이 되면서
   * 4칸을 전부 채우려면 획득 4 + 레벨업 24 = **28회**가 필요한데 9회로는 어림도 없고,
   * 상한만 올리면 4레벨 위는 아무도 못 보게 됩니다.
   *
   * 3레벨마다면 Lv.59 기준 **19회**입니다. 전부 만렙은 여전히 못 만들되
   * **두 개를 만렙으로 몰거나 네 개를 고르게 올리는** 갈림길이 생깁니다.
   * 전부 채워지면 빌드라는 것이 없어지므로 못 채우는 편이 맞습니다.
   *
   * 참고로 "6레벨마다"는 안 됩니다. 옛 표가 앞은 촘촘하고 뒤가 벌어져 있어서
   * 상쇄되어 정확히 9회로 같아집니다.
   */
  skillLevels: [3] as const,
  /** 위 목록을 넘어가면 이 간격으로 계속 나옵니다 */
  skillLevelStepAfter: 3,
  /** 이미 가진 스킬의 레벨업이 선택지에 섞일 확률 */
  upgradeOfferChance: 0.35,
} as const;

/**
 * 레벨업 결과를 머리 위에 띄우는 간격.
 *
 * 스킬 선택창이 뜨는 레벨이면 오른 스탯이 창 뒤에서 그대로 사라져서 무엇이 올랐는지
 * 볼 수가 없었습니다. 지금은 창이 닫힌 뒤에 스탯이 한 줄씩 뜨고, 그 뒤에 획득한 스킬이 뜹니다.
 * gap 은 스탯 줄 사이, skillGap 은 마지막 스탯과 스킬 사이의 틈입니다.
 */
export const LEVEL_NOTICE = { gap: 0.22, skillGap: 0.4 } as const;

/**
 * 화면 흔들림 전체 조절.
 *
 * 흔들림을 부르는 곳이 18군데인데 값이 더해지기만 해서, 폭발과 처치가 몰리는 후반에는
 * 화면이 계속 떨렸습니다. 부르는 곳의 세기 비율은 그대로 두고 여기서 한 번에 줄입니다.
 * mul 을 0 으로 두면 흔들림이 아예 없어집니다.
 */
export const SHAKE = {
  /**
   * 부르는 쪽 값에 곱하는 배율. **여기 있는 값은 "전체" 기준입니다.**
   *
   * 설정의 화면 흔들림이 이 위에 다시 곱해지고 **기본값이 "절반"** 이라,
   * 실제로 화면에 걸리는 값은 0.3 입니다. 예전에 상수 하나로 0.3 을 쓰던 것과
   * 같은 세기이고, 흔들림을 더 원하는 사람만 "전체"로 올립니다.
   */
  mul: 0.6,
  /** 동시에 아무리 겹쳐도 이 이상은 흔들리지 않습니다 (예전 상한 34) */
  max: 9,
  /**
   * 죽는 순간에만 넘길 수 있는 상한 (`Effects.addDeathShake`).
   *
   * 평소 상한을 9 로 조인 이유는 후반에 폭발과 처치가 몰려 화면이 계속 떨렸기 때문입니다.
   * 죽는 연출은 판당 딱 한 번이고 그 뒤로 게임이 끝나므로 그 문제와 무관합니다.
   */
  deathMax: 30,
  /** 초당 잦아드는 양 */
  decay: 46,
} as const;

/**
 * 죽는 순간 연출 (파편 수류탄).
 *
 * 플레이어가 죽으면 판이 통째로 멈추고, 이 시간 동안 파편만 날아갑니다.
 * 파편에 맞은 잡몹은 즉사하지만 **코인도 경험치도 나오지 않습니다.**
 * 보상을 주면 "잡몹 한가운데서 일부러 죽는" 것이 이득이 되어, 마지막에 일부러
 * 들이받는 플레이가 생깁니다. 몇 마리를 데려갔는지는 게임오버 화면에 숫자로만 남깁니다.
 */
export const DEATH_BURST = {
  /** 연출 길이(초) */
  duration: 1,
  /** 이 시간이 지나면 아무 키나 눌러 건너뜁니다. 앞부분을 막아두는 이유는
   *  죽기 직전에 누르고 있던 키가 그대로 넘겨버리는 것을 막기 위해서입니다 */
  skipAfter: 0.25,
  /** 파편 개수 */
  count: 16,
  /** 파편 속도 (개체마다 이 범위에서 뽑습니다) */
  speedMin: 620,
  speedMax: 1060,
  /** 파편이 나아가며 느려지는 정도 */
  drag: 0.9,
  /** 파편 크기 (플레이어 반지름 대비) */
  sizeMul: 0.62,
  /** 파편 판정 반경. 이 값 + 적 반지름 안에 들어오면 맞습니다 */
  hitRadius: 11,
  /** 파편 회전 속도(라디안/초) 범위 */
  spinMax: 11,
  /** 부채꼴로 그릴 때의 반각 */
  spread: 0.42,
  /** 죽는 순간 화면 흔들림 (SHAKE.deathMax 까지 올라갑니다) */
  shake: 30,
} as const;

/**
 * 공격 스킬은 3칸까지 모읍니다. 다 차면 새 공격 스킬은 더 나오지 않고
 * 가진 것의 레벨업만 나옵니다.
 */
export const MAX_ATTACK_SKILLS = 3;

/**
 * 유틸 스킬은 항상 1개뿐이고 Q 로만 씁니다.
 * 새 유틸을 고르면 쓰던 것을 버리고 1레벨로 갈아탑니다.
 * 한 번의 선택지 3장 중 유틸은 최대 이만큼만 섞습니다. 어차피 하나만 들 수 있어서
 * 두 장 이상 나오면 선택지가 낭비됩니다.
 */
export const MAX_UTILITY_CHOICES_PER_ROLL = 1;

/**
 * 이미 가진 스킬의 레벨업 카드도 한 번에 최대 이만큼만 섞습니다.
 *
 * 예전에는 카드 3장을 뽑으면서 장마다 따로 `LEVEL.upgradeOfferChance`(0.35)를 굴렸습니다.
 * 그래서 실제로는 3장 중 한 장이라도 업그레이드일 확률이 1 - 0.65³ = 72% 였고,
 * "고른 공격 스킬의 레벨업이 매번 확정으로 나온다"는 체감이 여기서 나왔습니다.
 * 지금은 판마다 한 번만 굴려서, 걸리면 딱 이 장수만 섞습니다.
 * 새 스킬 풀이 말라붙었을 때만 이 상한을 넘겨 채웁니다 (3장을 채우기 위해서입니다).
 */
export const MAX_UPGRADE_CHOICES_PER_ROLL = 1;

// ---------------------------------------------------------------------------
// 적: 기본적을 1.0으로 놓은 배율표 (기획.md 4장)
// ---------------------------------------------------------------------------

export const ENEMY_BASE = {
  speed: 74,
  hp: 22,
  damage: 8,
  radius: 13,
  xp: 3,
  /** 일반 적이 코인을 떨굴 확률 */
  coinChance: 0.07,
  /** 적끼리 겹치지 않게 밀어내는 힘 */
  separation: 42,
  /** 피격 시 흰색 번쩍임 지속 */
  hitFlash: 0.08,
} as const;

export type EnemyId =
  | 'basic'
  | 'fast'
  | 'tank'
  | 'ranged'
  | 'coward'
  | 'fool'
  | 'bomber'
  | 'splitter'
  | 'charger'
  | 'puddle'
  | 'summoner'
  | 'shield'
  | 'mummy'
  | 'stealth';

export interface EnemyBalance {
  speed: number;
  hp: number;
  damage: number;
  radiusMul: number;
  xpMul: number;
  /** 해금: 이 시간(초) 이후 */
  unlockTime: number;
  /** 해금: 스킬을 이만큼 가지면 시간 조건을 무시하고 해금 (0이면 없음) */
  unlockSkills: number;
  /** 스폰 추첨 가중치 */
  weight: number;
  /** 동시 존재 상한 (없으면 무제한) */
  maxAlive?: number;
}

export const ENEMY_TABLE: Record<EnemyId, EnemyBalance> = {
  basic: { speed: 1.0, hp: 1.0, damage: 1.0, radiusMul: 1.0, xpMul: 1.0, unlockTime: 0, unlockSkills: 0, weight: 100 },
  fast: { speed: 1.8, hp: 0.5, damage: 0.6, radiusMul: 0.82, xpMul: 1.0, unlockTime: 0, unlockSkills: 0, weight: 70 },
  tank: { speed: 0.5, hp: 3.0, damage: 1.0, radiusMul: 1.45, xpMul: 2.2, unlockTime: 0, unlockSkills: 0, weight: 42 },
  ranged: { speed: 0.7, hp: 0.5, damage: 0.6, radiusMul: 0.95, xpMul: 1.8, unlockTime: 60, unlockSkills: 0, weight: 45 },
  coward: { speed: 0.4, hp: 1.0, damage: 1.6, radiusMul: 1.0, xpMul: 1.6, unlockTime: 120, unlockSkills: 1, weight: 42 },
  fool: { speed: 1.0, hp: 1.0, damage: 1.2, radiusMul: 1.05, xpMul: 1.4, unlockTime: 210, unlockSkills: 2, weight: 40 },
  bomber: { speed: 1.0, hp: 0.6, damage: 2.5, radiusMul: 1.0, xpMul: 2.0, unlockTime: 240, unlockSkills: 0, weight: 38 },
  splitter: { speed: 1.0, hp: 1.2, damage: 0.9, radiusMul: 1.15, xpMul: 1.8, unlockTime: 300, unlockSkills: 0, weight: 38 },
  charger: { speed: 0.8, hp: 1.5, damage: 1.8, radiusMul: 1.2, xpMul: 2.4, unlockTime: 360, unlockSkills: 0, weight: 34 },
  puddle: { speed: 0.5, hp: 4.0, damage: 0.8, radiusMul: 1.3, xpMul: 3.0, unlockTime: 420, unlockSkills: 0, weight: 30 },
  // 도망 다니는 적이라 체력이 낮으면 스나이퍼 한 방에 정리되어 존재 의미가 없었습니다
  summoner: { speed: 0.9, hp: 7.5, damage: 0.5, radiusMul: 1.1, xpMul: 3.2, unlockTime: 480, unlockSkills: 0, weight: 26, maxAlive: 4 },
  shield: { speed: 0.8, hp: 1.5, damage: 1.0, radiusMul: 1.15, xpMul: 2.2, unlockTime: 540, unlockSkills: 0, weight: 30 },
  // 미라: 근접이고 체력이 탱커(3.0) 바로 아래입니다. 죽으면 3초 뒤 되살아나므로
  // 실질 체력은 이 값의 몇 배가 됩니다 (ENEMY_PARAMS.mummy 참고)
  mummy: { speed: 0.65, hp: 2.6, damage: 1.2, radiusMul: 1.25, xpMul: 3.0, unlockTime: 600, unlockSkills: 0, weight: 30 },
  stealth: { speed: 0.6, hp: 0.8, damage: 3.0, radiusMul: 1.0, xpMul: 3.4, unlockTime: 660, unlockSkills: 0, weight: 24, maxAlive: 3 },
};

/** 적별 개별 파라미터. 이동 패턴을 조정하는 손잡이입니다 */
export const ENEMY_PARAMS = {
  /**
   * 원거리적의 사거리는 항상 플레이어보다 조금 깁니다.
   * 고정값으로 두면 플레이어가 레벨업으로 사거리를 올리는 순간 사격 위치에 들어오기도 전에
   * 자동공격에 녹아서, 조준하고 쏘는 적이라는 존재 의미가 사라집니다.
   * 실제 사거리 = max(baseRange, 플레이어 사거리 x playerRangeMul)
   */
  ranged: {
    baseRange: 370,
    playerRangeMul: 1.12,
    aimTime: 2.0,
    cooldown: 3.0,
    /**
     * 플레이어 기본 이동속도는 205 지만 레벨업으로 금방 오릅니다.
     * 기본값보다 조금 빠른 정도로 잡으면 몇 번 레벨업한 뒤에는 다시 뒷걸음질로 피해집니다.
     * 성장한 플레이어에게도 위협이 되도록 넉넉히 잡습니다.
     * 직선으로 날아오므로 옆으로 비키면 여전히 피할 수 있습니다.
     */
    bulletSpeed: 300,
    bulletRadius: 6,
  },
  /**
   * 겁쟁이적의 돌진은 자기 배회 속도의 배수가 아니라 절대 속도입니다.
   * 배회 속도가 원래 매우 느려서(29) 배수로는 아무리 곱해도 위협이 되지 않습니다.
   * dashSpeed 는 플레이어 기본 이동속도(205)보다 빠르게 잡아, 근처에 가는 것 자체가
   * 위험한 선택이 되게 합니다. 정예도 이 속도는 그대로 씁니다.
   * windup 은 "왜 죽었는지 모르겠다"를 막는 최소한의 예고입니다. 0 으로 두면 즉시 돌진합니다.
   */
  /**
   * patienceTime: 이만큼 살아남으면 사거리와 무관하게 플레이어에게 달려듭니다.
   * 겁쟁이는 아주 느려서(29) 무시하고 도망만 다니면 영원히 방치됩니다. 화면 구석에
   * 겁쟁이가 쌓이기만 하고 아무 일도 안 일어나면 "처치할 이유"가 없는 적이 됩니다.
   * 인내가 끝나면 되돌아가지 않고 계속 돌진합니다. 처치하지 않은 대가입니다.
   */
  coward: { wanderChange: 1.0, triggerRange: 165, dashSpeed: 240, windup: 0.18, dashTime: 0.8, patienceTime: 30 },
  /**
   * 바보적은 쫓아오지 않고 직진 반사만 합니다. 그것만으로는 존재감이 없어서
   * 벽에 튕길 때마다 플레이어 쪽으로 한 발 쏩니다. 쫓아오지 않는 대신 벽이 포탑이 되는 셈입니다.
   * 정예는 같은 탄을 **세 갈래로** 뿌려서, 튕기는 순간이 실제 위협이 됩니다.
   *
   * **정예라고 탄이 빨라지지는 않습니다** (예전에는 430 이었습니다).
   * 바보적은 예고 없이 벽에서 쏘는데, 거기에 탄속까지 붙으니 보고 반응할 수가
   * 없었습니다. 조준선을 2초 그리고 쏘는 원거리적의 탄(300)보다도 빨랐다는 것이
   * 무엇보다 이상합니다. **미리 알려주는 적의 탄이 예고 없는 적의 탄보다 느리면,
   * 예고라는 장치 자체가 의미를 잃습니다.** 정예의 몫은 갈래 수로 냅니다.
   */
  fool: {
    minSpeedMul: 1.0,
    bulletSpeed: 230,
    bulletRadius: 6,
    bulletCount: 1,
    eliteBulletCount: 3,
    /** 정예 세 갈래가 벌어지는 각도(라디안) */
    eliteSpread: 0.32,

    /**
     * 난이도 15 의 **무적 바보적** 전용 값 (2026-08-12).
     *
     * 이 한 마리만은 난이도 15 의 전방위 규칙(`foolShotDirs` 8갈래)을 안 따릅니다.
     * 못 죽이는 적이 사방으로 뿌리면 피할 자리가 아니라 서 있을 자리가 없어집니다.
     * 대신 **플레이어 쪽으로만** 부채꼴로 쏘고, 탄이 절반 속도라 보고 비킬 수 있습니다.
     *
     * 이동속도를 1.5배로 올린 것은 그 대가입니다. 타겟도 안 되고 탄도 느려지면
     * 그냥 무시하고 지나칠 수 있는 적이 되는데, 그러면 "판 내내 남는 장애물"이라는
     * 존재 이유가 사라집니다. 느린 탄을 자주 던지며 빠르게 돌아다니는 쪽으로 성격을 잡았습니다.
     */
    immortalBulletCount: 5,
    immortalBulletSpeedMul: 0.5,
    immortalSpread: 0.3,
    immortalSpeedMul: 1.5,
  },
  /**
   * 자폭적의 방아쇠는 셋입니다.
   *
   * - **피격**: 맞으면 점화되어 igniteSpeedMul 배로 빨라지고 fuse 뒤에 터집니다 (원래 동작)
   * - **근접**: 바로 앞까지 붙으면 점화되고 contactFuse 뒤에 터집니다. 이쪽이 훨씬 짧습니다
   * - **처치**: 죽으면 corpseDelay 뒤에 시체 자리에서 터집니다. 이쪽만 **적에게도 피해가 들어갑니다**
   *
   * 도화선이 두 개인 이유는 방아쇠의 성격이 다르기 때문입니다. 피격 점화는 멀리서 걸리므로
   * 4초를 주고 도망칠 시간을 남깁니다. 근접 점화는 이미 코앞이라 4초를 주면 계속 따라붙기만 합니다.
   *
   * spawnDelay 는 스폰 직후 제자리에 멈춰 있는 시간입니다. 화면 가장자리에서 나오자마자
   * 달려들면 반응할 틈이 없습니다. 점화되면 이 대기는 즉시 취소됩니다.
   */
  bomber: {
    spawnDelay: 1.0,
    /** 몸끼리의 간격이 이 이하로 좁혀지면 점화됩니다 (반지름은 따로 더합니다) */
    triggerRange: 30,
    /** 피격 점화의 도화선 */
    fuse: 4.0,
    /** 근접 점화의 도화선 */
    contactFuse: 0.8,
    igniteSpeedMul: 2.5,
    /** 처치된 뒤 시체가 터지기까지 */
    corpseDelay: 2.0,
    blastRadius: 95,
    blastDamageMul: 2.5,
  },
  /**
   * burst* 는 난이도 14 에서만 씁니다 (나뉘는 순간 사방으로 뿌리는 탄).
   * 갈래를 자식 수(3)와 맞추지 않고 6 으로 둔 이유는, 분열체가 흩어지는 방향과
   * 탄이 가는 방향이 같으면 "분열체 뒤에 숨어 탄만 피하는" 자리가 생기기 때문입니다
   */
  splitter: {
    children: 3,
    childScale: 0.55,
    childHpMul: 0.35,
    childSpeedMul: 1.35,
    burstCount: 6,
    burstSpeed: 260,
    burstRadius: 6,
    burstDamageMul: 0.7,
  },
  /**
   * 돌진적의 돌진도 겁쟁이와 같은 이유로 절대 속도입니다.
   * 배회 속도(59)의 배수로 잡으면 4배를 곱해도 236 이라 플레이어와 비슷해서,
   * "예고를 보고 자리를 뜬다"가 아니라 "걸어서 피한다"가 되어버립니다.
   * 예고를 3초나 보여주는 대신 실제 돌진은 눈 깜짝할 사이여야 합니다.
   * barWidth 는 머리 위 충전 막대의 폭입니다.
   *
   * **인식 사거리는 없습니다.** 화면 어디에 있든 쿨이 돌면 예고하고 달려듭니다.
   * 사거리를 두면 그 밖에서는 존재하지 않는 적이 되는데, 화면 고정 맵에서는
   * 어차피 전부 한 화면 안이라 "안전한 거리"라는 것이 성립하지 않습니다.
   */
  charger: {
    wanderChange: 1.4,
    telegraph: 3.0,
    dashSpeed: 950,
    stun: 1.6,
    /** 벽에서 이만큼 떨어지기 전에는 예고를 시작하지 않습니다 */
    wallClearance: 70,
    barWidth: 46,
    barHeight: 5,
  },
  /**
   * hazardArm 은 장판이 깔린 뒤 피해가 시작되기까지의 유예입니다.
   * 죽자마자 아프면 "잡은 순간 손해"가 되어 잡을 이유가 사라집니다. 물러날 틈은 줘야 합니다.
   * 일반 장판은 피해가 없고(감속만), 정예 장판만 hazardDamageMul 로 피해가 붙습니다.
   */
  puddle: { hazardRadius: 78, hazardDuration: 5, hazardSlow: 0.5, hazardArm: 1.0, hazardTick: 0.5 },
  /**
   * 소환적은 **못 죽이는 하수인**을 부릅니다 (2026-08-16 재설계).
   *
   * 하수인은 어떤 피해도 안 받고 타겟도 되지 않습니다. 사라지는 길은 하나,
   * **불러낸 소환적을 잡는 것**뿐입니다. 그러면 전부 한꺼번에 소멸합니다.
   * 소환적이 도주형이라 기본공격으로는 안 잡히므로, "쫓아가서 근원을 끊는다"가
   * 이 적을 상대하는 유일한 답이 됩니다.
   *
   * **종류는 스폰할 때 한 번 정해지고 그 뒤로는 안 바뀝니다.** 매번 다른 것이
   * 나오면 무엇을 상대하는지 알 수 없고, 고정이면 화면을 보고 대응을 정할 수 있습니다.
   */
  summoner: {
    fleeRange: 430,
    summonInterval: 5.0,
    /** 한 마리가 동시에 유지할 수 있는 하수인 수 */
    maxMinions: 5,
    /** 이 셋 중 하나가 스폰 시점에 정해집니다 */
    minionPool: ['fool', 'charger', 'tank'] as readonly EnemyId[],
    /** 소멸할 때 하수인 하나가 코인을 남길 확률 */
    minionCoinChance: 0.25,
  },
  /**
   * 방패는 정면 90도 피해를 "대신 받는" 내구도입니다.
   * durabilityRatio: 그 개체 최대 체력의 이 비율만큼 버팁니다.
   * 방패가 깨지면 무효화가 사라지고 대신 조금 빨라집니다.
   * 관통·폭발·전방위 스킬은 방패를 무시합니다 (skills/registry.ts 의 ignoreShield).
   */
  shield: { arcDeg: 90, durabilityRatio: 0.5, brokenSpeedMul: 1.35 },
  /**
   * 미라: 죽으면 그 자리에서 3초 동안 흐려졌다가 **되살아납니다.**
   *
   * 되살아난 뒤에는 체력 x3 · 공격력 x2 · 이동속도 x1.5 로 시작하지만,
   * 속도는 매초 10%p 씩 깎여 5초 뒤 원래대로 돌아오고 체력은 매초 최대치의 20% 씩
   * 빠져나갑니다. 가만히 둬도 5초면 스스로 무너지므로 **버티느냐 지금 정리하느냐**의
   * 판단이 됩니다. 두 번째 죽음은 진짜 죽음입니다.
   */
  mummy: {
    reviveDelay: 3.0,
    /** 쓰러져 있는 동안의 투명도 */
    downedAlpha: 0.22,
    hpMul: 3,
    damageMul: 2,
    speedMul: 1.5,
    /** 이동속도 배율이 매초 이만큼 내려갑니다 (1.5 → 1.0 까지 5초) */
    speedDecayPerSec: 0.1,
    /** 매초 빠져나가는 최대 체력의 비율 */
    hpDrainPerSec: 0.2,
  },
  /**
   * 은신적은 **가까이 왔을 때만** 모습을 드러냅니다 (2026-08-16 변경).
   *
   * 예전에는 5초마다 1초씩 시간으로 켜졌다 꺼졌는데, 그러면 멀리 있는 적이 혼자
   * 깜빡이기만 하고 정작 붙었을 때는 안 보이는 순간이 생겼습니다. 거리 기준이면
   * "붙으면 보인다"가 되어 접촉 피해가 가장 큰 적이라는 성격과 맞습니다.
   */
  stealth: {
    revealRange: 230,
    hiddenAlpha: 0.13,
    /** "찰나" 업적: 드러난 뒤 이 시간 안에 잡아야 인정됩니다 */
    blinkKillWindow: 0.1,
  },
} as const;

/** 시간이 지날수록 적이 단단해지는 정도 */
/**
 * 시간이 갈수록 적이 세지는 정도. **처음부터 끝까지 같은 기울기입니다** (2026-08-12).
 *
 * 예전에는 15분에서 이 값이 멈추고 `LATE_SCALING` 이 **이미 쌓인 x4 에 다시 곱하는**
 * 구조였습니다. 배율에 배율을 곱하니 15분에서 기울기가 정확히 2배로 꺾였고
 * (분당 +0.35 → +0.70), 하필 같은 시점에 플레이어 쪽 성장이 둘 다 느려집니다.
 * 레벨업에 필요한 경험치가 레벨의 제곱이라 성장이 감속하고, 스킬은 만렙에 닿아 멈춥니다.
 * 셋이 겹쳐서 "후반이 갑자기 가팔라진다"가 됐습니다.
 *
 * 지금은 상한도 곱하기도 없이 분당 +0.2 로 쭉 갑니다. 30분이면 x7 입니다
 * (예전 구조로는 x10 이었습니다). 표만 보고 최종값을 암산할 수 있는 것이 요점입니다.
 *
 * **여기에 "몇 분 이후부터" 같은 구간을 다시 넣지 마십시오.** 구간을 나누면 그 경계에서
 * 반드시 꺾이고, 플레이어 성장은 매끄럽게 이어지므로 그 꺾임이 그대로 체감됩니다.
 */
export const TIME_SCALING = {
  hpPerMinute: 0.2,
  damagePerMinute: 0.055,
  /**
   * 속도만은 예외로 이 시간(분) 이후부터 오릅니다. 그리고 훨씬 천천히 오릅니다.
   * 20분 x1.05, 30분 x1.15, 60분 x1.45.
   *
   * 이동으로 피하는 게임이라 적 속도가 빠르게 오르면 "보고 피할 수 있다"가 깨집니다.
   * 체력·공격력은 화력으로 맞설 수 있지만 속도는 대응할 방법이 없습니다.
   */
  speedStartMinute: 15,
  speedPerMinute: 0.01,
} as const;

/**
 * 정예 변형 (기획.md 4장).
 * sizeMul 은 밸런스이자 식별 수단입니다. 1.15 로는 난전 중에 일반 적과 구분이 안 됩니다.
 * 크기·붉은 이중 링·머리 위 뿔 표식·항상 보이는 체력바를 전부 겹쳐서 구분합니다.
 */
/**
 * 적이 쏘는 탄은 어느 적이 쐈든 같은 빨강입니다.
 *
 * 적의 색은 "누구인가"를 알려주지만, 날아오는 탄에 필요한 정보는 "맞으면 아프다" 하나뿐입니다.
 * 쏜 적의 색을 따라가면 초록 탄 · 분홍 탄이 섞여 날아와서 매번 다시 판단해야 합니다.
 * 적탄만큼은 색으로 고민할 일이 없어야 합니다.
 *
 * 조준선은 여기 해당하지 않습니다. 그것은 "누가 어디서 쏘는가"라서 적 고유색을 유지합니다.
 */
export const ENEMY_BULLET = {
  color: '#ff2d2d',
  /** 바깥 번짐과 발사 불티 */
  glow: '#ff8f8f',
} as const;

export const ELITE = {
  hpMul: 1.5,
  damageMul: 1.5,
  sizeMul: 1.3,
  xpMul: 2.5,
  /** 속도는 보통으로 고정 (겁쟁이의 돌진 속도만 원본 유지) */
  speedMul: 1.0,
  coinDrop: 1,
  /** 표식 색 (링, 뿔, 체력바 공통) */
  markColor: '#ff2d2d',
  /** 바깥 링이 숨쉬는 속도와 폭 */
  ringPulseSpeed: 5,
  ringPulseAmount: 2.5,
} as const;

/**
 * 정예의 종류별 고유 강화.
 *
 * 위 ELITE 는 14종 전부에 똑같이 걸리는 배율(체력·공격력·크기)입니다.
 * 그것만으로는 정예가 "그냥 단단한 같은 적"에 그칩니다. 여기서는 그 적을 그 적답게 만드는
 * 부분을 골라서 강화합니다. 원거리적이라면 조준이 빠른 것, 돌진적이라면 예고가 짧은 것입니다.
 *
 * ★ 앞으로 종류별로 여기에 계속 추가할 자리입니다. 값은 전부 배율이고, 없으면 1 입니다.
 * 새 항목을 만들 때는 EliteTrait 에 필드를 더하고, 그 값을 읽는 쪽에서 eliteMul 을 쓰십시오.
 */
export interface EliteTrait {
  /**
   * 체력 배율. 있으면 공통 `ELITE.hpMul` 을 **대체**합니다 (곱하지 않습니다).
   * 탱커 정예의 체력은 기본 체력의 3배이지 4.5배가 아닙니다.
   */
  hpMul?: number;
  /** 이동속도 배율. 있으면 공통 `ELITE.speedMul` 을 **대체**합니다 */
  speedMul?: number;
  /** 공격력 배율. 있으면 공통 `ELITE.damageMul` 을 **대체**합니다 */
  damageMul?: number;
  /** 크기 배율. 있으면 공통 `ELITE.sizeMul` 을 **대체**합니다 */
  sizeMul?: number;
  /**
   * 배율이 아니라 **초당 회복량의 비율**입니다. 0.05 면 매 초 최대 체력의 5% 를 되찾습니다.
   * 체력을 그냥 크게 주면 "오래 때리면 죽는 벽"이지만, 재생이 붙으면 "화력이 모자라면
   * 영영 못 죽이는 벽"이 되어 잡을지 피할지를 판단하게 만듭니다.
   */
  hpRegenRatio?: number;
  /** 원거리적: 조준 시간. 작을수록 빨리 쏩니다 */
  aimTimeMul?: number;
  /** 돌진적: 돌진 예고 시간. 작을수록 빨리 튀어나옵니다 */
  telegraphMul?: number;
  /** 겁쟁이적: 달려드는 인식 사거리 */
  triggerRangeMul?: number;
  /** 겁쟁이적: 돌진 속도 */
  dashSpeedMul?: number;
  /** 자폭적: 시체가 터지기까지의 시간. 작을수록 빨리 터집니다 */
  corpseDelayMul?: number;
  /** 자폭적: 폭발 반경 */
  blastRadiusMul?: number;
  /** 분열적: 분열체도 한 번 더 나뉩니다 (1 → 3 → 9) */
  splitAgain?: boolean;
  /** 장판적: 장판 반경 */
  hazardRadiusMul?: number;
  /** 장판적: 감속 값 자체를 대체합니다. 클수록 덜 느려집니다 */
  hazardSlow?: number;
  /** 장판적: 한 틱 피해 = 그 개체의 공격력 x 이 값. 없으면 피해 없는 감속 장판입니다 */
  hazardDamageMul?: number;
  /** 소환적: 정예 전용 행동 (강한 적 소환 + 순간이동) */
  summonElite?: boolean;
  /** 방패적: 방패 내구도 = 최대 체력 x 이 값 */
  shieldRatio?: number;
  /** 방패적: 방패가 남아 있는 동안 받는 피해 배율 */
  shieldedDamageTaken?: number;
  /** 방패적: 방패가 깨진 뒤 받는 피해 배율 */
  brokenDamageTaken?: number;
  /** 바보적: 벽에 튕길 때 쏘는 탄의 수와 속도를 정예 값으로 바꿉니다 */
  foolElite?: boolean;
  /** 은신적: 드러나는 거리. 작을수록 더 가까이 와야 보입니다 */
  revealRangeMul?: number;
  /** 미라적: 되살아나기까지의 시간 */
  reviveDelayMul?: number;
}

export const ELITE_TRAITS: Partial<Record<EnemyId, EliteTrait>> = {
  /**
   * 더 느리고 단단한 벽. 체력을 5배까지 줬더니 그냥 시간을 잡아먹는 덩어리였습니다.
   * 3배로 줄이는 대신 초당 5% 재생을 붙여서, 화력이 모자라면 아예 못 죽이게 했습니다.
   * 잡을 수 있는가 없는가를 매번 판단하게 만드는 쪽이 단순히 두꺼운 것보다 낫습니다.
   */
  tank: { hpMul: 3.0, speedMul: 0.8, hpRegenRatio: 0.05 },
  /** 체력은 덜 오르는 대신 속도로 위협합니다. 단단해지면 빠른 적의 성격이 사라집니다 */
  fast: { hpMul: 2.0, speedMul: 1.4 },
  /** 조준이 빨라진 만큼 오래 살아남아야 그 이점이 드러납니다 */
  ranged: { hpMul: 2.0, aimTimeMul: 0.4 },
  /** 더 멀리서 알아채고 더 빠르게 달려듭니다. "근처에 가지 않는다"로는 못 피합니다 */
  coward: { triggerRangeMul: 1.5, dashSpeedMul: 1.5 },
  /** 직진 반사만 하던 적이 튕길 때마다 세 갈래로 쏩니다. 벽이 곧 포탑이 됩니다 */
  fool: { hpMul: 2.0, speedMul: 1.2, damageMul: 2.0, foolElite: true },
  /** 잡아도 정리할 시간이 절반뿐이고 그 범위도 넓습니다 */
  bomber: { corpseDelayMul: 0.5, blastRadiusMul: 1.5 },
  /** 1 → 3 → 9. 한 마리를 그냥 잡으면 화면이 순식간에 메워집니다 */
  splitter: { sizeMul: 1.5, splitAgain: true },
  /** 덜 느려지는 대신 밟고 있으면 계속 아픕니다. 감속만 있을 때와 판단이 달라집니다 */
  puddle: { hazardRadiusMul: 2.0, hazardSlow: 0.7, hazardDamageMul: 0.7 },
  /** 부르는 하수인이 정예가 됩니다. 그 외에는 일반 소환적과 똑같이 행동합니다 */
  summoner: { summonElite: true },
  /** 방패가 살아 있는 동안은 반만 아프고, 깨고 나면 더 아픕니다 */
  shield: { shieldRatio: 1.2, shieldedDamageTaken: 0.5, brokenDamageTaken: 1.2 },
  charger: { telegraphMul: 0.4 },
  /** 절반 거리까지 붙어야 드러납니다. 더 늦게 보인다는 뜻입니다 */
  stealth: { revealRangeMul: 0.5 },
  /** 되살아나는 데 절반밖에 안 걸립니다 (3초 → 1.5초) */
  mummy: { reviveDelayMul: 0.5 },
};

// ---------------------------------------------------------------------------
// 난이도 (-1 ~ 15). 선택 화면은 처음부터 열려 있습니다
// ---------------------------------------------------------------------------

/** 한꺼번에 쏟아지는 스폰 웨이브 */
export interface WaveSpec {
  /** 이 시간(초)부터 시작합니다 */
  startTime: number;
  /** 이 간격(초)마다 */
  interval: number;
  /** 한 번에 이만큼 */
  count: number;
}

/**
 * 난이도 한 단계마다 적에게 특수효과가 하나씩 더 붙습니다. 효과는 누적입니다.
 * 난이도 3 이면 1·2·3 의 효과가 전부 걸립니다.
 *
 * 각 항목은 "그 단계에서 새로 더해지는 양"이고 **곱이 아니라 합으로 쌓입니다.**
 * 1단계 체력 +20% 위에 3단계 체력 +10% 가 오면 최종은 +30%(x1.30) 입니다.
 * x1.20 * x1.10 = x1.32 가 아닙니다. 표에 적힌 퍼센트를 그냥 다 더한 값이 최종입니다.
 * 표에 없는 값은 그 단계에서 변하지 않습니다.
 *
 * 예외가 둘 있습니다. `wave` 와 `bomberWave` 는 더해지지 않고 **뒤 단계가 앞을 대체**합니다.
 * 웨이브는 "1분마다 5마리"와 "1분마다 15마리"를 동시에 돌릴 수 있는 성질이 아닙니다.
 */
export interface DifficultyStep {
  /** 선택 화면에 그대로 보여줄 문구 */
  label: string;
  hpMul?: number;
  /** 접촉·탄·장판·폭발 모두 */
  damageMul?: number;
  speedMul?: number;
  /** 원거리 사격 거리, 자폭·돌진 감지 거리 */
  rangeMul?: number;
  spawnRateMul?: number;
  eliteRatioMul?: number;
  maxAliveAdd?: number;
  bossHpMul?: number;
  bossDamageMul?: number;
  /** 적탄이 날아오는 속도 */
  bulletSpeedMul?: number;
  /** 몸에 닿았을 때의 피해만 따로 (탄·장판·폭발은 damageMul 쪽) */
  contactDamageMul?: number;
  /** 자폭병 전용 */
  bomberSpeedMul?: number;
  bomberDamageMul?: number;
  /** 겁쟁이 인내 시간 */
  cowardPatienceMul?: number;
  /** 장판 지속 시간 */
  hazardDurationMul?: number;
  /** 다음 난이도를 열려면 버텨야 하는 시간에 더해집니다 */
  clearTimeAdd?: number;
  /** 레벨업 선택지 수에 더해집니다 (음수면 줄어듭니다) */
  skillChoiceAdd?: number;
  /** 일반 스폰 웨이브. 뒤 단계가 다시 정하면 앞의 것을 대체합니다 */
  wave?: WaveSpec;
  /** 자폭병만 나오는 별도 웨이브 */
  bomberWave?: WaveSpec;
  /** 모든 적이 정예가 되고, 전부 정예라 구분할 대상이 없으므로 정예 표식을 감춥니다 */
  allElite?: boolean;
  /** 돌진적이 벽에 박아도 기절하지 않습니다 */
  chargerNoStun?: boolean;
  /** 돌진이 끝나면 곧바로 다음 예고를 시작합니다 (예고 시간은 그대로) */
  chargerNoCooldown?: boolean;
  /** 분열할 때 사방으로 탄을 뿌립니다 */
  splitterShoot?: boolean;
  /**
   * 판이 시작할 때 무적인 바보적 한 마리가 함께 등장합니다.
   * 처치할 수 없고 게임 내내 남아 벽을 튕겨다니는 "움직이는 장애물"입니다.
   * 이 한 마리뿐이고, 그 뒤에 나오는 보통 바보적은 평소대로 죽습니다.
   */
  foolInvuln?: boolean;
  /** 바보적이 튕길 때 쏘는 갈래 수를 이 값으로 갈아끼웁니다 */
  foolShotDirs?: number;
}

/**
 * 난이도 -1. 처음 잡는 사람이 익숙해지는 자리입니다.
 * 표의 1~15 와 달리 이것만 따로 있는 이유는 "0 에서 빼는" 방향이라 누적 대상이 아니기 때문입니다.
 */
export const DIFFICULTY_EASY: DifficultyStep = {
  label: '스폰율 -25%, 적 체력 -20%, 적 공격력 -20%, 코인 -30%',
  spawnRateMul: 0.75,
  hpMul: 0.8,
  damageMul: 0.8,
};

export const DIFFICULTY_STEPS: readonly DifficultyStep[] = [
  { label: '적 체력 +20%', hpMul: 1.2 },
  { label: '적 공격력 +20%', damageMul: 1.2 },
  { label: '클리어 조건 +15분, 적 체력 +10%', clearTimeAdd: 900, hpMul: 1.1 },
  { label: '적 이동속도 +10%, 적 공격력 +10%', speedMul: 1.1, damageMul: 1.1 },
  { label: '스폰율 +25%, 적탄 속도 +10%', spawnRateMul: 1.25, bulletSpeedMul: 1.1 },
  {
    label: '1분마다 적 5마리 웨이브, 적 공격력 +10%',
    wave: { startTime: 60, interval: 60, count: 5 },
    damageMul: 1.1,
  },
  { label: '적 체력 +30%', hpMul: 1.3 },
  {
    label: '스킬 선택지 -1개, 적 이동속도 +10%, 공격력 +10%, 체력 +15%',
    skillChoiceAdd: -1,
    speedMul: 1.1,
    damageMul: 1.1,
    hpMul: 1.15,
  },
  {
    label: '모든 적이 정예가 됨, 정예 표식 사라짐, 보스 체력·공격력 +15%',
    allElite: true,
    bossHpMul: 1.15,
    bossDamageMul: 1.15,
  },
  { label: '스폰율 +25%', spawnRateMul: 1.25 },
  {
    label: '웨이브가 5분부터 1분마다 15마리로 바뀜, 적 체력 +10%',
    wave: { startTime: 300, interval: 60, count: 15 },
    hpMul: 1.1,
  },
  {
    label: '3분부터 30초마다 자폭병 5마리, 자폭병 능력 강화',
    bomberWave: { startTime: 180, interval: 30, count: 5 },
    bomberSpeedMul: 0.8,
    bomberDamageMul: 1.2,
  },
  { label: '돌진적 능력 강화', chargerNoStun: true, chargerNoCooldown: true },
  { label: '분열적 능력 강화, 적 공격력 +20%, 체력 +25%', splitterShoot: true, damageMul: 1.2, hpMul: 1.25 },
  {
    label: '무적 바보적 1마리 상시 등장, 바보적·겁쟁이·장판적 능력 강화, 접촉 피해 +50%',
    foolInvuln: true,
    foolShotDirs: 8,
    contactDamageMul: 1.5,
    cowardPatienceMul: 0.5,
    hazardDurationMul: 1.2,
  },
] as const;

export const DIFFICULTY = {
  /** 고를 수 있는 범위. 16 이상은 없습니다 */
  min: -1,
  max: DIFFICULTY_STEPS.length,
  /** 다음 난이도를 열기 위한 기본 생존 시간(초). 3단계의 clearTimeAdd 가 여기에 더해집니다 */
  baseClearTime: 900,
  /** 난이도 1단계당 코인 획득 배율 증가. 높은 난이도를 고를 이유를 만듭니다 */
  coinMulPerLevel: 0.15,
  /** 난이도 -1 의 코인 배율 */
  easyCoinMul: 0.7,
  /**
   * 보스 코인은 난이도 이 값마다 bossCoinMul 만큼 오릅니다.
   * 다른 배율과 같이 **합**입니다. 3단계마다 +20%p 이므로 15단계에서 x2.00 입니다
   */
  bossCoinPerLevels: 3,
  bossCoinMul: 1.2,
  /** 정예 비율이 이 값을 넘지 않게 막습니다 (allElite 단계는 예외로 전원입니다) */
  eliteRatioCap: 0.85,
  /** 보스가 나오는 순간의 웨이브는 건너뜁니다. 보스 등장 앞뒤 이 초 안이면 생략합니다 */
  waveBossSkipWindow: 4,
} as const;

// ---------------------------------------------------------------------------
// 스폰과 난도 곡선 (기획.md 7장)
// ---------------------------------------------------------------------------

export const SPAWN = {
  /** 동시 존재 적 수 상한. 화면 고정 맵이라 이게 없으면 피할 곳이 사라집니다 */
  maxAlive: 80,
  /**
   * 스폰을 "간격 + 뭉치 수"가 아니라 초당 마리 수로 직접 정합니다.
   * 상한에 눌려 스폰이 아예 멈추면 늦게 해금되는 적이 등장할 기회를 잃습니다.
   * rateMax 가 곧 리스폰율의 한계입니다.
   */
  rateStart: 1.3,
  rateMax: 2.6,
  /** 이 시간(초)에 최대 리스폰율에 도달 */
  rateRampTime: 480,
  /** 스폰 예고 시간 */
  warning: 0.5,
  /** 화면 가장자리에서 안쪽으로 이만큼 들어온 지점에 나옵니다 */
  edgeInset: 18,
  /** 정예 비율: 이 시간부터 0에서 시작해 */
  eliteStartTime: 90,
  eliteMaxRatio: 0.4,
  eliteRampTime: 600,
} as const;

/** 보스 (기획.md 4장) */
export const BOSS = {
  /** 등장 주기(초) */
  interval: 300,
  /**
   * 보스 체력에는 TIME_SCALING 을 적용하지 않습니다.
   * 기본공격이 "가장 가까운 적"을 노리므로 잡몹에 둘러싸인 보스는 실제로 맞는 시간이
   * 짧습니다. 여기에 시간 배율까지 겹치면 보스를 아예 못 잡고 다음 보스도 막힙니다.
   */
  hp: 1600,
  damage: 24,
  /** 너무 느리면 잡몹 뒤에 처져서 자동 타겟이 잡히지 않습니다 */
  speed: 82,
  radius: 44,
  xp: 120,
  coinDrop: 25,
  /** 처치 시 최대 체력의 이 비율만큼 회복 */
  healRatio: 0.3,
  /**
   * 보스가 있는 동안 일반 스폰 간격에 곱하는 값. 1 이면 평소와 똑같이 나옵니다.
   *
   * 원래 5(= 스폰율 0.2배)였습니다. "잡몹이 가득하면 기본공격이 보스에 닿지 않는다"는
   * 걱정 때문이었는데, 실제로 플레이해보니 그 정도로 막히지 않았고 보스전만 한산해져서
   * 오히려 긴장이 풀렸습니다. 1 로 되돌렸습니다.
   * 보스전이 다시 답답해지면 여기부터 올리십시오.
   */
  spawnSlow: 1,
  /** 셋이 공유하는 탄 기본값 */
  burstSpeed: 165,
  burstDamage: 12,
  /** 등장할 때마다 이만큼씩 단단해집니다 */
  hpGrowthPerSpawn: 0.6,
  /**
   * 동시에 살아 있을 수 있는 보스 수.
   *
   * 예전에는 1 이었습니다. 즉 앞 보스를 못 잡으면 다음 보스가 영영 안 나오고
   * 보스가 주는 코인과 회복까지 같이 끊겼습니다. 지금은 못 잡으면 **쌓입니다.**
   * 벌이 확실해진 대신, 상한이 없으면 30분 판에서 여섯 마리가 겹치므로 여기서 막습니다.
   *
   * 보스는 등장 횟수마다 `hpGrowthPerSpawn` 으로 단단해지므로, 겹치면 뒤에 온 쪽이 더 셉니다.
   */
  maxAlive: 3,
} as const;

/**
 * 보스 종류. 등장할 때마다 이 순서로 돌아가며 나옵니다.
 *
 * 한 종류만 있으면 두 번째 보스부터는 체력만 늘어난 같은 싸움이 반복됩니다.
 * 셋은 요구하는 대응이 서로 다릅니다.
 * - 포식자: **근접 위주.** 짧은 예고로 계속 돌진하고 착지할 때 충격파를 냅니다. 붙지 않고 싸웁니다
 * - 폭격기: **탄막 위주.** 바닥 폭격에 더해 사방으로 탄을 뿌립니다. 자리도 옮기고 탄도 피해야 합니다
 * - 군체왕: **잡몹 위주.** 근접도 탄막도 약한 대신 화면의 잡몹 수에 비례해 강해지고,
 *   잡몹이 일정 수를 넘으면 그것을 삼켜 대형 탄막으로 뱉습니다. 화면 정리가 곧 대응입니다
 */
export type BossId = 'boss' | 'bombard' | 'swarm';

export const ALL_BOSS_IDS: readonly BossId[] = ['boss', 'bombard', 'swarm'] as const;

/** 종류별 차이. 공통 수치는 위 BOSS 를 그대로 씁니다 */
export const BOSS_VARIANTS: Record<BossId, { hpMul: number; speedMul: number; damageMul: number; radiusMul: number }> = {
  boss: { hpMul: 1.0, speedMul: 1.0, damageMul: 1.0, radiusMul: 1.0 },
  // 느린 대신 단단합니다. 붙어서 때리기는 쉽지만 발밑이 계속 위험해집니다
  bombard: { hpMul: 1.2, speedMul: 0.6, damageMul: 1.1, radiusMul: 1.12 },
  // 빠르고 작습니다. 오래 끌면 잡몹에 파묻힙니다
  swarm: { hpMul: 0.85, speedMul: 1.5, damageMul: 0.9, radiusMul: 0.86 },
};

/**
 * 포식자 보스: 근접 위주.
 *
 * 예전에는 7.5초마다 한 번 돌진하고 나머지 시간은 탄막을 뿌렸습니다. 그래서 셋 중
 * 가장 "탄막 보스"처럼 굴었고 폭격기와 성격이 겹쳤습니다. 지금은 돌진 간격을 절반 이하로
 * 줄이고 예고도 짧게 잡아, 계속 몸으로 밀고 들어오는 쪽으로 몰았습니다.
 * 대신 탄막은 드물게 나가고 발수도 적습니다.
 */
export const BOSS_PREDATOR = {
  burstInterval: 7.2,
  burstCount: 10,
  chargeInterval: 3.0,
  chargeTelegraph: 0.85,
  chargeSpeedMul: 4.5,
  chargeTime: 1.1,
  /** 돌진이 끝나는 자리에 터지는 충격파. 돌진을 피해도 착지점에 서 있으면 맞습니다 */
  slamRadius: 135,
  slamDamageMul: 0.8,
  summonInterval: 12,
  summonCount: 3,
} as const;

/**
 * 폭격기 보스: 탄막 위주.
 * 바닥 폭격만으로는 "자리를 옮긴다" 하나로 끝나서, 옮기는 동안 맞을 것을 같이 뿌립니다.
 */
export const BOSS_BOMBARD = {
  volleyInterval: 3.6,
  /** 한 번에 떨어지는 발수 */
  shots: 7,
  /** 예고부터 착탄까지. 이 시간 안에 자리를 뜨면 됩니다 */
  warning: 1.4,
  blastRadius: 88,
  /** 보스 접촉 피해에 대한 배수 */
  blastDamageMul: 1.1,
  /** 플레이어를 중심으로 이 반경 안에 흩뿌립니다 */
  spread: 250,
  /** 첫 발은 항상 플레이어가 서 있던 자리입니다. 가만히 있으면 반드시 맞습니다 */
  firstShotOnPlayer: true,
  /** 폭격과 별개로 도는 사방 탄막 */
  burstInterval: 2.1,
  burstCount: 14,
  /** 한 번 걸러 한 번은 각도를 반 칸 어긋나게 쏴서 같은 자리로 피할 수 없게 합니다 */
  burstOffsetAlternate: true,
  /** 플레이어를 정조준해 빠르게 나가는 세 갈래 */
  aimedInterval: 4.4,
  aimedCount: 3,
  aimedSpread: 0.26,
  aimedSpeedMul: 1.8,
} as const;

/**
 * 군체왕 보스: 잡몹 위주.
 *
 * 근접도 탄막도 다른 둘보다 약합니다. 대신 **화면의 잡몹 수가 곧 이 보스의 세기**입니다.
 * 잡몹을 그냥 두면 나선이 갈래를 늘려가고, 일정 수를 넘기면 주변 잡몹을 삼켜서
 * 삼킨 수만큼 대형 탄막으로 뱉습니다. 삼킨 잡몹은 사라지므로 화면은 정리되지만,
 * 그 대가를 탄막으로 치릅니다. "잡몹을 내가 정리할 것인가, 보스가 삼키게 둘 것인가"의 선택입니다.
 */
export const BOSS_SWARM = {
  /** 탄을 한 발씩 흘립니다. 포식자·폭격기보다 느슨합니다 */
  spiralInterval: 0.42,
  /** 한 발마다 각도가 이만큼(라디안) 돌아갑니다 */
  spiralStep: 0.6,
  /** 기본 갈래 수 */
  spiralArms: 1,
  spiralSpeed: 185,
  spiralDamageMul: 0.75,
  /** 잡몹이 이만큼 늘 때마다 나선 갈래가 하나씩 붙습니다 */
  armsPerMinions: 12,
  /** 갈래 수 상한. 없으면 화면이 탄으로 덮입니다 */
  maxSpiralArms: 6,
  summonInterval: 4.5,
  summonCount: 4,

  /** 삼키기: 잡몹이 이 수를 넘으면 발동합니다 */
  devourThreshold: 20,
  devourInterval: 7.0,
  /** 이 반경 안의 잡몹을 삼킵니다 */
  devourRadius: 420,
  /** 한 번에 삼킬 수 있는 최대 마리 수 */
  devourMax: 24,
  /** 삼킨 1마리당 뱉는 탄 수 */
  shotsPerDevoured: 2,
  devourTelegraph: 1.0,
  devourBulletSpeed: 230,
  devourDamageMul: 0.8,

  /** 분노: 체력이 이 비율 밑으로 떨어지면 한 번만 발동합니다 */
  enrageHpRatio: 0.5,
  enrageInvuln: 3.0,
  /** 자기 자리에 한꺼번에 쏟아내는 잡몹 수 */
  enrageSummonCount: 18,
} as const;

// ---------------------------------------------------------------------------
// 기본공격과 스킬 (기획.md 5장)
// damage 계열 값은 전부 "공격력 스탯에 대한 배수"입니다.
// ---------------------------------------------------------------------------

export const BASIC_ATTACK = {
  bulletRadius: 5,
  /** 기본공격은 관통하지 않습니다 */
  pierce: 0,
  color: '#ffe08a',
} as const;

/**
 * 모든 스킬의 최대 레벨. 5 → 7 → **10** (2026-08-12).
 *
 * 이 값을 만질 때는 반드시 `LEVEL.skillLevels` 를 같이 보십시오. 스킬 4칸을 채우는 데
 * 필요한 선택 횟수가 `4 + (상한-1) x 4` 인데, 판당 오는 선택 횟수가 그보다 훨씬 적으면
 * 위쪽 레벨은 존재하지 않는 것과 같습니다. 상한 10 이면 **40회**가 필요하고,
 * 3레벨마다 선택이면 Lv.120 이라 한 판에 넷을 다 채우는 것은 사실상 불가능합니다.
 * **그래도 됩니다.** 두 개를 만렙(22회)으로 몰거나 넷을 고르게 올리거나의 갈림길이
 * 이 게임의 빌드이고, 전부 채워지면 그 선택이 사라집니다.
 *
 * **`SKILLS` 의 perLevel 값은 "만렙에서 얼마"를 9로 나눈 값입니다.** 상한을 바꾸면
 * 나누는 수도 바꿔야 만렙 위력이 그대로 유지됩니다. 상한만 올리고 perLevel 을 두면
 * 만렙 위력이 같이 뛰어서, 성장 곡선이 아니라 최종 화력을 건드린 셈이 됩니다.
 */
export const SKILL_MAX_LEVEL = 10;

/**
 * 화염방사기 재사용 대기. **화상 지속(`burnTime`)과 같은 값이어야 해서** 밖으로 뺐습니다
 * (2026-08-13).
 *
 * 규칙은 하나입니다. **화상 지속 ≥ 재사용 대기.** 그래야 한 번 붙인 불이 다음 분사가
 * 돌아올 때까지 안 꺼지고, 계속 겨누고 있으면 계속 탑니다. 예전에는 화상이 3초인데
 * 쿨이 5초라 낮은 레벨에서 매 주기 0.4초씩 불이 꺼졌습니다. 그 틈에 정예 탱커가
 * 재생을 되찾아서, "재생을 멈춘다"는 이 스킬의 정체성이 반쯤 헛돌았습니다.
 *
 * 분사 시간(`duration`)으로 메우는 방법도 있었지만 그건 **적이 부채꼴 안에 끝까지
 * 머물러 있을 때만** 성립합니다. 스치고 지나간 적은 여전히 꺼집니다. 쿨다운에 맞추면
 * 틱 한 번만 닿아도 다음 분사까지 탑니다.
 *
 * 쿨다운 감소 스탯은 쿨만 줄이므로 이 부등호를 깨지 않습니다.
 * 규칙은 `scripts/smoke.ts` 3-4번이 잡습니다.
 */
const FLAME_COOLDOWN = 5.0;

export const SKILLS = {
  /**
   * 만렙 위력을 300% → **220%** 로 낮춰 잡았습니다.
   * 레벨당 발수가 2개씩(만렙 17발) 늘어나는데 위력까지 3배가 되면 두 증가가 곱해져서,
   * 만렙 총합이 51.0 으로 2위(지뢰 26.0)의 두 배가 됐습니다. 220% 면 총합 37.4 로
   * 체인(31.8)·지뢰(26.0)와 같은 줄에 섭니다.
   */
  shotgun: {
    cooldown: 2.2, damage: 0.7, damagePerLevel: 0.103,
    pellets: 5, pelletsPerLevel: 2, spread: 0.42, range: 270, speed: 470, knockback: 70,
  },
  /**
   * 관통을 없애고 위력을 2배로 올린 **단일 대상 저격**입니다 (2026-08-12).
   * 타겟도 "가장 먼 적"에서 "체력이 가장 많은 적"으로 바뀌었습니다.
   *
   * 관통을 레이저에 넘긴 것이 요점입니다. 예전에는 둘 다 전관통이라 레이저가
   * 스나이퍼의 하위호환이었습니다(쿨은 길고 위력은 낮은데 값은 더 비쌌습니다).
   * 지금은 스나이퍼=단일 고화력, 레이저=관통 광역으로 역할이 갈립니다.
   *
   * **2026-08-13 에 다시 버프했습니다.** 쿨 3.2 → 2.5 초, 위력 배수는 곡선째 2배
   * (1레벨 500% → 1000%, 만렙 1340% → 2680%). DPS 로는 2.56배입니다.
   * 단일 대상 · 관통 없음이라는 제약을 그대로 두고 "한 발의 무게"만 키운 것이라,
   * 잡몹이 몰리는 상황에서는 여전히 산탄·체인 아래입니다.
   *
   * **`hpRatio`: 맞은 적의 최대 체력에 비례하는 추가 피해입니다** (같은 날 추가).
   * 물량 게임에서 단일 대상 스킬은 "총 화력"이라는 같은 축으로는 산탄·체인을 절대
   * 못 이깁니다. 그래서 축을 바꿉니다. 잡몹에는 거의 안 붙고 탱커·정예·보스에만
   * 크게 붙어서, 스나이퍼가 "가장 단단한 하나를 맡는" 스킬이 됩니다.
   *
   * 조건을 "보스"로 잡지 않은 이유는 보스가 살아 있는 시간이 판의 5~10% 뿐이라,
   * 보스 한정이면 공격 3칸 중 하나를 나머지 90% 동안 놀리게 되기 때문입니다.
   * 최대 체력 기준이면 판 내내 일하면서도 대상은 여전히 단단한 적으로 좁혀집니다.
   *
   * **치명타는 이 추가 피해에 곱해지지 않습니다.** 치명타 배율 상한이 4.0 이라
   * 곱하면 만렙에서 대상 최대 체력의 120% 가 한 발에 들어가서, 무엇이든 크리 한 방에
   * 지워집니다. 치명타는 공격력 스탯에 걸리는 배율이고 이쪽은 대상에 걸리는 항이라
   * 성질도 다릅니다. 규칙은 `scripts/smoke.ts` 3-3번이 잡습니다.
   *
   * **남은 체력이 아니라 최대 체력입니다.** 남은 체력 기준이면 계속 반감이라 절대
   * 안 죽고, 처형(남은 체력 비례)은 패시브 축 초안에 이미 잡혀 있어서 겹칩니다.
   */
  sniper: {
    cooldown: 2.5, damage: 10.0, damagePerLevel: 1.866,
    speed: 1150, radius: 7,
    /** 1레벨 10% → 만렙 30%. `(0.30 - 0.10) / (SKILL_MAX_LEVEL - 1)` 입니다 */
    hpRatio: 0.10, hpRatioPerLevel: 0.2 / 9,
  },
  flame: {
    // damage 는 "초당 공격력 배수"입니다
    cooldown: FLAME_COOLDOWN, damage: 2.2, damagePerLevel: 0.333,
    duration: 1.6, durationPerLevel: 0.107, range: 185,
    /** 부채꼴 **반각**. 레벨당 1도씩 벌어집니다 (만렙 22.9° → 28.9°) */
    spread: 0.4, spreadPerLevel: Math.PI / 180,
    /** 화상 지속 = 재사용 대기. 위 `FLAME_COOLDOWN` 주석의 부등호를 지키는 값입니다 */
    tick: 0.1, burnDps: 0.45, burnTime: FLAME_COOLDOWN,
    /**
     * 화상이 남아 있는 동안의 **감속량**입니다. 0.1 이면 이동속도 10% 감소.
     *
     * 배율(0.9)이 아니라 감속량으로 적은 이유는 **다른 감속과 더하기 때문**입니다
     * (2026-08-13). `STATUS.slowCap` 주석을 보십시오.
     */
    burnSlow: 0.1,
  },
  /**
   * 도탄 (탄환 계열, 2026-08-12 추가). 계열을 3/3/3/3 으로 맞추려고 넣었습니다.
   *
   * 적을 맞히면 **튕겨서 다음 적으로 날아갑니다.** 체인과 헷갈리기 쉬운데 계열이 갈리는
   * 지점이 분명합니다. 체인은 전기가 순간이동하는 **즉발(관통 계열)**이고, 이쪽은 탄이
   * 실제로 날아가므로 **탄환 계열**입니다. 그래서 도탄은 도중에 놓칠 수 있고, 대신
   * 화면을 돌아다니는 동안 계속 일합니다.
   *
   * **벽 튕김은 명중 횟수를 안 씁니다.** 안 그러면 적이 흩어져 있을 때 벽만 두어 번
   * 치고 사라져서, 경기장이 고정된 이 게임에서 가장 흔한 상황에 제일 약해집니다.
   */
  ricochet: {
    cooldown: 2.8, damage: 1.0, damagePerLevel: 0.13,
    bounces: 3, bouncesPerLevel: 1,
    speed: 620, radius: 6,
  },
  /** 스나이퍼가 관통을 잃은 대신 이쪽이 유일한 전관통입니다 */
  laser: {
    cooldown: 4.5, damage: 1.98, damagePerLevel: 0.403,
    width: 15, widthPerLevel: 5,
  },
  /**
   * 작살 (관통 계열, 2026-08-12 추가).
   *
   * 직선상의 적을 전부 꿰뚫고 **플레이어 쪽으로 끌어당깁니다.** 피해는 레이저보다
   * 훨씬 낮습니다. 이 스킬의 값어치는 화력이 아니라 **적을 모으는 것**이라,
   * 폭발·지속 계열과 짝지으면 그쪽이 세집니다.
   *
   * **타겟이 "가장 먼 적"입니다.** 스나이퍼를 단일 저격으로 바꾸면서 이 게임에서
   * "가장 먼 적"을 노리는 스킬이 하나도 없어졌고, 그 바람에 멀리서 배회하며 계속
   * 소환하는 소환적을 잡을 수단이 사라졌습니다 (CLAUDE.md 규칙 7). 작살이 그 자리를
   * 대신합니다. 꿰뚫고 끌어오므로 소환적을 사거리 안으로 데려오기까지 합니다.
   */
  harpoon: {
    cooldown: 5.0, damage: 1.5, damagePerLevel: 0.278,
    width: 20, widthPerLevel: 4,
    /** 끌어당기는 힘. `damageEnemy` 의 knockback 에 음수로 넘깁니다 */
    pull: 260,
  },
  /**
   * 만렙 반경 158 은 지름이 경기장 가로(1280)의 **24.7%** 입니다.
   * 이 값을 올릴 때는 화면을 얼마나 덮는지부터 보십시오.
   */
  grenade: {
    cooldown: 3.6, damage: 2.1, damagePerLevel: 0.4,
    blast: 92, blastPerLevel: 7.33, travelSpeed: 700, minRange: 60,
  },
  /** 방패에 막히는 세 스킬 중 하나입니다 (나머지는 산탄·화염방사기) */
  missile: {
    cooldown: 2.5, damage: 0.9, damagePerLevel: 0.095,
    count: 3, countPerLevel: 1, speed: 300, turnRate: 6.0, life: 3.2, blast: 26,
  },
  /**
   * 체인은 1타가 약한 대신 무리를 상대하는 스킬입니다.
   * damage 를 올려서 강화하면 "약한 스나이퍼"가 될 뿐이라 1타는 건드리지 않고,
   * 무리를 때리는 쪽만 풀었습니다. 감쇠는 0.85 → 0.92 로 완화했습니다.
   *
   * **연쇄 사거리는 없습니다.** jumps 가 4 면 화면 어디에 있든 4명을 때립니다.
   * 사거리를 두면 "적이 몇이나 있는가"가 아니라 "그 적들이 마침 붙어 있었는가"가
   * 성능을 정해버려서, 무리를 상대하는 스킬이라는 정체성이 운에 좌우됩니다.
   * 대상이 모자랄 때만 중간에 끊깁니다.
   */
  chain: {
    cooldown: 3.4, damage: 1.62, damagePerLevel: 0.247,
    jumps: 4, jumpsPerLevel: 1, falloff: 0.92,
    /** 맞은 적이 잠시 멈춥니다. 보스는 `STATUS.bossStatusResist` 만큼 덜 받습니다 */
    stun: 0.5,
  },
  /**
   * 회전 궤도에는 쿨다운도 지속시간도 없습니다. 고르는 순간부터 항상 돌아갑니다.
   *
   * 원래는 쿨 6초에 지속 5초였는데, 쿨다운 감소를 조금만 올리면 쿨이 지속시간보다
   * 짧아져서 구체가 겹쳐 쌓였습니다. 지속형 스킬에 "다시 켜기"를 두면 반드시 생기는
   * 문제라, 켜고 끄는 개념 자체를 없앴습니다. 대신 damage 를 그만큼 낮춰 잡습니다.
   * 레벨이 오르면 구체 수가 늘고, 그 자리에서 곧바로 다시 배치됩니다.
   */
  orbit: {
    // 예전 가동률(지속 5초 / 쿨 6초 = 83%)만큼 낮춰 잡은 값입니다 (0.65 x 0.83)
    cooldown: 0, damage: 0.54, damagePerLevel: 0.066,
    count: 2, countPerLevel: 1,
    /**
     * 반경 70 → **110** 으로 넓혔습니다. 레벨이 올라도 더 넓어지지는 않습니다.
     *
     * **각속도는 3.1 그대로 두어야 합니다.** 한 적이 맞는 횟수는 "구체 수 ÷ 한 바퀴 도는
     * 시간"으로 정해지고 반경은 여기에 들어가지 않습니다. 반경을 키웠다고 각속도를 낮추면
     * 주기가 길어져서 **타격이 오히려 36% 줄어듭니다.**
     *
     * 대신 반경이 커진 만큼 구체가 적을 스치고 지나가는 시간이 짧아지므로(선속도 217 → 341),
     * 타격 간격을 0.32 → **0.20** 으로 줄여 그 몫만 보정합니다. 두 값은 짝이라
     * 반경을 다시 만지면 `hitInterval` 도 `0.32 x (70 / 새 반경)` 으로 같이 맞추십시오.
     */
    radius: 110, angularSpeed: 3.1, bodyRadius: 11, hitInterval: 0.2,
  },
  /**
   * 지뢰에는 **동시 개수 상한이 없습니다.**
   *
   * 예전에는 8개까지만 깔 수 있었는데, 그러면 레벨이 오를수록 손해였습니다.
   * 레벨 5 는 한 번에 5개를 까므로 두 번만 깔면 상한에 닿고, 그 뒤로는 발동이
   * 통째로 막혔습니다. 성장시킬수록 못 쓰게 되는 스킬은 고를 이유가 없습니다.
   *
   * 대신 2개째부터는 발밑이 아니라 주변에 흩뿌립니다. 한자리에 겹쳐 깔면
   * 개수가 늘어도 실제로 덮는 넓이가 안 늘어서, 이것도 레벨이 헛도는 것과 같습니다.
   */
  mine: {
    cooldown: 2.6, damage: 1.9, damagePerLevel: 0.367,
    blast: 82, arm: 0.3, life: 14, count: 1, countPerLevel: 1, radius: 9,
    /**
     * 한 번에 까는 개수의 상한. 5레벨에서 멈추고 그 뒤로는 위력만 오릅니다.
     * **동시에 깔려 있을 수 있는 개수의 상한이 아닙니다.** 그건 예전에 8개였는데,
     * 레벨이 오를수록 발동이 막혀서 없앴습니다 (아래 주석 참고).
     */
    countMax: 5,
    /**
     * 2개째부터 흩어지는 반경. 코인 획득 범위의 **기본값(1레벨)** 과 같은 넓이입니다.
     *
     * `pickupRange` 스탯을 읽지 않고 이 값을 그대로 씁니다. 스탯을 읽으면 코인 자석을
     * 살수록 지뢰가 넓게 퍼져서, 지뢰와 아무 상관 없는 강화가 지뢰를 약하게 만듭니다.
     */
    spread: BASE_STATS.pickupRange,
  },
  aura: {
    // damage 는 "초당 공격력 배수"입니다
    cooldown: 7.0, damage: 1.3, damagePerLevel: 0.213,
    /**
     * 지속 증가를 0.5 → **0.4** 로 낮췄습니다. 상한이 7레벨이 되면서 0.5 로 두면
     * 만렙 지속이 정확히 7.0 초로 쿨다운과 같아져 **가동률 100%** 가 됩니다.
     * 그러면 지속시간도 쿨다운도 둘 다 의미를 잃습니다. 0.4 면 만렙 6.4초(91%)입니다.
     */
    duration: 4, durationPerLevel: 0.267, radius: 120, radiusPerLevel: 8,
    tick: 0.2, slow: 0.55,
  },
  dash: {
    cooldown: 3.0, damage: 0, damagePerLevel: 0,
    distance: 195, distancePerLevel: 12, time: 0.16, invulnAfter: 0.2,
  },
  /**
   * 하이리스크 하이리턴으로 다시 잡았습니다 (2026-08-12).
   * 피해 3배 · 기절 2초를 받는 대신 **쓸 때마다 최대 체력의 20% 를 스스로 깎습니다.**
   *
   * 예전에는 피해가 없는 것과 같아서(만렙 초당 0.27) 대시를 이길 이유가 없었습니다.
   * 유틸은 한 칸뿐이라 "무적으로 빠져나간다" 하나만 정답이면 나머지가 장식이 됩니다.
   */
  knockback: {
    cooldown: 5.0, damage: 1.65, damagePerLevel: 0.4,
    radius: 152, radiusPerLevel: 9.33, force: 470, stun: 2.0,
    /** 쓸 때마다 **최대 체력**의 이 비율만큼 스스로 깎습니다 (현재 체력 기준이 아닙니다) */
    selfDamageRatio: 0.2,
  },
  timeslow: {
    cooldown: 14, damage: 0, damagePerLevel: 0,
    duration: 2.5, durationPerLevel: 0.267, scale: 0.32,
  },
  /**
   * 긴급 의약품 (2026-08-12 추가). 유틸 4번째입니다.
   *
   * 넉백이 최대 체력을 태우는 스킬이 되면서 회복 수단이 필요해졌는데, 둘 다 유틸이라
   * **같이 들 수 없습니다.** 의도한 것입니다. 넉백 빌드는 `regen` 스탯과 보스 처치
   * 회복으로 버텨야 하고, 이쪽을 들면 대신 탈출 수단이 없습니다.
   */
  medkit: {
    cooldown: 20, damage: 0, damagePerLevel: 0,
    /** 최대 체력의 이 비율만큼 회복합니다 (만렙 38%) */
    heal: 0.2, healPerLevel: 0.02,
  },
} as const;

// ---------------------------------------------------------------------------
// 스킬 분기 (6레벨 강화 갈래)
// ---------------------------------------------------------------------------

/**
 * 공격 스킬이 이 레벨에 도달하면 두 갈래 중 하나를 고릅니다 (2026-08-13).
 *
 * 그 전까지 스킬 성장은 **숫자만 커지는 한 줄기**였습니다. 10레벨 지뢰는 1레벨 지뢰가
 * 그냥 세진 것이라, 스킬을 고른 뒤에는 판이 끝날 때까지 아무 결정도 없었습니다.
 * 6레벨에 갈래를 두면 "지뢰를 뽑았다"가 아니라 "어떤 지뢰를 만들었다"가 됩니다.
 *
 * **상한(10)보다 낮아야 합니다.** 갈래를 고른 뒤에도 성장이 남아 있어야
 * 그 선택이 이후 판에 계속 작용합니다.
 */
export const SKILL_BRANCH_LEVEL = 6;

/**
 * 갈래 하나가 담는 것. **적지 않은 항목은 원래 값 그대로입니다.**
 *
 * 크게 둘로 나뉩니다.
 * - `*Mul` 은 **곱합니다.** 중립값 1. 레벨 성장과 자연스럽게 맞물립니다
 * - 나머지는 **덮어씁니다.** 중립값은 "없음". 곱셈으로 표현하면 못 읽는 값
 *   (체인 감쇠 0.92 → 1.0)과 없던 동작을 켜는 스위치가 여기 들어갑니다
 *
 * `sizeMul` 이 무엇에 걸리는지는 스킬마다 다릅니다. 한 스킬이 크기를 두 개
 * 갖는 경우가 없어서 칸을 하나로 뒀습니다.
 * 지뢰·유탄·미사일 = 폭발 반경, 레이저·작살 = 폭, 궤도 = **구체 크기**(공전 반경 아님).
 */
export interface SkillBranchDef {
  id: string;
  name: string;
  desc: string;

  // --- 곱합니다 (중립 1) ---
  cooldownMul?: number;
  damageMul?: number;
  countMul?: number;
  sizeMul?: number;
  rangeMul?: number;
  durationMul?: number;
  /** 틱·타격 간격. 작을수록 자주 때립니다 */
  cadenceMul?: number;
  jumpsMul?: number;
  /** 관통·명중 횟수 */
  pierceMul?: number;
  pullMul?: number;
  /** 스나이퍼의 최대 체력 비례항 */
  hpBonusMul?: number;
  speedMul?: number;
  knockbackMul?: number;
  stunMul?: number;
  spreadMul?: number;
  turnRateMul?: number;

  // --- 덮어씁니다 (중립 없음) ---
  /** 부채꼴 **반각** 절대값. `Math.PI` 면 전방위 */
  spread?: number;
  /** 체인 감쇠 */
  falloff?: number;
  /** 오라 감속 배율 (작을수록 느려집니다) */
  slow?: number;
  /** 명중한 적에게 붙일 화상. dps 는 **공격력 배수**입니다 */
  burn?: { dps: number; time: number };
  /** 폭발한 자리에 남길 장판. 비율은 전부 **그 폭발의 피해량 기준**입니다 */
  blastHazard?: {
    duration: number;
    tickInterval: number;
    /** 한 틱 피해 = 폭발 피해 x 이 값 */
    damageRatio: number;
    /** 장판 반경 = 폭발 반경 x 이 값 */
    radiusMul: number;
    /** 밟은 적에게 붙일 화상. 초당 피해 = 폭발 피해 x 이 값. 0 이면 안 붙습니다 */
    burnRatio: number;
    burnTime: number;
    color: string;
  };
  /** 명중한 적을 이 시간(초)만큼 기절시킵니다. 원래 기절이 없던 스킬에 붙일 때 씁니다 */
  stunOnHit?: number;
  /** 남은 체력이 `hpRatio` 이하인 대상에게 피해 x`mul` */
  execute?: { hpRatio: number; mul: number };
  /** 착탄 뒤 주변에 터지는 자탄 */
  cluster?: { count: number; radiusMul: number; damageMul: number; spreadMul: number };
  /** 명중할 때마다 갈라지는 수. 총 개수 상한도 같이 둡니다 */
  splitOnHit?: { count: number; max: number };
  /** 궤도 구체가 때릴 때 터지는 작은 폭발 */
  orbFragment?: { radius: number; damageMul: number };
  /** 지속이 끝날 때 반경 전체에 터지는 폭발. 피해 = 초당 피해 x 이 값 */
  endBlast?: { damageMul: number };
}

/**
 * 스킬별 두 갈래. **1번은 강화, 2번은 특수로 자리가 고정입니다** (2026-08-13).
 *
 * | | 1번 · 강화 | 2번 · 특수 |
 * |---|---|---|
 * | 바뀌는 것 | 수치만. 하던 일을 더 크게·세게 | **없던 동작이 붙습니다** |
 * | 대가 | 같은 축 안에서 맞바꿈 (개수↔위력) | 기본 수치가 내려갑니다 |
 * | 구현 | 이 표에 수치만 | registry 수정이 필요합니다 |
 *
 * 자리가 성격을 뜻하면 두 카드를 다 읽지 않아도 무엇을 고르는지 압니다.
 * 그래서 **1번에는 덮어쓰기 항목이 하나도 없어야 하고 2번에는 하나 이상 있어야 합니다.**
 * `scripts/smoke.ts` 3-0c 가 이 규칙을 잡습니다.
 *
 * **세기 규칙은 "서로 다른 축을 강화하되 각자 대가를 진다"입니다.**
 * 패시브의 제1규칙(페널티 > 보너스)과 반대인데, 패시브는 무제한 보유라 스스로
 * 제한이 걸려야 하지만 갈래는 1중 1 배타라 **포기한 반대편이 이미 대가**입니다.
 */
export const SKILL_BRANCHES = {
  mine: [
    {
      id: 'mineGiant', name: '거대 지뢰',
      desc: '수는 3분의 1, 하나하나가 훨씬 크고 아픕니다',
      // countMul x damageMul 이 정확히 1 입니다. 총합을 안 바꾸고 형태만 바꾸는 갈래라
      // 이 곱이 1 을 벗어나면 "형태를 바꾸는 갈래"가 "세지는 갈래"가 된 것입니다
      countMul: 1 / 3, damageMul: 3, sizeMul: 2, cooldownMul: 1.3,
    },
    {
      id: 'mineFire', name: '화염 지뢰',
      desc: '터진 자리에 불이 남습니다. 밟은 적은 계속 탑니다',
      damageMul: 0.7,
      blastHazard: {
        duration: 3, tickInterval: 0.5, damageRatio: 0.3, radiusMul: 1,
        burnRatio: 0.2, burnTime: 2, color: '#ff7a3d',
      },
    },
  ],
  flame: [
    {
      id: 'flameBarrel', name: '연장 총구',
      desc: '멀리, 오래. 대신 부채꼴이 좁아집니다',
      // ⚠ 쿨다운을 늘리면 안 됩니다. `화상 지속 >= 쿨다운` 부등호가 깨져서
      //    매 주기 불이 꺼지고 "재생을 멈춘다"는 정체성이 무너집니다
      rangeMul: 2, durationMul: 1.5, damageMul: 1.2, spreadMul: 0.4,
    },
    {
      id: 'flameGas', name: '가스 분출',
      desc: '사방으로 뿜습니다. 짧게, 자주, 가깝게',
      spread: Math.PI,
      cooldownMul: 0.3, durationMul: 0.5, rangeMul: 0.55, damageMul: 0.75,
    },
  ],
  shotgun: [
    {
      id: 'shotgunSlug', name: '슬러그탄',
      desc: '한 덩어리로 뭉쳐 멀리 날아갑니다. 무리에는 약해집니다',
      countMul: 1 / 3, damageMul: 3.5, rangeMul: 2, knockbackMul: 2, spreadMul: 0.4,
    },
    {
      id: 'shotgunFire', name: '화염 산탄',
      desc: '맞은 적이 계속 탑니다. 가깝고 약해집니다',
      // 탄환 계열의 화상 수단입니다 (계열마다 최소 하나).
      // ⚠ 산탄은 방패에 막히므로 막힌 적에게는 화상도 안 붙습니다 (`dealt > 0` 규칙)
      burn: { dps: 0.4, time: 3 },
      countMul: 1.2, damageMul: 0.6, rangeMul: 0.7,
    },
  ],
  sniper: [
    {
      id: 'sniperAp', name: '철갑탄',
      desc: '단단한 것일수록 더 아픕니다. 대신 느립니다',
      hpBonusMul: 2, damageMul: 1.3, cooldownMul: 1.35,
    },
    {
      id: 'sniperExecute', name: '처형 저격',
      desc: '빈사 상태의 적을 단숨에 끝냅니다',
      execute: { hpRatio: 0.3, mul: 3 },
      damageMul: 0.7, hpBonusMul: 0.5,
    },
  ],
  laser: [
    {
      id: 'laserFocus', name: '집속 레이저',
      desc: '가늘어지는 대신 꿰뚫는 힘이 커집니다',
      damageMul: 2.6, sizeMul: 0.4, cooldownMul: 1.2,
    },
    {
      id: 'laserBurn', name: '작열 레이저',
      desc: '지나간 자리의 적이 전부 탑니다',
      // 관통 계열의 화상 수단입니다
      burn: { dps: 0.5, time: 3 },
      damageMul: 0.55, sizeMul: 1.3,
    },
  ],
  grenade: [
    {
      id: 'grenadeHeavy', name: '대형 탄두',
      desc: '더 넓고 더 아프게. 대신 뜸하게 나갑니다',
      sizeMul: 1.7, damageMul: 1.6, cooldownMul: 1.5,
    },
    {
      id: 'grenadeCluster', name: '집속탄',
      desc: '착탄 뒤 자탄이 주변에 흩어져 다시 터집니다',
      cluster: { count: 4, radiusMul: 0.45, damageMul: 0.35, spreadMul: 1.1 },
      damageMul: 0.55,
    },
  ],
  missile: [
    {
      id: 'missileHeavy', name: '증폭 탄두',
      desc: '발수는 줄고 한 발이 훨씬 큽니다',
      damageMul: 1.8, sizeMul: 1.6, countMul: 0.6, turnRateMul: 0.8,
    },
    {
      id: 'missileSplit', name: '분열 미사일',
      desc: '명중하면 세 발로 갈라져 다시 쫓아갑니다',
      splitOnHit: { count: 3, max: 24 },
      damageMul: 0.45, countMul: 0.7,
    },
  ],
  chain: [
    {
      id: 'chainOverload', name: '과부하',
      desc: '첫 대상에 몰아칩니다. 오래 멈춰 세웁니다',
      damageMul: 2.2, stunMul: 2.4, jumpsMul: 0.5,
    },
    {
      id: 'chainConduct', name: '전도',
      desc: '연쇄가 약해지지 않습니다. 끝까지 같은 위력입니다',
      falloff: 1,
      jumpsMul: 1.5, damageMul: 0.5, stunMul: 0.4,
    },
  ],
  ricochet: [
    {
      id: 'ricochetHeavy', name: '강화 도탄',
      desc: '더 아프게, 더 오래 튕겨 다닙니다',
      damageMul: 1.9, pierceMul: 1.4, cooldownMul: 1.4, speedMul: 0.85,
    },
    {
      id: 'ricochetSplit', name: '분열 도탄',
      desc: '적을 맞을 때마다 탄이 갈라집니다',
      splitOnHit: { count: 2, max: 8 },
      damageMul: 0.45, pierceMul: 0.6,
    },
  ],
  harpoon: [
    {
      id: 'harpoonCannon', name: '작살포',
      desc: '더 넓게 꿰뚫고 더 세게 끌어옵니다',
      sizeMul: 2.5, pullMul: 1.8, damageMul: 1.5, cooldownMul: 1.4,
    },
    {
      id: 'harpoonChain', name: '사슬 작살',
      desc: '꿰뚫린 적이 잠시 묶입니다. 끌어오는 힘은 약해집니다',
      // 작살에는 원래 기절이 없습니다. 없던 동작을 붙이는 자리라 절대값(초)으로 적습니다
      stunOnHit: 1.2,
      pullMul: 0.5, damageMul: 0.6,
    },
  ],
  orbit: [
    {
      id: 'orbitGiant', name: '거대 구체',
      desc: '수는 줄고 하나하나가 훨씬 큽니다',
      // ⚠ sizeMul 은 **구체 크기**(bodyRadius)입니다. 공전 반경이 아닙니다.
      //    공전 반경을 건드리면 타격 간격도 `0.32 x 70/반경` 으로 같이 맞춰야 합니다
      sizeMul: 2.2, damageMul: 2.4, countMul: 0.5,
    },
    {
      id: 'orbitFragment', name: '파편 궤도',
      desc: '구체가 스칠 때마다 작게 터집니다',
      orbFragment: { radius: 45, damageMul: 0.4 },
      damageMul: 0.6,
    },
  ],
  aura: [
    {
      id: 'auraWide', name: '확장 오라',
      desc: '더 넓고 더 아프게. 대신 짧고 뜸합니다',
      sizeMul: 1.6, damageMul: 1.5, durationMul: 0.8, cooldownMul: 1.3,
    },
    {
      id: 'auraBurst', name: '파열',
      desc: '꺼지는 순간 주변이 통째로 터집니다',
      endBlast: { damageMul: 4 },
      damageMul: 0.6, sizeMul: 0.85,
    },
  ],
} as const;

/**
 * 갈래 id. **표에서 뽑아냅니다.** 손으로 유니온을 적으면 표에 갈래를 추가할 때마다
 * 두 곳을 고쳐야 하고, 한쪽을 빠뜨리면 없는 id 를 쓰는 코드가 통과합니다.
 */
type BranchTable = typeof SKILL_BRANCHES;
export type SkillBranchId = { [K in keyof BranchTable]: BranchTable[K][number]['id'] }[keyof BranchTable];

/**
 * 아래는 전부 **투사체가 들고 날아가는 것**들입니다.
 *
 * 터지거나 맞는 시점에는 슬롯이 없어서 갈래를 되물을 수 없습니다.
 * 그래서 쏠 때 결과물을 실어 보내고, `projectile.ts` 에는 분기라는 개념이
 * 아예 등장하지 않게 합니다.
 */
export type BlastHazardDef = NonNullable<SkillBranchDef['blastHazard']>;
export type ExecuteDef = NonNullable<SkillBranchDef['execute']>;
export type ClusterDef = NonNullable<SkillBranchDef['cluster']>;
export type SplitOnHitDef = NonNullable<SkillBranchDef['splitOnHit']>;
export type OrbFragmentDef = NonNullable<SkillBranchDef['orbFragment']>;

// ---------------------------------------------------------------------------
// 코인
// ---------------------------------------------------------------------------

export const COIN = {
  radius: 7,
  /**
   * 획득 범위에 들어온 뒤에는 매 프레임 정확히 플레이어 방향으로 움직입니다.
   * 속도 벡터에 가속을 더하는 방식은 관성 때문에 플레이어를 지나쳐 공전합니다.
   * magnetStartSpeed 로 시작해 magnetAccel 로 가속하고 magnetMaxSpeed 에서 멈춥니다.
   */
  magnetStartSpeed: 320,
  magnetAccel: 2800,
  magnetMaxSpeed: 1000,
  /** 맵에 남아있는 시간 (0이면 영구) */
  lifetime: 0,
  value: 1,
  /**
   * 벽에 부딪힐 때 남는 속도의 비율.
   * 떨어질 때 무작위 방향으로 튀는데, 반사가 없으면 가장자리에서 죽은 적의 코인이
   * 경기장 밖으로 나가 영영 못 줍는 자리에 남습니다.
   */
  wallBounce: 0.55,
} as const;

// ---------------------------------------------------------------------------
// 상태이상
// ---------------------------------------------------------------------------

export const STATUS = {
  burnTickInterval: 0.25,
  /** 시간 감속 스킬이 적용될 때의 최저 배율 */
  minTimeScale: 0.1,
  /**
   * 보스가 받는 상태이상 감소율. 0.7 이면 효과가 **30% 만** 들어갑니다.
   *
   * 기절과 감속에만 걸고 **화상은 제외합니다.** 화상은 상태이상이라기보다 지속 피해라,
   * 여기에 넣으면 "보스에게는 화력이 안 통한다"가 되어 성질이 다른 이야기가 됩니다.
   * 넉백은 원래부터 보스에게 안 걸립니다 (`damageEnemy` 의 `!e.boss`).
   *
   * 이게 없으면 넉백(쿨 5초 · 기절 2초)만으로 보스가 40% 시간 정지이고,
   * 쿨다운 감소를 상한(60%)까지 올리면 쿨 2초라 **보스가 아예 안 움직입니다.**
   */
  bossStatusResist: 0.7,
  /**
   * 감속의 상한 (2026-08-13). 0.8 이면 아무리 겹쳐도 이동속도 20% 아래로는 안 갑니다.
   *
   * **감속은 곱하지 않고 더합니다.** 예전에는 화상(x0.9)을 오라(x0.55) 위에 곱해서
   * x0.495 였습니다. 곱연산은 이미 느린 적일수록 새 감속이 실제로 깎는 양이 줄어서,
   * 감속을 겹칠수록 하나하나의 값이 표에 적힌 것보다 작게 일합니다. 지금은
   * 45% + 10% = **55% 감속**이라 표의 숫자를 그냥 더하면 결과가 나옵니다.
   * 난이도 배율을 곱이 아니라 합으로 쌓기로 한 것과 같은 이유입니다.
   *
   * 상한이 필요한 이유는 더하기에는 끝이 없기 때문입니다. 100% 에 닿으면 그 적은
   * 완전히 멈추는데, 그건 감속이 아니라 무기한 기절입니다. 넉백 기절만으로 보스가
   * 40% 시간 정지이던 문제(`bossStatusResist`)와 같은 자리입니다.
   *
   * **지금 감속 출처는 둘입니다.** 감속 상태이상(`Enemy.slow`, 오라 등)과 화상입니다.
   * 감속 상태이상끼리는 매 틱 다시 걸리는 성질이라 가장 센 것 하나만 남기고(`slowEnemy`),
   * 그 결과에 화상을 **더합니다**. 새 감속 출처를 붙일 때는 "더하는 것인가 갱신하는
   * 것인가"를 먼저 정하고, 매 틱 갱신되는 것이면 반드시 갱신 쪽에 넣으십시오.
   * 갱신되는 것을 더하게 두면 첫 1초 만에 상한까지 차오릅니다.
   */
  slowCap: 0.8,
} as const;

// ---------------------------------------------------------------------------
// 메타 진행 (기획.md 8장)
// ---------------------------------------------------------------------------

export interface PermUpgradeDef {
  key: string;
  name: string;
  desc: string;
  stat: StatKey;
  step: number;
  costs: readonly number[];
}

/**
 * 스탯 영구 강화는 **20단계까지** 갑니다 (2026-08-11, 그전에는 3~5단계).
 *
 * 손으로 적은 앞 단계는 그대로 두고, 그 뒤는 `PERM_COST_GROWTH` 배씩 이어 붙입니다.
 * 20 x 6 = 120 개를 손으로 적으면 곡선이 항목마다 어긋나고, 한 번 손보려면 전부
 * 다시 써야 합니다. **곡선을 조정할 때는 아래 두 상수만 만지십시오.**
 *
 * 10 단위로 반올림하는 것은 상점에서 읽히기 위한 것입니다.
 * 3,644 와 3,640 은 게임에서 같은 값이지만 뒤쪽이 눈에 덜 걸립니다.
 */
const PERM_MAX_LEVEL = 20;
const PERM_COST_GROWTH = 1.25;

function permCosts(seed: readonly number[]): readonly number[] {
  const out = [...seed];
  while (out.length < PERM_MAX_LEVEL) {
    out.push(Math.round((out[out.length - 1] * PERM_COST_GROWTH) / 10) * 10);
  }
  return out;
}

export const PERM_UPGRADES: readonly PermUpgradeDef[] = [
  { key: 'hp', name: '기본 체력', desc: '시작 최대 체력 +15', stat: 'maxHp', step: 15, costs: permCosts([20, 45, 80, 130, 200]) },
  { key: 'atk', name: '기본 공격력', desc: '시작 공격력 +2', stat: 'attack', step: 2, costs: permCosts([25, 55, 95, 150, 230]) },
  { key: 'spd', name: '기본 이동속도', desc: '시작 이동속도 +8', stat: 'moveSpeed', step: 8, costs: permCosts([20, 45, 80, 130, 200]) },
  { key: 'rof', name: '기본 연사', desc: '시작 연사 속도 +0.15', stat: 'fireRate', step: 0.15, costs: permCosts([30, 70, 120, 190, 280]) },
  { key: 'mag', name: '코인 자석', desc: '코인 획득 범위 +25', stat: 'pickupRange', step: 25, costs: permCosts([15, 35, 70]) },
  { key: 'crit', name: '기본 치명타', desc: '시작 치명타 확률 +3%', stat: 'critChance', step: 0.03, costs: permCosts([35, 75, 130]) },
] as const;

/**
 * 스킬 리롤. 판당 사용 가능 횟수를 사 둡니다 (최대 3회).
 * 원하는 빌드를 강제로 맞출 수 있는 강력한 기능이라 비싸게 잡았습니다.
 */
export const REROLL_UPGRADE = {
  key: 'reroll',
  name: '스킬 리롤',
  desc: '선택지 다시 뽑기 · 단계마다 판당 1회',
  costs: [260, 620, 1100],
} as const;

/**
 * 스킬 선택 건너뛰기. 판당 사용 가능 횟수를 사 둡니다.
 *
 * 원래 기획에서는 "거절"을 뺐습니다 (기획.md 12장). 무조건 하나를 고르게 하고
 * 리롤로 대신한다는 결정이었는데, 리롤은 **다시 뽑을 뿐 안 받을 수는 없습니다.**
 * 그래서 공격 3칸은 반드시 채워지고 "하나만 쓰는 빌드"가 성립하지 않았습니다.
 *
 * 지금은 거절이 돌아오되 공짜가 아닙니다. 리롤보다 비싸게 잡은 이유는
 * 리롤이 "원하는 것을 뽑는" 도구인 반면 이건 "빌드를 좁게 유지하는" 도구라
 * 판 전체의 성격을 바꾸기 때문입니다.
 */
export const SKIP_UPGRADE = {
  key: 'skip',
  name: '스킬 선택 건너뛰기',
  desc: '선택 건너뛰기 · 단계마다 판당 1회 · 마지막 단계 무제한',
  costs: [350, 800, 1400, 3000],
  /**
   * 이 단계에 닿으면 판당 횟수 제한이 사라집니다.
   *
   * 무제한 단계가 필요한 이유는 횟수제로는 "하나만 쓰는 빌드"가 성립하지 않기 때문입니다.
   * 레벨 45 까지 스킬 선택이 8회 오는데 3회로는 막을 수가 없고, 남는 5회는
   * 유틸 카드가 우연히 떴는지에 좌우돼서 실력이 아니라 운이 결정합니다.
   *
   * 3000 은 상점에서 가장 비싼 항목입니다 (그다음이 리롤 3단계 1100). 판을 통째로
   * 다시 설계하게 만드는 물건이라 마지막에 사는 것이 맞습니다.
   */
  unlimitedLevel: 4,
} as const;

/**
 * 되살아날 때 채워지는 최대 체력 비율.
 * 상점 문구와 `world.resolveDown` 이 **같은 값을 봅니다.** 한쪽만 고치면
 * 화면에 적힌 숫자와 실제로 차오르는 체력이 갈립니다.
 */
const REVIVE_HP_RATIO = 0.55;

/** 부활은 스탯이 아니라 특수 강화라 따로 둡니다 */
export const REVIVE_UPGRADE = {
  key: 'revive',
  name: '부활',
  hpRatio: REVIVE_HP_RATIO,
  desc: `체력 ${Math.round(REVIVE_HP_RATIO * 100)}% 부활 · 단계마다 판당 1회`,
  costs: [400, 900],
} as const;

/**
 * 성장 패시브 (2026-08-12). **예전 가중치 상점(`WEIGHT_SHOP`)을 대체합니다.**
 *
 * 가중치 상점을 걷어낸 이유는 두 가지가 실제로 깨져 있었기 때문입니다.
 * 확률이 100% 로 정규화되니 `+15%p` 를 사도 실제로는 `+13.0%p` 만 올랐고,
 * 다른 스탯을 사면 이미 산 것이 깎였습니다. 9종을 전부 상한까지 사면(2,400코인)
 * 공격력 등장 확률이 **처음보다 3%p 낮아지기까지** 했습니다. 부가 스탯이 6에서
 * +15(2.5배)인데 주요는 13에서 +15(1.15배)라, 전부 사면 분포가 평평해지면서
 * 원래 유리하던 주요 스탯이 손해를 봅니다. 돈을 쓸수록 나빠지는 상점이었습니다.
 *
 * **새 규칙은 이렇습니다.**
 * - 레벨업에 스탯 2개가 오르는데, 그중 **첫 칸만 "지정 칸"** 입니다
 * - 지정 칸은 `chance`(70%) 확률로 **열린 패시브 칸 중 하나**를 균등하게 고릅니다
 * - 고른 칸이 **비어 있으면 그 몫은 그냥 일반 추첨으로 넘어갑니다**
 * - 나머지 한 칸은 언제나 일반 추첨입니다
 *
 * 그래서 지정 예산 70% 는 **장착 수와 무관하게 고정**이고, 플레이어는 총량이 아니라
 * **집중이냐 분산이냐**만 고릅니다. 1개에 몰면 그 하나가 70%, 3개면 각 23.3% 입니다.
 * 예전처럼 "사면 살수록 서로 깎아먹는" 일이 원리적으로 안 생깁니다.
 *
 * **빈 칸이 몫을 흘려보내는 것이 봉인의 존재 이유입니다.** 3칸이 다 열려 있는데
 * 1개만 끼면 70% x 1/3 = 23.3% 밖에 안 갑니다. 안 쓸 칸을 봉인해야 70% 가 온전히
 * 그 하나로 갑니다. 즉 **봉인은 돈을 주고 집중을 사는 물건**입니다.
 */
export const PASSIVE = {
  /** 칸 수. 처음부터 전부 열려 있습니다 */
  slots: 3,
  /** 지정 칸이 발동할 확률 */
  chance: 0.7,
  /**
   * 봉인 가격. 한 칸씩 잠급니다 (최대 2칸까지, 마지막 한 칸은 못 잠급니다).
   * 1개만 끼는 빌드를 23.3% → 70% 로 세 배 만드는 물건이라 비쌉니다.
   */
  sealCosts: [600, 1400],
  /** 패시브 해금 가격 */
  majorCost: 400,
  minorCost: 300,
} as const;

/** 기본 등장 가중치 (%p). 합이 100이 되도록 잡았습니다 */
export const BASE_WEIGHT = { major: 13, minor: 6 } as const;

/** 시작 스킬 해금 비용 */
export const START_SKILL_COST: Record<string, number> = {
  shotgun: 60,
  sniper: 80,
  flame: 80,
  laser: 110,
  grenade: 100,
  missile: 110,
  chain: 120,
  orbit: 90,
  mine: 90,
  aura: 100,
  dash: 70,
  ricochet: 95,
  harpoon: 115,
  knockback: 80,
  timeslow: 150,
  medkit: 130,
};

/** 시작 스킬은 최대 2개까지 장착 */
/**
 * 시작 스킬 장착 칸. **공격과 유틸이 서로 다른 주머니를 씁니다** (2026-08-12).
 *
 * 예전에는 둘을 합쳐 2칸이라, 유틸을 하나 끼우면 공격이 하나로 줄었습니다.
 * 그런데 판 안에서는 공격 3칸과 유틸 1칸이 애초에 따로 놉니다. 시작 장착만
 * 한 주머니를 쓰면 "유틸을 들면 공격이 손해"가 되어, 유틸을 아예 안 들게 됩니다.
 * 지금은 공격 2 + 유틸 1 로 따로 셉니다.
 */
export const MAX_START_ATTACKS = 2;
export const MAX_START_UTILITIES = 1;

/** 도감 정보 해금 단계 (기획.md 8장) */
export const BESTIARY_TIERS = { pattern: 10, numbers: 50 } as const;

/**
 * 보스 도감은 문턱을 절반으로 낮춥니다.
 * 보스는 한 판에 몇 번 안 나오고 그마저도 셋이 돌아가며 등장하므로,
 * 잡몹과 같은 10 · 50 을 요구하면 수치 단계는 사실상 영영 안 열립니다.
 */
export const BESTIARY_TIERS_BOSS = { pattern: 5, numbers: 25 } as const;

// ---------------------------------------------------------------------------
// 업적
// ---------------------------------------------------------------------------

/**
 * 업적 보상과 알림.
 *
 * 목록 자체는 `src/data/achievements.ts` 에 있습니다. 49개를 여기에 넣으면
 * 이 파일이 더 길어지기만 하고, 등급 값만 여기 있으면 "얼마를 주는가"는
 * 여전히 한 곳에서 조절됩니다.
 */
export const ACHIEVEMENT = {
  /** 전체 보상 배율. 많다 싶으면 여기만 내리면 전부 같은 비율로 줄어듭니다 */
  coinMul: 1,
  /** 알림이 화면에 머무는 시간(초) */
  toastLife: 4,
  /** 한꺼번에 달성됐을 때 줄 서는 간격(초) */
  toastGap: 0.4,
  /** 판정 주기(초). 매 프레임 49개를 돌릴 이유가 없습니다 */
  checkInterval: 0.25,

  /** 등급별 코인 */
  bronze: 20,
  silver: 50,
  gold: 120,
  platinum: 300,
  legend: 700,

  /**
   * 난이도 클리어 보상. 인덱스 0 이 난이도 -1 입니다.
   * 뒤로 갈수록 가파른 이유는 이것이 이 게임의 주 진행선이기 때문입니다
   */
  difficultyClear: [20, 40, 60, 80, 110, 140, 180, 220, 270, 330, 400, 480, 570, 670, 780, 900, 1200],
} as const;

// ---------------------------------------------------------------------------
// 디버그
// ---------------------------------------------------------------------------

/**
 * 설정 화면에서 고르는 것들.
 *
 * **밸런스가 아니라 취향입니다.** 흔들림이 얼마나 편한지, 파티클이 얼마나 보기 좋은지는
 * 사람마다 다르고 기기 성능마다 다릅니다. 상수 하나로 정하면 누군가에게는 반드시
 * 틀린 값이 됩니다.
 *
 * **파티클 배율이 게임 결과를 바꾸면 안 됩니다.** 그래서 `Effects` 는 월드와 **다른
 * 난수기**를 씁니다. 같은 것을 쓰면 파티클을 적게 뿌리는 사람은 난수를 덜 뽑게 되어
 * 그 뒤의 스폰과 추첨이 통째로 밀립니다. 시드를 고정해도 설정마다 다른 판이 됩니다.
 */
export const SETTINGS = {
  /** 화면 흔들림. `SHAKE.mul` 에 곱합니다 */
  shake: {
    levels: [
      { name: '끔', mul: 0 },
      { name: '절반', mul: 0.5 },
      { name: '전체', mul: 1 },
    ],
    /** 절반. 예전에 상수로 쓰던 세기와 같습니다 */
    default: 1,
  },
  /** 파티클 양. 뿌리는 개수에 곱합니다 */
  particles: {
    levels: [
      { name: '끔', mul: 0 },
      { name: '적게', mul: 0.4 },
      { name: '보통', mul: 0.7 },
      { name: '전체', mul: 1 },
    ],
    /** 전체. 지금까지의 모습 그대로입니다 */
    default: 3,
  },
  /** 창을 벗어나면 자동 일시정지 */
  autoPauseDefault: true,
} as const;

/**
 * 하드모드의 겉모습.
 *
 * **아직 규칙은 없고 보이는 것만 있습니다** (2026-09-03). 하드모드에 들어가면 화면
 * 전체에 붉은 기운이 은은하게 깔리고 메뉴 색도 붉은 쪽으로 조금 옮겨갑니다.
 *
 * **덧칠은 화면 전체에 고르게 겁니다. 적 색을 따로 바꾸지 않습니다.**
 * 이 게임은 "색이 위험도"라는 규칙으로 적 14종의 색을 잡아놨는데, 색마다 다르게
 * 손대면 그 구분이 무너집니다. 고르게 덮으면 서로의 차이는 그대로 남습니다.
 */
export const HARD = {
  /**
   * 화면 전체에 덮는 붉은 막. **은은해야 합니다.**
   *
   * 진하게 하면 적탄(빨강)과 배경이 섞여서, 날아오는 것을 못 봅니다.
   * `scripts/smoke.ts` 가 이 값이 옅은 범위 안에 있는지 잽니다.
   */
  tint: 'rgba(255, 48, 48, 0.07)',
} as const;

export const DEBUG = {
  stressSpawnCount: 200,
  /**
   * 디버그 잠금 해제 순서. `KeyboardEvent.code` 로 적습니다.
   *
   * **글자가 아니라 자판의 자리입니다.** 한글 입력 상태에서 누르면 화면에 들어가는
   * 글자가 통째로 달라지는데, `code` 는 자판 배열과 입력기와 무관하게 같은 값이라
   * 어느 상태에서 눌러도 똑같이 동작합니다. 대소문자도 상관없습니다.
   *
   * **이건 자물쇠가 아니라 문턱입니다.** 소스가 공개돼 있으므로 코드를 읽는 사람은
   * 이 줄을 그대로 봅니다. 막으려는 것은 "링크를 받아 들어온 사람이 F1 을 눌러보다
   * 디버그를 켜는 일"이지 작정하고 뜯어보는 사람이 아닙니다.
   */
  unlockSequence: ['KeyR', 'KeyH', 'KeyD', 'KeyQ', 'KeyN', 'KeyG', 'KeyO', 'KeyF', 'KeyK'],
} as const;
