import { Rng } from '../core/rng';
import type { Input } from '../core/input';
import { compact } from '../core/pool';
import { TAU, clamp, dist } from '../core/math';
import {
  BOSS,
  BOSS_VARIANTS,
  CANVAS,
  COIN,
  DEATH_BURST,
  ELITE,
  ELITE_TRAITS,
  ENEMY_BASE,
  ENEMY_PARAMS,
  ENEMY_TABLE,
  LEVEL,
  LEVEL_NOTICE,
  REVIVE_UPGRADE,
  SETTINGS,
  STATUS,
  TIME_SCALING,
  type BossId,
  type EnemyId,
} from '../data/balance';
import { Effects } from '../render/effects';
import { SpatialGrid, clampToArena } from './collision';
import { createPlayer, ownedSlots, updatePlayer } from './player';
import { Spawner } from './spawner';
import { updateEnemies } from '../enemies/update';
import { updateProjectiles } from '../skills/projectile';
import type { SkillId } from '../skills/types';
import { updateCoins } from './coin';
import { getEnemyDef } from '../enemies/registry';
import { bossIdForSpawn } from '../enemies/boss';
import { eliteStatMul, eliteValue } from '../enemies/elite';
import { rollStatGains } from '../progression/levelup';
import { addStat } from './stats';
import { clampDifficulty, difficultyMods, type DifficultyMods } from '../meta/difficulty';
import { killerOf } from './killer';
import { emptyRunTrack } from './types';
import type { SaveData } from '../meta/save';
import type {
  Coin,
  Enemy,
  Hazard,
  KillerInfo,
  LevelNotice,
  PendingBlast,
  Player,
  Projectile,
  RunStats,
  RunTrack,
  Shard,
  Telegraph,
} from './types';

export type { KillerInfo };

export interface SpawnEnemyOptions {
  elite?: boolean;
  child?: boolean;
  scale?: number;
  hpMul?: number;
  silent?: boolean;
  /** 영구 무적 (난이도 15 의 무적 바보적) */
  immortal?: boolean;
  /** 이 적을 불러낸 개체의 id. 그 개체가 죽으면 같이 사라집니다 (소환적의 하수인) */
  ownerId?: number;
}

export interface DamageOptions {
  crit?: boolean;
  fromX?: number;
  fromY?: number;
  knockback?: number;
  showNumber?: boolean;
  /** 방패적의 정면 방패를 무시합니다 (관통·폭발·전방위 계열) */
  ignoreShield?: boolean;
}

/** 엔티티 컨테이너 + 업데이트 순서 */
export class World {
  time = 0;
  rng: Rng;
  effects: Effects;
  grid = new SpatialGrid();
  spawner: Spawner;

  player: Player;
  enemies: Enemy[] = [];
  projectiles: Projectile[] = [];
  coins: Coin[] = [];
  hazards: Hazard[] = [];
  telegraphs: Telegraph[] = [];
  pendingBlasts: PendingBlast[] = [];
  /** 순서대로 띄울 레벨업 알림 (스킬 선택창이 닫힌 뒤부터 흐릅니다) */
  notices: LevelNotice[] = [];

  stats: RunStats = { kills: 0, killsByType: {}, coins: 0, damageTaken: 0, bossKills: 0, maxLevel: 1 };

  /** 시간 감속 스킬 */
  enemyTimeScale = 1;
  timeSlowLeft = 0;

  /** 지금까지 획득한 스킬 수. 적 해금 조건에 쓰입니다 */
  skillsTaken = 0;
  /** 처리 대기 중인 스킬 선택 횟수 */
  pendingSkillChoices = 0;
  /**
   * 6레벨에 도달해 강화 갈래를 골라야 하는 스킬. 순서대로 하나씩 창이 뜹니다.
   *
   * 개수가 아니라 **목록**인 이유는 어떤 스킬의 갈래인지 알아야 화면을 그릴 수
   * 있어서입니다. 슬롯 참조가 아니라 id 를 담는 것은 참조가 낡을 수 있기 때문입니다.
   */
  pendingBranchChoices: SkillId[] = [];

  gameOver = false;
  /**
   * 지금 살아 있는 보스 수. 예전에는 `bossAlive` 라는 참/거짓이었고 1 이 상한이었습니다.
   * 못 잡으면 다음 보스가 안 나와서 보스가 주는 코인과 회복까지 끊기던 것을 고치면서
   * 개수로 바꿨습니다. 상한은 `BOSS.maxAlive` 입니다
   */
  bossesAlive = 0;
  bossesSpawned = 0;

  /** 죽는 순간 흩어지는 파편 */
  shards: Shard[] = [];
  /** 죽는 연출이 시작된 뒤 흐른 시간 */
  deathTime = 0;
  /** 파편으로 데려간 적 수. 보상은 없고 게임오버 화면에 숫자로만 남습니다 */
  shardKills = 0;

  /** 업적 판정용. 지나가면 사라지는 사건만 모읍니다 */
  track: RunTrack = emptyRunTrack();

  /** 마지막으로 플레이어에게 피해를 입힌 상대. 죽는 순간의 값이 사인이 됩니다 */
  lastDamageSource: KillerInfo | null = null;
  killedBy: KillerInfo | null = null;

  /** 이번 판의 난이도와 그로 인한 적 강화 배율 */
  readonly difficulty: number;
  readonly diff: DifficultyMods;

  /** 이번 판에서 만난 적 / 처치 수. 종료 시 도감에 반영합니다 */
  encountered = new Set<string>();

  /**
   * 지금 도는 시체 폭발이 잡은 수 (분열체 제외).
   * -1 이면 폭발을 세고 있지 않은 상태입니다. `explodeAll` 이 켜고 끕니다.
   */
  private blastKills = -1;

  private nextId = 1;
  private queryBuf: Enemy[] = [];
  /**
   * 장판 전용 질의 버퍼. `queryBuf` 를 같이 쓰면 안 됩니다.
   * 장판이 적을 죽이면 그 안에서 시체 폭발이 `blastEnemies` 를 타고
   * 같은 버퍼를 덮어써서, 돌던 목록이 통째로 바뀝니다
   */
  private hazardBuf: Enemy[] = [];

  constructor(
    readonly save: SaveData,
    readonly input: Input,
    seed?: number,
    difficulty = 0,
  ) {
    this.difficulty = clampDifficulty(difficulty);
    this.diff = difficultyMods(this.difficulty);
    this.rng = new Rng(seed);
    // **파티클은 판의 난수기를 쓰면 안 됩니다.** 설정에서 파티클을 줄이면 난수를 덜
    // 뽑게 되어 그 뒤의 스폰과 추첨이 통째로 밀립니다. 시드를 고정해도 설정마다 다른
    // 판이 되므로, 눈에 보이는 것과 게임의 결과를 갈라 놓습니다
    this.effects = new Effects(new Rng(this.rng.seed ^ 0x9e3779b9));
    this.effects.shakeScale = SETTINGS.shake.levels[save.shakeLevel].mul;
    this.effects.particleScale = SETTINGS.particles.levels[save.particleLevel].mul;
    this.player = createPlayer(save);
    this.spawner = new Spawner();
    this.skillsTaken = ownedSlots(this.player).length;

    // 난이도 15: 처치할 수 없는 바보적 한 마리가 판 내내 벽을 튕겨 다닙니다.
    // 적이라기보다 움직이는 장애물이라 스폰 표에 넣지 않고 여기서 딱 한 번만 냅니다
    if (this.diff.foolInvuln) this.spawnImmortalFool();
  }

  private spawnImmortalFool(): void {
    // 플레이어 시작 위치(중앙)와 겹치지 않게 모서리 쪽에서 시작합니다
    const x = this.rng.chance(0.5) ? CANVAS.w * 0.15 : CANVAS.w * 0.85;
    const y = this.rng.chance(0.5) ? CANVAS.h * 0.15 : CANVAS.h * 0.85;
    const e = this.spawnEnemy('fool', x, y, { immortal: true });
    // 타겟도 안 되고 탄도 느려진 대신 빠르게 돌아다닙니다. 셋이 한 묶음이라
    // 하나만 만지면 "무시하고 지나칠 수 있는 적"이 되어 존재 이유가 사라집니다
    e.speed *= ENEMY_PARAMS.fool.immortalSpeedMul;
  }

  // -------------------------------------------------------------------------
  // 갱신
  // -------------------------------------------------------------------------

  update(dt: number): void {
    this.effects.update(dt);
    if (this.gameOver) return;

    this.time += dt;

    // 업적: "첫 보스까지 안 움직이기" 는 조작 여부를 봐야 합니다.
    // 위치로 재면 넉백이나 장판 감속에 밀린 것도 움직인 것이 됩니다
    if (!this.track.moved) {
      const mv = this.input.moveVector();
      if (mv.x !== 0 || mv.y !== 0) this.track.moved = true;
    }
    this.track.noHitTimer += dt;
    if (this.track.noHitTimer > this.track.noHitBest) this.track.noHitBest = this.track.noHitTimer;

    if (this.timeSlowLeft > 0) {
      this.timeSlowLeft -= dt;
      if (this.timeSlowLeft <= 0) this.enemyTimeScale = 1;
    }

    updatePlayer(this, dt);
    this.spawner.update(this, dt);

    this.grid.rebuild(this.enemies);
    updateEnemies(this, dt);
    updateProjectiles(this, dt);
    updateCoins(this, dt);
    this.updateHazards(dt);
    this.updateTelegraphs(dt);
    this.updatePendingBlasts(dt);
    this.updateNotices(dt);
    this.collidePlayer(dt);

    compact(this.notices, (n) => !n.dead);
    compact(this.enemies, (e) => !e.dead);
    compact(this.projectiles, (p) => !p.dead);
    compact(this.coins, (c) => !c.dead);
    compact(this.hazards, (h) => !h.dead);
    compact(this.telegraphs, (t) => !t.dead);
    compact(this.pendingBlasts, (b) => !b.dead);
  }

  /**
   * 화면의 적 상한(`SPAWN.maxAlive`)에 세는 적의 수.
   *
   * **소환적의 무적 하수인은 안 셉니다.** 그것들은 본체를 잡아야만 사라지므로,
   * 상한에 넣으면 소환적 넷이 상한의 4분의 1을 판이 끝날 때까지 붙들고 있어
   * 후반에 다른 적이 아예 안 나오는 판이 됩니다. 하수인은 스폰 압력이 아니라
   * 소환적이 걸어둔 자물쇠라 성질이 다릅니다.
   *
   * **상한을 보는 곳은 전부 이 함수를 거쳐야 합니다.** 한 곳이라도 `enemies.length`
   * 를 그대로 쓰면 그쪽에서만 하수인이 세어져서 규칙이 갈립니다.
   */
  countedAlive(): number {
    let n = 0;
    for (const e of this.enemies) {
      if (!e.dead && e.ownerId === 0) n++;
    }
    return n;
  }

  /** 때가 된 알림을 플레이어 머리 위에 띄웁니다 */
  private updateNotices(dt: number): void {
    for (const n of this.notices) {
      n.delay -= dt;
      if (n.delay > 0) continue;
      n.dead = true;
      this.effects.text(this.player.x, this.player.y + n.dy, n.text, n.color, n.size);
    }
  }

  /** 지금 줄 서 있는 알림이 전부 뜨기까지 남은 시간 */
  noticeTail(): number {
    let tail = 0;
    for (const n of this.notices) tail = Math.max(tail, n.delay);
    return tail;
  }

  queueNotice(text: string, color: string, size: number, delay: number, dy: number): void {
    this.notices.push({ text, color, size, delay, dy, dead: false });
  }

  /** 예고해 둔 폭발이 때가 되면 터집니다 (폭격기 보스) */
  private updatePendingBlasts(dt: number): void {
    for (const b of this.pendingBlasts) {
      b.delay -= dt;
      if (b.delay > 0) continue;
      b.dead = true;
      if (b.hitsAll) this.explodeAll(b.x, b.y, b.radius, b.damage, b.color, b.source);
      else this.explode(b.x, b.y, b.radius, b.damage, false, b.color, b.source);
    }
  }

  private updateHazards(dt: number): void {
    for (const h of this.hazards) {
      h.life -= dt;
      if (h.arm > 0) h.arm -= dt;
      else if (h.tickDamage > 0) h.tick -= dt;
      if (h.life <= 0) {
        h.dead = true;
        continue;
      }

      // 적을 때리는 장판만 여기서 스스로 판정합니다.
      // 플레이어 쪽은 예전 그대로 collidePlayer 가 맡습니다 (무적·대시 규칙이 거기 있습니다)
      if (h.side !== 'enemy' || h.arm > 0 || h.tickDamage <= 0 || h.tick > 0) continue;
      h.tick = h.tickInterval;
      const near = this.grid.query(h.x, h.y, h.radius + 40, this.hazardBuf);
      for (const e of near) {
        if (e.dead) continue;
        if (dist(h.x, h.y, e.x, e.y) > h.radius + e.radius) continue;
        // fromX/fromY 를 안 넘깁니다 = 방패 판정을 안 탑니다.
        // 발밑에 깔린 불을 정면 방패로 가릴 수는 없습니다 (화상과 같은 규칙)
        this.damageEnemy(e, h.tickDamage, { showNumber: false });
        if (h.slow < 1) this.slowEnemy(e, h.slow, h.tickInterval * 1.5);
        if (h.burnTime > 0) {
          // 화상은 합해지지 않고 가장 센 것 하나만 남습니다 (projectile.ts 와 같은 규칙)
          e.burnDps = Math.max(e.burnDps, h.burnDps);
          e.burnTime = Math.max(e.burnTime, h.burnTime);
        }
      }
    }
  }

  private updateTelegraphs(dt: number): void {
    for (const t of this.telegraphs) {
      t.life -= dt;
      if (t.life <= 0) t.dead = true;
    }
  }

  /** 적과의 접촉 피해, 장판 효과 */
  private collidePlayer(dt: number): void {
    const p = this.player;
    if (!p.alive) return;

    p.slowTime -= dt;
    if (p.slowTime <= 0) p.slow = 1;

    for (const h of this.hazards) {
      // 내가 깐 장판은 나를 안 때립니다. 없으면 화염 지뢰가 내 발밑을 태웁니다
      if (h.side !== 'player') continue;
      if (dist(p.x, p.y, h.x, h.y) >= h.radius + p.radius) continue;
      p.slow = Math.min(p.slow, h.slow);
      p.slowTime = 0.25;
      // 밟고 있는 동안만 틱이 도는 것이 아니라 장판 자체가 틱을 돌립니다.
      // 그래야 장판을 들락거리며 피해를 계속 미루는 일이 안 생깁니다
      // 무적 시간을 무시하지 않습니다. 대시로 빠져나가는 것이 장판의 정답이어야 하는데
      // 무적을 뚫으면 대시 중에도 맞아서, 유일한 탈출 수단이 무력해집니다
      if (h.tickDamage > 0 && h.arm <= 0 && h.tick <= 0) {
        h.tick = h.tickInterval;
        this.damagePlayer(h.tickDamage, false, h.source);
      }
    }

    if (p.invuln > 0 || p.dashTime > 0) return;

    const near = this.grid.query(p.x, p.y, 60, this.queryBuf);
    for (const e of near) {
      // 쓰러져 있는 미라는 시체라 밟고 지나가도 아무 일이 없습니다
      if (e.dead || e.downed > 0) continue;
      if (dist(p.x, p.y, e.x, e.y) < e.radius + p.radius) {
        // 접촉 피해만 따로 오르는 난이도가 있습니다 (탄·장판·폭발은 damageMul 쪽에서 이미 처리)
        this.damagePlayer(e.damage * this.diff.contactDamageMul, false, killerOf(e));
        return;
      }
    }
  }

  // -------------------------------------------------------------------------
  // 생성
  // -------------------------------------------------------------------------

/**
   * 시간만으로 붙는 체력 배율 (난이도 배율은 뺀 값). 화면에 보여줄 때 씁니다.
   * 상한도 구간도 없이 분당 +0.2 로 쭉 오릅니다 (`TIME_SCALING` 주석 참고).
   */
  timeMultiplier(): number {
    return 1 + (this.time / 60) * TIME_SCALING.hpPerMinute;
  }

  /** 후반 속도 배율. 15분부터, 체력·공격력보다 훨씬 느리게 오릅니다 */
  lateSpeedMultiplier(): number {
    const over = Math.max(0, this.time / 60 - TIME_SCALING.speedStartMinute);
    return 1 + over * TIME_SCALING.speedPerMinute;
  }

  /**
   * 경과 시간에 따른 적 강화 배율. 스폰하는 순간에만 적용됩니다.
   * 난이도 배율도 여기서 함께 곱합니다 (난이도 0 이면 전부 1 이라 기존과 같습니다).
   */
  timeScale(): { hp: number; dmg: number; speed: number } {
    const minutes = this.time / 60;
    return {
      hp: (1 + minutes * TIME_SCALING.hpPerMinute) * this.diff.hpMul,
      dmg: (1 + minutes * TIME_SCALING.damagePerMinute) * this.diff.damageMul,
      speed: this.lateSpeedMultiplier() * this.diff.speedMul,
    };
  }

  spawnEnemy(id: EnemyId, x: number, y: number, opts: SpawnEnemyOptions = {}): Enemy {
    const def = getEnemyDef(id);
    const bal = ENEMY_TABLE[id];
    const scaling = this.timeScale();
    const elite = opts.elite ?? false;
    const scale = (opts.scale ?? 1) * eliteStatMul(id, elite, 'sizeMul');
    // 난이도 12 의 자폭병 전용 조정. 다른 적에게는 1 입니다
    const bomberMul =
      id === 'bomber'
        ? { speed: this.diff.bomberSpeedMul, damage: this.diff.bomberDamageMul }
        : { speed: 1, damage: 1 };

    // 체력 · 속도 · 공격력 · 크기 모두 종류별 정예 값이 있으면 그것으로 대체됩니다
    const maxHp =
      ENEMY_BASE.hp * bal.hp * scaling.hp * eliteStatMul(id, elite, 'hpMul') * (opts.hpMul ?? 1);
    const shieldRatio = def.hasShield
      ? (elite ? ELITE_TRAITS[id]?.shieldRatio ?? ENEMY_PARAMS.shield.durabilityRatio : ENEMY_PARAMS.shield.durabilityRatio)
      : 0;

    const e: Enemy = {
      id: this.nextId++,
      defId: id,
      def,
      x,
      y,
      vx: 0,
      vy: 0,
      radius: ENEMY_BASE.radius * bal.radiusMul * scale,
      hp: maxHp,
      maxHp,
      speed:
        ENEMY_BASE.speed * bal.speed * eliteStatMul(id, elite, 'speedMul') * scaling.speed * bomberMul.speed,
      damage:
        ENEMY_BASE.damage * bal.damage * scaling.dmg * eliteStatMul(id, elite, 'damageMul') * bomberMul.damage,
      xp: ENEMY_BASE.xp * bal.xpMul * (elite ? ELITE.xpMul : 1) * (opts.child ? 0.4 : 1),
      elite,
      boss: false,
      child: opts.child ?? false,
      facing: 0,
      hitFlash: 0,
      dead: false,
      alpha: 1,
      /**
       * **영구 무적인 개체는 타겟이 되지 않습니다.**
       *
       * 자동 조준이 못 죽이는 적을 물고 있으면 그동안 나가는 화력이 통째로 버려집니다.
       * 조준 조작이 없는 게임이라 플레이어가 대상을 바꿀 방법도 없습니다.
       * `!e.targetable` 이면 투사체도 그냥 통과하므로 몸으로 탄을 막지도 못합니다.
       * 은신적이 쓰는 것과 같은 칸이지만, 저쪽은 1초마다 켜졌다 꺼지고 이쪽은 판 내내 꺼져 있습니다.
       */
      targetable: !(opts.immortal ?? false),
      phasing: false,
      shieldHp: maxHp * shieldRatio,
      shieldMax: maxHp * shieldRatio,
      burnTime: 0,
      burnDps: 0,
      burnTick: 0,
      slow: 1,
      slowTime: 0,
      stun: 0,
      invuln: 0,
      immortal: opts.immortal ?? false,
      knockVx: 0,
      knockVy: 0,
      spawnTime: this.time,
      dashes: 0,
      statusImmune: false,
      ownerId: opts.ownerId ?? 0,
      // 소환적은 스폰하는 순간 부를 하수인 종류를 뽑아서 판이 끝날 때까지 그것만 부릅니다
      summonKind: id === 'summoner' ? this.rng.pick(ENEMY_PARAMS.summoner.minionPool as EnemyId[]) : null,
      downed: 0,
      revived: false,
      hpDrainRatio: 0,
      speedDecay: 0,
      speedFloor: 0,
      state: { timer: 0, timer2: 0, timer3: 0, phase: 0, angle: 0, flag: false, targetX: 0, targetY: 0 },
    };

    def.init?.(e, this);
    this.enemies.push(e);
    this.encountered.add(id);
    return e;
  }

  /** 종류를 지정하지 않으면 등장 순서대로 돌아가며 나옵니다 */
  spawnBoss(kind?: BossId): Enemy {
    const bossId = kind ?? bossIdForSpawn(this.bossesSpawned);
    const def = getEnemyDef(bossId);
    const variant = BOSS_VARIANTS[bossId];
    const scaling = this.timeScale();
    // 보스 체력에는 시간 배율도 후반 심화 배율도 넣지 않습니다.
    // 등장 횟수에 따른 증가만으로 충분히 단단해지고, 여기에 배율이 겹치면
    // 보스를 못 잡아 다음 보스가 영영 안 나옵니다. 공격력에는 배율이 붙습니다.
    const growth = 1 + this.bossesSpawned * BOSS.hpGrowthPerSpawn;
    const maxHp = BOSS.hp * growth * this.diff.bossHpMul * variant.hpMul;
    const e: Enemy = {
      id: this.nextId++,
      defId: bossId,
      def,
      x: CANVAS.w / 2,
      y: -60,
      vx: 0,
      vy: 0,
      radius: BOSS.radius * variant.radiusMul,
      hp: maxHp,
      maxHp,
      speed: BOSS.speed * scaling.speed * variant.speedMul,
      damage: BOSS.damage * scaling.dmg * variant.damageMul * this.diff.bossDamageMul,
      xp: BOSS.xp,
      elite: false,
      boss: true,
      immortal: false,
      child: false,
      facing: Math.PI / 2,
      hitFlash: 0,
      dead: false,
      alpha: 1,
      targetable: true,
      phasing: true,
      shieldHp: 0,
      shieldMax: 0,
      burnTime: 0,
      burnDps: 0,
      burnTick: 0,
      slow: 1,
      slowTime: 0,
      stun: 0,
      invuln: 0,
      knockVx: 0,
      knockVy: 0,
      spawnTime: this.time,
      dashes: 0,
      statusImmune: false,
      ownerId: 0,
      summonKind: null,
      downed: 0,
      revived: false,
      hpDrainRatio: 0,
      speedDecay: 0,
      speedFloor: 0,
      state: { timer: 0, timer2: 0, timer3: 0, phase: 0, angle: 0, flag: false, targetX: 0, targetY: 0 },
    };
    // 종류마다 쓰는 타이머가 달라서 각 보스 정의가 직접 채웁니다
    def.init?.(e, this);
    this.enemies.push(e);
    this.encountered.add(bossId);
    this.bossesAlive++;
    this.bossesSpawned++;
    this.effects.addShake(14);
    return e;
  }

  addProjectile(p: Partial<Projectile> & { x: number; y: number }): Projectile {
    const defaults: Projectile = {
      kind: 'bullet',
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      radius: 5,
      damage: 0,
      life: 3,
      friendly: true,
      crit: false,
      color: '#ffe08a',
      pierce: 0,
      hits: null,
      targetId: 0,
      turnRate: 0,
      destX: 0,
      destY: 0,
      blast: 0,
      orbitAngle: 0,
      orbitRadius: 0,
      orbitSpeed: 0,
      burnDps: 0,
      burnTime: 0,
      slowFactor: 1,
      slowTime: 0,
      knockback: 0,
      arm: 0,
      ignoreShield: false,
      hpBonus: 0,
      blastHazard: null,
      execute: null,
      cluster: null,
      splitOnHit: null,
      splitsLeft: 0,
      orbFragment: null,
      source: null,
      dead: false,
    };
    const proj: Projectile = { ...defaults, ...p };
    // 난이도의 적탄 속도 배율은 여기 한 곳에서 겁니다.
    // 쏘는 곳(원거리적·바보적·보스 셋)이 흩어져 있어서, 각자 곱하게 두면 반드시 하나를 빠뜨립니다
    if (!proj.friendly && this.diff.bulletSpeedMul !== 1) {
      proj.vx *= this.diff.bulletSpeedMul;
      proj.vy *= this.diff.bulletSpeedMul;
    }
    if (proj.pierce > 0 && !proj.hits) proj.hits = new Set();
    this.projectiles.push(proj);
    return proj;
  }

  addHazard(h: {
    x: number;
    y: number;
    radius: number;
    duration: number;
    slow: number;
    color: string;
    /** 피해가 시작되기까지의 유예 (기본 0) */
    arm?: number;
    /** 피해 간격 (기본 0.5초) */
    tickInterval?: number;
    /** 한 틱 피해 (기본 0 = 감속만) */
    tickDamage?: number;
    source?: KillerInfo | null;
    /** 때리는 쪽. 기본은 적이 깐 것(`'player'`) */
    side?: 'player' | 'enemy';
    /** 밟은 적에게 붙일 화상 (`side === 'enemy'` 일 때만) */
    burnDps?: number;
    burnTime?: number;
  }): void {
    const tickInterval = h.tickInterval ?? 0.5;
    const side = h.side ?? 'player';
    const arm = h.arm ?? 0;
    // 장판 지속 시간도 난이도가 건드립니다. 까는 곳이 여럿이라 여기 한 곳에서 겁니다.
    // **내가 깐 장판은 제외합니다.** 난이도가 오를수록 내 스킬이 세지면 앞뒤가 안 맞습니다
    const duration = side === 'player' ? h.duration * this.diff.hazardDurationMul : h.duration;
    this.hazards.push({
      x: h.x,
      y: h.y,
      radius: h.radius,
      life: duration,
      maxLife: duration,
      slow: h.slow,
      arm,
      maxArm: arm,
      tickInterval,
      tick: tickInterval,
      tickDamage: h.tickDamage ?? 0,
      color: h.color,
      side,
      burnDps: h.burnDps ?? 0,
      burnTime: h.burnTime ?? 0,
      source: h.source ?? null,
      dead: false,
    });
  }

  addTelegraph(t: Partial<Telegraph> & { kind: Telegraph['kind']; x: number; y: number; life: number }): Telegraph {
    const defaults: Telegraph = {
      kind: 'spawn',
      x: 0,
      y: 0,
      x2: 0,
      y2: 0,
      radius: 0,
      width: 2,
      life: 1,
      maxLife: 1,
      color: '#ff5d5d',
      owner: 0,
      dead: false,
    };
    const tel: Telegraph = { ...defaults, ...t, maxLife: t.maxLife ?? t.life };
    this.telegraphs.push(tel);
    return tel;
  }

  /** 지금 예고하고 delay 초 뒤에 터지는 폭발 */
  addPendingBlast(b: Omit<PendingBlast, 'dead'>): void {
    this.pendingBlasts.push({ ...b, dead: false });
  }

  dropCoin(x: number, y: number, value = COIN.value, spread = 0): void {
    const a = this.rng.angle();
    const s = spread > 0 ? this.rng.range(0, spread) : 0;
    this.coins.push({
      x: x + Math.cos(a) * s,
      y: y + Math.sin(a) * s,
      vx: Math.cos(a) * this.rng.range(30, 90),
      vy: Math.sin(a) * this.rng.range(30, 90),
      speed: 0,
      value,
      life: COIN.lifetime,
      magnet: false,
      dead: false,
    });
  }

  // -------------------------------------------------------------------------
  // 피해 처리
  // -------------------------------------------------------------------------

  damageEnemy(e: Enemy, amount: number, opts: DamageOptions = {}): number {
    if (e.dead || amount <= 0) return 0;

    // 쓰러져 있는 동안(미라)은 이미 한 번 죽은 상태라 아무 피해도 안 들어갑니다
    if (e.downed > 0) return 0;

    if (e.invuln > 0 || e.immortal) {
      this.effects.burst(e.x, e.y, 2, '#dbe6f7', 70, 2, 0.2);
      return 0;
    }

    // 정예 방패적은 방패가 남아 있는 동안 덜 아프고, 깨지고 나면 더 아픕니다.
    // 방패를 깨는 것이 곧 이득이 되도록 만드는 부분입니다
    amount *= eliteValue(e, e.shieldHp > 0 ? 'shieldedDamageTaken' : 'brokenDamageTaken', 1);

    // 방패는 정면 피해를 대신 받습니다. 다 닳으면 무효화가 사라지고 대신 빨라집니다
    if (e.shieldHp > 0 && !opts.ignoreShield && opts.fromX !== undefined && opts.fromY !== undefined) {
      if (e.def.blocks?.(e, opts.fromX, opts.fromY)) {
        e.shieldHp -= amount;
        e.hitFlash = ENEMY_BASE.hitFlash;
        this.effects.burst(e.x + Math.cos(e.facing) * e.radius, e.y + Math.sin(e.facing) * e.radius, 2, '#dbe6f7', 90, 2, 0.2);
        if (e.shieldHp <= 0) {
          e.shieldHp = 0;
          e.speed *= ENEMY_PARAMS.shield.brokenSpeedMul;
          this.effects.text(e.x, e.y - e.radius - 8, '방패 파괴', '#dbe6f7', 15);
          this.effects.burst(e.x, e.y, 14, '#dbe6f7', 200, 3, 0.5);
        }
        return 0;
      }
    }

    e.hp -= amount;
    e.hitFlash = ENEMY_BASE.hitFlash;
    e.def.onDamaged?.(e, this, amount);

    if (opts.showNumber !== false) {
      const txt = amount >= 10 ? String(Math.round(amount)) : amount.toFixed(1);
      this.effects.text(
        e.x + this.rng.range(-6, 6),
        e.y - e.radius - 4,
        opts.crit ? `${txt}!` : txt,
        opts.crit ? '#ffd166' : '#ffffff',
        opts.crit ? 19 : 14,
      );
    }

    if (opts.knockback && !e.boss && !e.statusImmune) {
      const fx = opts.fromX ?? e.x;
      const fy = opts.fromY ?? e.y;
      const a = Math.atan2(e.y - fy, e.x - fx);
      e.knockVx += Math.cos(a) * opts.knockback;
      e.knockVy += Math.sin(a) * opts.knockback;
    }

    if (e.hp <= 0) {
      // 업적: 넉백이 실린 피해로 보스를 끝냈는가.
      // 보스는 실제로 밀리지 않지만(위 `!e.boss`) 피해는 그대로 들어갑니다
      if (e.boss && opts.knockback) this.track.knockbackBossKill = true;
      // 미라는 여기서 죽지 않고 쓰러집니다. true 를 돌려주면 처치 처리를 통째로 건너뜁니다
      if (e.def.onLethal?.(e, this)) return amount;
      this.killEnemy(e);
    }
    return amount;
  }

  killEnemy(e: Enemy): void {
    if (e.dead) return;
    e.dead = true;

    // 이 적이 띄워둔 예고는 같이 걷습니다.
    // 차지 도중에 잡은 돌진적의 경로가 남아 있으면 오지도 않을 돌진을 계속 피하게 됩니다
    for (const t of this.telegraphs) {
      if (t.owner === e.id) t.dead = true;
    }

    this.stats.kills++;
    if (this.blastKills >= 0 && !e.child) this.blastKills++;
    const key = e.defId;
    this.stats.killsByType[key] = (this.stats.killsByType[key] ?? 0) + 1;
    this.recordKillForAchievements(e);

    this.effects.burst(e.x, e.y, e.boss ? 46 : e.elite ? 16 : 9, e.def.color, e.boss ? 260 : 150, e.boss ? 5 : 3);
    if (e.elite || e.boss) this.effects.addShake(e.boss ? 20 : 4);

    this.gainXp(e.xp);

    if (e.boss) {
      this.stats.bossKills++;
      // 보스 코인은 난이도 3당 1.2배로 따로 오릅니다
      const bossCoins = Math.round(BOSS.coinDrop * this.diff.bossCoinMul);
      for (let i = 0; i < bossCoins; i++) this.dropCoin(e.x, e.y, 1, 70);
      this.healPlayer(this.player.stats.maxHp * BOSS.healRatio);
      this.bossesAlive = Math.max(0, this.bossesAlive - 1);
    } else if (e.elite && !e.child && !this.diff.allElite) {
      // 분열체는 정예라도 코인을 안 줍니다. 정예 분열적은 1 → 3 → 9 로 늘어나므로
      // 개체마다 확정 드랍을 주면 한 마리에서 코인이 13개씩 쏟아집니다.
      // 보상은 "정예 한 마리를 잡았다"에 붙는 것이지 몸통 수에 붙는 것이 아닙니다.
      //
      // 전원이 정예인 난이도(9 이상)에서는 이 확정 드랍을 끕니다. 전부 정예인데
      // 전부 확정으로 주면 그냥 "모든 적이 코인을 떨어뜨린다"가 되어, 난이도 배율과 겹쳐 코인이 폭증합니다
      for (let i = 0; i < ELITE.coinDrop; i++) this.dropCoin(e.x, e.y, 1, 14);
    } else if (!e.child && this.rng.chance(ENEMY_BASE.coinChance)) {
      this.dropCoin(e.x, e.y);
    }

    // 이 적이 불러낸 하수인은 주인이 죽는 순간 한꺼번에 사라집니다 (소환적)
    this.despawnMinions(e);

    e.def.onDeath?.(e, this);
  }

  /**
   * 주인이 죽을 때 하수인을 전부 지웁니다 (소환적의 무적 하수인).
   *
   * **`killEnemy` 를 타지 않습니다.** 그쪽을 거치면 경험치 · 처치 통계 · 업적이
   * 하수인 수만큼 붙어서, 소환적 하나가 다섯 마리 몫의 보상을 주게 됩니다.
   * 보상은 확률로 떨어지는 코인뿐입니다.
   */
  private despawnMinions(owner: Enemy): void {
    if (owner.id === 0) return;
    for (const m of this.enemies) {
      if (m.dead || m.ownerId !== owner.id) continue;
      m.dead = true;
      this.effects.burst(m.x, m.y, 10, m.def.color, 160, 3, 0.45);
      for (const t of this.telegraphs) {
        if (t.owner === m.id) t.dead = true;
      }
      if (this.rng.chance(ENEMY_PARAMS.summoner.minionCoinChance)) this.dropCoin(m.x, m.y);
    }
  }

  /**
   * 처치 하나가 업적 조건에 걸리는지 여기서 한 번에 봅니다.
   *
   * `killEnemy` 안에 조건문을 흩어놓으면 업적이 늘어날 때마다 그 함수가 부풀고,
   * 무엇이 게임 규칙이고 무엇이 업적용 기록인지 구분이 안 됩니다.
   */
  private recordKillForAchievements(e: Enemy): void {
    const t = this.track;
    if (e.elite && !e.child) t.eliteKills++;

    // 방패가 남은 채로 잡았다 = 관통·폭발 계열로 방패를 우회했다는 뜻입니다
    if (e.defId === 'shield' && e.shieldHp > 0) t.shieldIntactKill = true;

    // 은신적은 드러난 동안에만 타겟이 됩니다. 그때 잡았다는 것이 조건입니다
    // 드러나 있기만 하면 되는 것이 아니라, **드러난 직후** 여야 합니다.
    // 드러난 시각은 은신적 행동이 `state.timer` 에 적어둡니다
    if (
      e.defId === 'stealth' &&
      e.targetable &&
      this.time - e.state.timer <= ENEMY_PARAMS.stealth.blinkKillWindow
    ) {
      t.stealthRevealKill = true;
    }

    // 난이도 13 이상의 돌진적은 쿨타임이 없어 스폰 직후 바로 예고에 들어갑니다.
    // 한 번도 안 돌진시켰다는 것은 예고 안에 끝냈다는 뜻입니다
    if (e.defId === 'charger' && e.dashes === 0 && this.diff.chargerNoCooldown) t.chargerNoDashKill = true;

    if (!e.boss) return;
    const took = this.time - e.spawnTime;
    if (took < t.fastestBossKill) t.fastestBossKill = took;
    // 이 보스가 살아 있는 내내 한 대도 안 맞았는가
    if (t.lastHitTime < e.spawnTime) t.bossNoHitKill = true;
  }

  damagePlayer(amount: number, ignoreInvuln = false, source?: KillerInfo | null): void {
    const p = this.player;
    if (!p.alive || amount <= 0) return;
    if (!ignoreInvuln && (p.invuln > 0 || p.dashTime > 0)) return;

    if (source) this.lastDamageSource = source;

    // 업적: 무피해 구간이 여기서 끊깁니다
    this.track.noHitTimer = 0;
    this.track.lastHitTime = this.time;

    p.hp -= amount;
    this.stats.damageTaken += amount;
    if (!ignoreInvuln) p.invuln = p.stats.invulnTime;
    this.effects.flashHurt(0.7);
    this.effects.addShake(6);
    this.effects.burst(p.x, p.y, 8, '#ff6b6b', 160, 3);

    if (p.hp <= 0) this.resolveDown(source);
  }

  /**
   * 체력이 0 이하로 떨어졌을 때의 처리. 부활이 남아 있으면 되살리고 아니면 판을 끝냅니다.
   * 적에게 맞아 죽든 스스로 대가를 치르다 죽든(`spendHp`) 여기 한 곳으로 모읍니다.
   */
  private resolveDown(source?: KillerInfo | null): void {
    const p = this.player;
    if (p.revives > 0) {
      p.revives--;
      this.track.revivesUsed++;
      // 상점 문구가 이 값을 그대로 읽습니다. 여기만 고치면 화면이 거짓말을 합니다
      p.hp = p.stats.maxHp * REVIVE_UPGRADE.hpRatio;
      p.invuln = 2.5;
      this.effects.addShake(18);
      this.effects.text(p.x, p.y - 40, '부활', '#6ee7a0', 26);
      return;
    }
    p.hp = 0;
    p.alive = false;
    this.killedBy = source ?? this.lastDamageSource;
    this.gameOver = true;
    this.startDeathBurst();
  }

  /**
   * 스킬의 대가로 스스로 체력을 깎습니다 (넉백 폭발).
   *
   * `damagePlayer` 를 안 쓰는 이유가 셋입니다. 무적으로 막히면 안 되고(대가는 반드시
   * 치러야 합니다), 무적 시간을 새로 켜면 안 되며(대가를 치를수록 공짜 무적이 붙습니다),
   * "한 대도 안 맞았다" 업적이 내가 낸 대가 때문에 끊기면 안 됩니다.
   * 죽는 처리만은 그대로 태웁니다.
   */
  spendHp(amount: number): void {
    const p = this.player;
    if (!p.alive || amount <= 0) return;
    p.hp -= amount;
    this.effects.text(p.x, p.y - 34, `-${Math.round(amount)}`, '#ff6b6b', 17);
    if (p.hp <= 0) this.resolveDown(null);
  }

  /** 최대 체력을 넘지 않게 회복합니다 (긴급 의약품, 보스 처치) */
  healPlayer(amount: number): number {
    const p = this.player;
    if (!p.alive || amount <= 0) return 0;
    const before = p.hp;
    p.hp = Math.min(p.stats.maxHp, p.hp + amount);
    const gained = p.hp - before;
    if (gained > 0) this.effects.text(p.x, p.y - 34, `+${Math.round(gained)}`, '#6ee7a0', 19);
    return gained;
  }

  /**
   * 기절을 겁니다. 보스는 `STATUS.bossStatusResist` 만큼 덜 받습니다.
   *
   * **스킬 쪽에서 `e.stun` 을 직접 건드리지 말고 반드시 이걸 쓰십시오.**
   * 보스 저항이 빠진 곳이 하나만 생겨도 그 스킬 하나로 보스가 통째로 멈춥니다.
   */
  stunEnemy(e: Enemy, seconds: number): void {
    // 돌진 중에는 안 걸립니다 (`Enemy.statusImmune` 주석 참고)
    if (e.statusImmune) return;
    const s = e.boss ? seconds * (1 - STATUS.bossStatusResist) : seconds;
    e.stun = Math.max(e.stun, s);
  }

  /**
   * 감속을 겁니다. factor 는 이동속도 배율이라 작을수록 느립니다.
   * 보스는 **감속되는 폭만** 줄어듭니다 (0.55 → 0.865).
   */
  slowEnemy(e: Enemy, factor: number, time: number): void {
    if (e.statusImmune) return;
    const f = e.boss ? 1 - (1 - factor) * (1 - STATUS.bossStatusResist) : factor;
    e.slow = Math.min(e.slow, f);
    e.slowTime = Math.max(e.slowTime, time);
  }

  // -------------------------------------------------------------------------
  // 죽는 연출 (파편 수류탄)
  // -------------------------------------------------------------------------

  /**
   * 죽는 순간 플레이어를 조각내 날립니다.
   *
   * 이 시점부터 판은 통째로 멈춥니다. `update` 가 `gameOver` 에서 곧장 빠져나가고,
   * 대신 `updateDeathBurst` 만 돕니다. 움직이는 것이 파편뿐이라
   * "시간이 멈춘 자리에 파편만 날아간다"로 읽힙니다.
   */
  private startDeathBurst(): void {
    const p = this.player;
    this.effects.addDeathShake(DEATH_BURST.shake);
    this.effects.flashHurt(1.2);
    this.effects.burst(p.x, p.y, 60, '#ffffff', 300, 4, 0.9);

    // 방향은 원을 고르게 나눠서 잡습니다. 전부 무작위로 뽑으면 한쪽으로 뭉쳐서
    // "쪼개졌다"가 아니라 "한 방향으로 튀었다"로 보입니다
    const base = this.rng.angle();
    for (let i = 0; i < DEATH_BURST.count; i++) {
      const a = base + (TAU * i) / DEATH_BURST.count + this.rng.range(-0.12, 0.12);
      const speed = this.rng.range(DEATH_BURST.speedMin, DEATH_BURST.speedMax);
      this.shards.push({
        x: p.x,
        y: p.y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        size: p.radius * DEATH_BURST.sizeMul * this.rng.range(0.7, 1.2),
        angle: a,
        spin: this.rng.range(-DEATH_BURST.spinMax, DEATH_BURST.spinMax),
        life: DEATH_BURST.duration,
        maxLife: DEATH_BURST.duration,
        touched: new Set(),
      });
    }
  }

  /**
   * 죽는 연출 한 프레임. 끝났으면 true 를 돌려줍니다.
   *
   * 적·적탄·장판·스폰은 전부 세워둔 채라 여기서 `update` 를 부르지 않습니다.
   * 파편과 이펙트만 굴립니다.
   */
  updateDeathBurst(dt: number, skip = false): boolean {
    this.deathTime += dt;
    this.effects.update(dt);

    for (const s of this.shards) {
      s.life -= dt;
      if (s.life <= 0) continue;
      const d = Math.max(0, 1 - DEATH_BURST.drag * dt);
      s.vx *= d;
      s.vy *= d;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.angle += s.spin * dt;
      this.shardHits(s);
    }
    compact(this.shards, (s) => s.life > 0);

    if (skip && this.deathTime >= DEATH_BURST.skipAfter) return true;
    return this.deathTime >= DEATH_BURST.duration;
  }

  /**
   * 파편 하나가 닿은 적을 처리합니다.
   *
   * `killEnemy` 를 부르지 않는 것이 요점입니다. 그쪽을 타면 경험치·코인·처치 통계가
   * 붙고 분열과 시체 폭발까지 이어집니다. 판은 이미 끝났고 보상을 주면
   * "잡몹 한가운데서 일부러 죽는" 것이 이득이 되므로, 여기서는 지우기만 합니다.
   */
  private shardHits(s: Shard): void {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (s.touched.has(e.id)) continue;
      if (dist(s.x, s.y, e.x, e.y) > e.radius + DEATH_BURST.hitRadius) continue;
      s.touched.add(e.id);

      // 보스와 무적 개체는 파편으로 죽지 않습니다.
      // 체력 1600 인 보스가 파편 하나에 지워지면 "잡기 힘들면 옆에서 죽으면 된다"가 되고,
      // 난이도 15 의 무적 바보적은 못 죽는다는 것 자체가 그 적의 규칙입니다
      if (e.boss || e.immortal || e.invuln > 0) {
        if (e.boss) this.track.shardHitBoss = true;
        this.effects.spray(s.x, s.y, Math.atan2(-s.vy, -s.vx), 0.7, 5, '#ffffff', 190, 2);
        continue;
      }

      this.effects.burst(e.x, e.y, e.elite ? 14 : 8, e.def.color, 190, 3, 0.5);
      // 이 적이 띄워둔 예고도 같이 걷습니다. 주인이 사라졌는데 예고만 남으면 안 됩니다
      for (const t of this.telegraphs) {
        if (t.owner === e.id) t.dead = true;
      }
      this.enemies.splice(i, 1);
      this.shardKills++;
    }
  }

  /** 원형 폭발. friendly 면 적에게, 아니면 플레이어에게 피해 */
  /**
   * @param ignoreShield 방패를 뚫는가. **기본값은 true 입니다.**
   *   폭발은 사방에서 덮치므로 정면을 막는 방패로는 못 가린다는 것이 원래 규칙이고,
   *   유탄·지뢰·시체 폭발이 전부 그렇습니다. 예외는 추적 미사일뿐입니다.
   *   미사일은 방패에 막히는 스킬로 정했는데(2026-08-12), 착탄 폭발이 방패를 뚫으면
   *   본체만 막히고 피해는 그대로 들어가서 "막힌다"가 말뿐이 됩니다.
   */
  explode(
    x: number,
    y: number,
    radius: number,
    damage: number,
    friendly: boolean,
    color = '#ff9a3c',
    source?: KillerInfo | null,
    ignoreShield = true,
  ): void {
    this.blastVisual(x, y, radius, color);
    if (friendly) this.blastEnemies(x, y, radius, damage, ignoreShield);
    else this.blastPlayer(x, y, radius, damage, source);
  }

  /**
   * 적과 플레이어를 함께 때리는 폭발 (자폭적의 시체 폭발).
   * 편을 가리지 않으므로 잡몹 한가운데서 자폭적을 잡으면 그 자리가 통째로 정리됩니다.
   * 대신 내가 그 자리에 남아 있으면 나도 맞습니다.
   */
  explodeAll(x: number, y: number, radius: number, damage: number, color: string, source?: KillerInfo | null): void {
    this.blastVisual(x, y, radius, color);

    // 업적: 이 한 번의 폭발로 몇 마리가 정리됐는가.
    // **분열체는 안 셉니다.** 분열적 하나를 터뜨리면 그 자리에서 3마리가 더 죽어
    // 마릿수가 저절로 불어나는데, 그러면 "잡몹 한가운데서 터뜨렸다"가 아니라
    // "분열적 옆에서 터뜨렸다"가 되어 조건의 뜻이 달라집니다
    this.blastKills = 0;
    this.blastEnemies(x, y, radius, damage);
    const got = this.blastKills;
    this.blastKills = -1;
    if (got > this.track.corpseBlastBest) this.track.corpseBlastBest = got;

    // 내가 잡은 자폭적의 폭발에 내가 죽는 경우를 잡아냅니다.
    // 시체 폭발은 편을 가리지 않으므로 그 자리에 남아 있으면 나도 맞습니다
    const aliveBefore = this.player.alive;
    this.blastPlayer(x, y, radius, damage, source);
    if (aliveBefore && !this.player.alive) this.track.diedToOwnCorpseBlast = true;
  }

  private blastVisual(x: number, y: number, radius: number, color: string): void {
    this.effects.burst(x, y, 22, color, 260, 4, 0.5);
    this.effects.addShake(5);
    this.addTelegraph({ kind: 'blast', x, y, radius, life: 0.22, color });
  }

  private blastEnemies(x: number, y: number, radius: number, damage: number, ignoreShield = true): void {
    const near = this.grid.query(x, y, radius + 40, this.queryBuf);

    for (const e of near) {
      if (e.dead) continue;
      if (dist(x, y, e.x, e.y) <= radius + e.radius) {
        // 폭발은 사방에서 덮치므로 기본적으로 방패를 무시합니다 (`explode` 주석 참고).
        // 방패를 존중하는 폭발은 **터진 자리에서 온 것**으로 봅니다. 미사일은 적의
        // 몸에 닿는 순간 그 자리에서 터지므로, 직격이 정면이었으면 폭발도 정면입니다.
        // 즉 폭발이 직격과 같은 판정을 따릅니다
        this.damageEnemy(e, damage, { fromX: x, fromY: y, ignoreShield });
      }
    }
  }

  private blastPlayer(x: number, y: number, radius: number, damage: number, source?: KillerInfo | null): void {
    const p = this.player;
    if (dist(x, y, p.x, p.y) <= radius + p.radius) this.damagePlayer(damage, false, source);
  }

  // -------------------------------------------------------------------------
  // 성장
  // -------------------------------------------------------------------------

  gainXp(amount: number): void {
    const p = this.player;
    p.xp += amount;
    while (p.xp >= p.xpToNext) {
      p.xp -= p.xpToNext;
      p.level++;
      p.xpToNext = LEVEL.xpToNext(p.level);
      this.onLevelUp();
    }
    this.stats.maxLevel = p.level;
  }

  private onLevelUp(): void {
    const p = this.player;

    // 스탯이 여러 개 오르므로 뜨는 글자도 겹치지 않게 한 줄씩 위로 쌓습니다.
    // 스탯 적용은 지금 하고, 보여주는 것만 알림 줄에 맡깁니다. 스킬 선택창이 뜨는
    // 레벨이면 창이 닫힌 뒤에 뜨고, 아니면 다음 프레임에 바로 뜹니다.
    const gains = rollStatGains(this);
    gains.forEach((gain, i) => {
      const before = p.stats.maxHp;
      addStat(p.stats, gain.key, gain.amount);
      this.track.statGains.add(gain.key);
      if (gain.key === 'maxHp') p.hp += p.stats.maxHp - before;
      this.queueNotice(`${gain.name} ${gain.text}`, '#4dd2ff', 17, i * LEVEL_NOTICE.gap, -46 - i * 20);
    });
    this.effects.burst(p.x, p.y, 20, '#4dd2ff', 190, 3, 0.6);

    if (isSkillLevel(p.level)) this.pendingSkillChoices++;
  }

  /**
   * 이번 판에서 실제로 벌어들인 코인.
   * 주운 개수에 난이도 보상 배율을 곱한 값입니다. 난이도 0 이면 주운 개수 그대로입니다.
   */
  earnedCoins(): number {
    return Math.round(this.stats.coins * this.diff.coinMul);
  }

  /** 시간 감속 스킬 적용 */
  applyTimeSlow(scale: number, duration: number): void {
    this.enemyTimeScale = clamp(scale, STATUS.minTimeScale, 1);
    this.timeSlowLeft = Math.max(this.timeSlowLeft, duration);
  }

  /** 화면 밖으로 나가지 않게 정리 */
  clampEnemy(e: Enemy): void {
    clampToArena(e, e.radius, 0);
  }
}

export function isSkillLevel(level: number): boolean {
  if ((LEVEL.skillLevels as readonly number[]).includes(level)) return true;
  const last = LEVEL.skillLevels[LEVEL.skillLevels.length - 1];
  if (level <= last) return false;
  return (level - last) % LEVEL.skillLevelStepAfter === 0;
}
