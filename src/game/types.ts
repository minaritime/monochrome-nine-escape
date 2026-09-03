import type {
  BlastHazardDef,
  BossId,
  ClusterDef,
  EnemyId,
  ExecuteDef,
  OrbFragmentDef,
  SkillBranchId,
  SplitOnHitDef,
  StatKey,
} from '../data/balance';
import type { EnemyDef } from '../enemies/types';
import type { SkillId } from '../skills/types';

export type StatBlock = Record<StatKey, number>;

/** 플레이어를 죽인 상대. 게임오버 화면에 생김새를 띄우는 데 씁니다 */
export interface KillerInfo {
  id: EnemyId | BossId;
  elite: boolean;
}

/**
 * 죽는 순간 플레이어가 쪼개져 날아가는 조각.
 *
 * 파티클과 따로 두는 이유는 이것만은 그림이 아니라 판정을 갖기 때문입니다.
 * `Effects.particles` 는 맞히는 대상이 없고 수명이 짧아서 여기에 얹을 수 없습니다.
 */
export interface Shard {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 부채꼴 반지름 */
  size: number;
  /** 부채꼴이 향한 각도 */
  angle: number;
  /** 초당 회전량 */
  spin: number;
  life: number;
  maxLife: number;
  /**
   * 이미 닿은 적의 id.
   * 못 죽이는 적(보스·무적)에 스치면 매 프레임 불꽃이 튀어서 한 번만 내도록 막습니다.
   */
  touched: Set<number>;
}

export interface SkillSlot {
  id: SkillId;
  level: number;
  cooldown: number;
  /** 지속형 스킬(화염방사기, 오라, 회전궤도)의 남은 지속 시간 */
  active: number;
  /** 지속형 스킬의 피해 틱 타이머 */
  tick: number;
  /**
   * 6레벨에 고른 강화 갈래. 아직 안 골랐거나 갈래가 없는 스킬은 null 입니다.
   *
   * **인덱스가 아니라 id 입니다.** 표에서 두 갈래의 순서를 바꾸면 인덱스 방식은
   * 화염 지뢰를 고른 사람이 거대 지뢰가 되는데 **아무 오류도 안 납니다.**
   */
  branch: SkillBranchId | null;
}

export interface Player {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  hp: number;
  stats: StatBlock;
  level: number;
  xp: number;
  xpToNext: number;
  /** 기본공격 재장전 타이머 */
  attackTimer: number;
  invuln: number;
  /** 대시 중 무적 + 강제 이동 */
  dashTime: number;
  dashAngle: number;
  dashSpeed: number;
  /** 마지막으로 움직인 방향 (대시 기본 방향) */
  facing: number;
  slow: number;
  slowTime: number;
  /** 공격 스킬 3칸. 전부 자동 발동입니다 */
  attacks: (SkillSlot | null)[];
  /** 유틸 스킬 1칸. Q 로만 씁니다. 새로 고르면 이 칸이 통째로 교체됩니다 */
  utility: SkillSlot | null;
  /** 부활 아이템 남은 횟수 */
  revives: number;
  /** 스킬 선택지를 다시 뽑을 수 있는 남은 횟수 */
  rerolls: number;
  /**
   * 스킬 선택을 통째로 건너뛸 수 있는 남은 횟수.
   * 리롤과 다릅니다. 리롤은 다시 뽑을 뿐 안 받을 수는 없습니다
   */
  skips: number;
  alive: boolean;
}

/**
 * 업적 판정을 위해 한 판 동안 모아두는 것들.
 *
 * "지금 화면을 보면 알 수 있는 것"은 여기 넣지 않습니다. 예를 들어 "보스 2마리"나
 * "탱커가 3분 버텼다"는 `w.enemies` 를 훑으면 그만이라 업적 쪽 조건식에서 직접 봅니다.
 * 여기 있는 것은 **지나가면 사라지는 사건**뿐입니다.
 */
export interface RunTrack {
  /** 방향키를 한 번이라도 눌렀는가 */
  moved: boolean;
  /** 이번 판에 한 번이라도 오른 스탯 */
  statGains: Set<string>;
  revivesUsed: number;
  /** 가장 길었던 무피해 구간(초) */
  noHitBest: number;
  noHitTimer: number;
  /** 마지막으로 맞은 시각. 한 번도 안 맞았으면 -1 */
  lastHitTime: number;
  /** 방패가 남은 채로 방패적을 잡았는가 */
  shieldIntactKill: boolean;
  /** 강화된 돌진적을 한 번도 안 돌진시키고 잡았는가 */
  chargerNoDashKill: boolean;
  /** 보스를 잡기까지 걸린 최단 시간. 아직 없으면 Infinity */
  fastestBossKill: number;
  /** 살아 있는 내내 한 대도 안 맞고 보스를 잡았는가 */
  bossNoHitKill: boolean;
  /** 넉백이 실린 피해로 보스를 끝냈는가 */
  knockbackBossKill: boolean;
  /** 은신적을 드러난 동안 잡았는가 */
  stealthRevealKill: boolean;
  /** 시체 폭발 한 번으로 잡은 최다 마릿수 */
  corpseBlastBest: number;
  /** 내가 잡은 자폭적의 시체 폭발에 내가 죽었는가 */
  diedToOwnCorpseBlast: boolean;
  /** 죽는 순간 파편이 보스에 닿았는가 */
  shardHitBoss: boolean;
  eliteKills: number;
  /** 판이 도는 동안 화면을 클릭했는가. 커서가 지나간 것은 안 셉니다 */
  mouseClicked: boolean;
}

export function emptyRunTrack(): RunTrack {
  return {
    moved: false,
    statGains: new Set(),
    revivesUsed: 0,
    noHitBest: 0,
    noHitTimer: 0,
    lastHitTime: -1,
    shieldIntactKill: false,
    chargerNoDashKill: false,
    fastestBossKill: Number.POSITIVE_INFINITY,
    bossNoHitKill: false,
    knockbackBossKill: false,
    stealthRevealKill: false,
    corpseBlastBest: 0,
    diedToOwnCorpseBlast: false,
    shardHitBoss: false,
    eliteKills: 0,
    mouseClicked: false,
  };
}

export interface EnemyState {
  timer: number;
  timer2: number;
  timer3: number;
  phase: number;
  angle: number;
  flag: boolean;
  targetX: number;
  targetY: number;
}

export interface Enemy {
  id: number;
  defId: EnemyId | BossId;
  def: EnemyDef;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  hp: number;
  maxHp: number;
  speed: number;
  damage: number;
  xp: number;
  elite: boolean;
  boss: boolean;
  /** 분열체는 다시 분열하지 않습니다 */
  child: boolean;
  /** 방패적의 정면 방향 */
  facing: number;
  hitFlash: number;
  dead: boolean;
  /** 화면에 보이는 정도 (은신적이 0.13 까지 내려갑니다) */
  alpha: number;
  /** 자동 타겟팅 대상이 될 수 있는가 (은신 중이면 false) */
  targetable: boolean;
  /** 다른 적을 통과하는가. 지금 이걸 쓰는 적은 없습니다 (보스 일부 연출용) */
  phasing: boolean;
  /** 방패 내구도. 0 이면 방패가 없거나 이미 깨진 상태입니다 */
  shieldHp: number;
  shieldMax: number;
  burnTime: number;
  burnDps: number;
  burnTick: number;
  slow: number;
  slowTime: number;
  stun: number;
  /** 남은 무적 시간. 0 보다 크면 어떤 피해도 안 들어갑니다 (군체왕 분노) */
  invuln: number;
  /**
   * 시간이 아니라 영구적으로 무적인가 (난이도 15 의 무적 바보적).
   * 처치라는 선택지 자체가 없는 "움직이는 장애물"이라, 타이머로 흉내 내지 않고 따로 둡니다.
   */
  immortal: boolean;
  knockVx: number;
  knockVy: number;
  /** 태어난 시각(월드 시간). "탱커가 3분 버텼다", "보스를 10초 만에 잡았다"를 재는 데 씁니다 */
  spawnTime: number;
  /** 돌진적이 실제로 돌진한 횟수. 예고만 하고 죽으면 0 입니다 */
  dashes: number;
  /**
   * 지금 상태이상을 안 받는가 (돌진적이 실제로 달리는 동안).
   *
   * 예고 3초를 보여주고 튀어나가는 적이라, 그 한 번을 기절이나 감속으로 지우면
   * 예고를 보고 자리를 비킨다는 대응 자체가 필요 없어집니다.
   * **화상의 지속 피해는 그대로 들어갑니다.** 면역인 것은 기절 · 감속 · 넉백처럼
   * 움직임을 바꾸는 것뿐입니다 (화상은 상태이상이라기보다 지속 피해입니다).
   */
  statusImmune: boolean;
  /**
   * 이 개체를 불러낸 적의 id. 그 적이 죽으면 같이 사라집니다 (소환적의 하수인).
   * 0 이면 주인이 없습니다.
   */
  ownerId: number;
  /** 소환적이 부를 하수인 종류. 스폰할 때 한 번 정해지고 그 뒤로 안 바뀝니다 */
  summonKind: EnemyId | null;
  /**
   * 미라: 되살아나기까지 남은 시간. 0 이면 쓰러진 상태가 아닙니다.
   * 쓰러져 있는 동안은 행동도 접촉 피해도 피격도 없습니다.
   */
  downed: number;
  /** 미라: 이미 한 번 되살아났는가. 두 번째 죽음은 진짜 죽음입니다 */
  revived: boolean;
  /** 매초 빠져나가는 최대 체력의 비율. 0 이면 없습니다 (미라 부활 후) */
  hpDrainRatio: number;
  /** 이동속도가 매초 이만큼 줄어 speedFloor 까지 내려갑니다. 0 이면 없습니다 */
  speedDecay: number;
  speedFloor: number;
  state: EnemyState;
}

export type ProjectileKind = 'bullet' | 'pierce' | 'homing' | 'lob' | 'mine' | 'orbit' | 'ricochet' | 'enemy';

export interface Projectile {
  kind: ProjectileKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  life: number;
  friendly: boolean;
  crit: boolean;
  color: string;
  /** 관통 남은 횟수 (0이면 첫 명중에 소멸) */
  pierce: number;
  hits: Set<number> | null;
  /** 유도탄 목표 */
  targetId: number;
  turnRate: number;
  /** 유탄 착탄 지점 */
  destX: number;
  destY: number;
  /** 폭발 반경 (0이면 폭발 없음) */
  blast: number;
  /** 회전 궤도용 */
  orbitAngle: number;
  orbitRadius: number;
  orbitSpeed: number;
  /** 명중 시 부가 효과 */
  burnDps: number;
  burnTime: number;
  slowFactor: number;
  slowTime: number;
  knockback: number;
  /** 지뢰 무장 대기 시간 */
  arm: number;
  /** 방패적의 정면 방패를 무시하는가 (관통·폭발·전방위 계열) */
  ignoreShield: boolean;
  /**
   * 맞은 적의 **최대 체력**에 이 비율을 곱해 `damage` 위에 더합니다 (스나이퍼).
   * 쏠 때가 아니라 **맞는 순간 실제로 맞은 적**을 기준으로 셈합니다. 스나이퍼는
   * 유도가 없어서 겨눈 적과 맞는 적이 다를 수 있는데, 쏠 때 굳혀버리면 지나가던
   * 잡몹에 보스 몫의 추가 피해가 들어갑니다.
   *
   * `crit` 은 여기에 안 걸립니다 (`SKILLS.sniper` 주석 참고).
   */
  hpBonus: number;
  /**
   * 터진 자리에 남길 장판 (화염 지뢰).
   *
   * **터지는 시점에는 슬롯이 없어서 갈래를 되물을 수 없습니다.** 그래서 쏠 때
   * 결과물을 실어 보냅니다. 덕분에 `projectile.ts` 에는 분기라는 개념이
   * 아예 등장하지 않습니다.
   */
  blastHazard: BlastHazardDef | null;
  /** 남은 체력이 낮은 대상에게 곱하는 배수 (처형 저격) */
  execute: ExecuteDef | null;
  /** 착탄 뒤 주변에 흩어지는 자탄 (집속탄) */
  cluster: ClusterDef | null;
  /**
   * 명중할 때마다 갈라지는 규칙 (분열 도탄·분열 미사일).
   * `splitsLeft` 는 그 탄에 남은 분열 예산입니다. 갈라진 자식이 예산을 나눠 가지므로
   * 총 개수가 `max` 를 넘지 않습니다. 안 두면 적이 많을 때 화면이 탄으로 덮입니다
   */
  splitOnHit: SplitOnHitDef | null;
  splitsLeft: number;
  /** 구체가 스칠 때마다 터지는 작은 폭발 (파편 궤도) */
  orbFragment: OrbFragmentDef | null;
  /** 적탄을 쏜 상대. 게임오버 화면에 사인을 띄우는 데만 씁니다 */
  source: KillerInfo | null;
  dead: boolean;
}

export interface Coin {
  x: number;
  y: number;
  /** 획득 범위 밖에서 튕겨 나갈 때만 쓰는 속도 */
  vx: number;
  vy: number;
  /** 끌려올 때의 스칼라 속도 (방향은 매 프레임 플레이어 쪽으로 다시 잡습니다) */
  speed: number;
  value: number;
  life: number;
  magnet: boolean;
  dead: boolean;
}

export interface Hazard {
  x: number;
  y: number;
  radius: number;
  life: number;
  maxLife: number;
  slow: number;
  /**
   * 피해는 초당이 아니라 틱 단위입니다. 초당으로 주면 살짝 스친 한 프레임에도
   * 소수점 피해가 들어가서 "밟았다"와 "지나갔다"가 구분되지 않습니다.
   * arm 이 남아 있는 동안은 감속만 걸리고 피해는 없습니다.
   */
  arm: number;
  /** `arm` 의 처음 값. 차오르는 원을 그리는 데 씁니다 */
  maxArm: number;
  tickInterval: number;
  tick: number;
  tickDamage: number;
  color: string;
  /**
   * 이 장판이 때리는 쪽. 기본은 `'player'` (장판적이 깔아둔 것).
   *
   * `'enemy'` 는 내 스킬이 깐 것이라 **플레이어는 아무 영향도 안 받습니다.**
   * 내 화염 지뢰에 내가 데며 감속까지 걸리면 지뢰가 자해 스킬이 됩니다.
   *
   * `PendingBlast.hitsAll` 과 뜻이 다릅니다. 저건 "둘 다 때린다"이고
   * 이건 "**한쪽만** 때린다"입니다.
   */
  side: 'player' | 'enemy';
  /** 밟은 적에게 붙일 화상 (`side === 'enemy'` 일 때만). 0 이면 안 붙습니다 */
  burnDps: number;
  burnTime: number;
  /** 이 장판을 깐 상대. 게임오버 화면에 사인을 띄우는 데만 씁니다 */
  source: KillerInfo | null;
  dead: boolean;
}

/**
 * 순서를 두고 띄우는 알림 글자 (레벨업 결과).
 *
 * 스킬 선택창이 뜨는 레벨에서는 오른 스탯 글자가 창 뒤에서 그대로 사라져버립니다.
 * 이펙트는 메뉴가 떠 있어도 계속 흐르지만 World.update 는 멈추므로, 여기 담아두면
 * 창이 닫힌 뒤부터 시간이 흐릅니다. 결과적으로 "창을 닫으면 스탯 → 스킬" 순서가 됩니다.
 */
export interface LevelNotice {
  /** 남은 대기 시간(초) */
  delay: number;
  text: string;
  color: string;
  size: number;
  /** 플레이어 기준 세로 오프셋 */
  dy: number;
  dead: boolean;
}

/**
 * 예고 후 터지는 폭발.
 * 예고 표시(Telegraph)는 그림일 뿐이라 실제 피해를 주지 않습니다.
 * 폭격기 보스처럼 "지금 예고하고 잠시 뒤에 터진다"를 표현하려면 이게 따로 필요합니다.
 */
export interface PendingBlast {
  x: number;
  y: number;
  radius: number;
  damage: number;
  /** 남은 시간(초) */
  delay: number;
  color: string;
  source: KillerInfo | null;
  /** true 면 플레이어뿐 아니라 적에게도 피해가 들어갑니다 (자폭적 시체) */
  hitsAll?: boolean;
  dead: boolean;
}

/**
 * - spawn: 적이 나올 자리
 * - line: 돌진 경로
 * - blast: 방금 터진 폭발 (뒤로 갈수록 옅어집니다)
 * - incoming: 곧 터질 자리 (뒤로 갈수록 진해지고 안이 차오릅니다)
 */
export type TelegraphKind = 'spawn' | 'line' | 'blast' | 'incoming';

export interface Telegraph {
  kind: TelegraphKind;
  x: number;
  y: number;
  x2: number;
  y2: number;
  radius: number;
  width: number;
  life: number;
  maxLife: number;
  color: string;
  /**
   * 이 예고를 띄운 적의 id. 0 이면 주인이 없습니다.
   *
   * 주인이 죽으면 예고도 같이 사라져야 합니다. 돌진적을 차지 도중에 잡았는데
   * 경로 표시가 화면에 남아 있으면 오지도 않을 돌진을 계속 피하게 됩니다.
   */
  owner: number;
  dead: boolean;
}

export interface RunStats {
  kills: number;
  killsByType: Partial<Record<string, number>>;
  coins: number;
  damageTaken: number;
  bossKills: number;
  maxLevel: number;
}

export type StatGain = { key: StatKey; amount: number };
