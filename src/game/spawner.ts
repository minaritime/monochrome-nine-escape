import { BOSS, CANVAS, DIFFICULTY, ENEMY_TABLE, SPAWN, type EnemyId, type WaveSpec } from '../data/balance';
import { lerp, progress } from '../core/math';
import { rollElite } from '../enemies/elite';
import { ALL_ENEMY_IDS } from '../enemies/registry';
import type { World } from './world';

interface PendingSpawn {
  id: EnemyId;
  x: number;
  y: number;
  elite: boolean;
  delay: number;
}

/** 난도 곡선, 해금 판정, 동시 존재 상한 */
export class Spawner {
  timer = 1.2;
  bossTimer = BOSS.interval;
  pending: PendingSpawn[] = [];
  /** 디버그: 자동 스폰 정지 */
  enabled = true;
  /** 웨이브 타이머 (난이도 6 이상). 시작 시간 전에는 돌지 않습니다 */
  private waveTimer = 0;
  private bomberWaveTimer = 0;
  /**
   * 마지막 보스가 나온 뒤 흐른 시간.
   * bossTimer 는 보스가 상한까지 찼을 때 멈추므로 "방금 나왔는가"를 판단할 수 없습니다
   */
  private bossSpawnAge = Number.POSITIVE_INFINITY;

  update(w: World, dt: number): void {
    this.updateBoss(w, dt);
    this.updatePending(w, dt);
    if (!this.enabled) return;

    this.updateWave(w, dt);

    this.timer -= dt;
    if (this.timer > 0) return;

    this.timer = this.currentInterval(w) * (w.bossesAlive > 0 ? BOSS.spawnSlow : 1);

    if (this.atCap(w)) return;
    this.scheduleOne(w);
  }

  private atCap(w: World): boolean {
    // 무적 하수인은 상한에 안 셉니다 (`World.countedAlive` 주석 참고)
    return w.countedAlive() >= SPAWN.maxAlive + w.diff.maxAliveAdd;
  }

  /**
   * 난이도 6 이상의 스폰 웨이브.
   * 웨이브는 평소 스폰과 별개로 한 번에 여러 마리를 쏟아붓습니다.
   * 보스가 나오는 순간에 겹치면 그 회차만 건너뜁니다.
   */
  private updateWave(w: World, dt: number): void {
    this.waveTimer = this.tickWave(w, dt, this.waveTimer, w.diff.wave, null);
    this.bomberWaveTimer = this.tickWave(w, dt, this.bomberWaveTimer, w.diff.bomberWave, 'bomber');
  }

  /** 한 종류의 웨이브를 한 칸 굴립니다. 새 타이머 값을 돌려줍니다 */
  private tickWave(w: World, dt: number, timer: number, spec: WaveSpec | null, forceId: EnemyId | null): number {
    if (!spec || w.time < spec.startTime) return timer;

    // 시작 시간에 도달한 첫 프레임은 곧바로 한 번 냅니다
    const next = timer <= 0 ? 0 : timer - dt;
    if (next > 0) return next;

    if (!this.nearBossSpawn(w)) this.releaseWave(w, spec, forceId);
    return spec.interval;
  }

  /**
   * 보스가 나오는 "순간"인가. 등장 직전과 직후만 봅니다.
   * 보스전 내내가 아닙니다. 보스가 살아 있는 동안에도 웨이브는 평소대로 나옵니다
   */
  private nearBossSpawn(w: World): boolean {
    const window = DIFFICULTY.waveBossSkipWindow;
    // 곧 나온다 (아직 안 나온 상태에서 카운트다운이 얼마 안 남음)
    if (w.bossesAlive < BOSS.maxAlive && this.bossTimer <= window) return true;
    // 방금 나왔다
    return this.bossSpawnAge <= window;
  }

  private releaseWave(w: World, spec: WaveSpec, forceId: EnemyId | null): void {
    const ids = forceId ? [forceId] : this.unlockedIds(w);
    if (ids.length === 0) return;

    const room = SPAWN.maxAlive + w.diff.maxAliveAdd - w.countedAlive();
    const count = Math.min(spec.count, Math.max(0, room));
    for (let i = 0; i < count; i++) {
      const id = forceId ?? w.rng.pick(ids);
      const pos = randomEdge(w);
      const elite = rollElite(w);
      w.addTelegraph({
        kind: 'spawn',
        x: pos.x,
        y: pos.y,
        radius: 15,
        life: SPAWN.warning,
        color: elite ? '#ffb400' : '#ff5d5d',
      });
      this.pending.push({ id, x: pos.x, y: pos.y, elite, delay: SPAWN.warning });
    }
  }

  private updateBoss(w: World, dt: number): void {
    if (!this.enabled) return;
    if (this.bossSpawnAge < Number.POSITIVE_INFINITY) this.bossSpawnAge += dt;
    // 상한까지 찼을 때만 카운트다운을 멈춥니다.
    // 예전에는 한 마리라도 살아 있으면 멈춰서, 못 잡으면 보스가 영영 안 나왔습니다.
    // 지금은 못 잡으면 다음 보스가 그 위에 겹칩니다
    if (w.bossesAlive >= BOSS.maxAlive) return;
    this.bossTimer -= dt;
    if (this.bossTimer <= 0) {
      this.bossTimer = BOSS.interval;
      this.bossSpawnAge = 0;
      w.spawnBoss();
    }
  }

  private updatePending(w: World, dt: number): void {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      p.delay -= dt;
      if (p.delay <= 0) {
        w.spawnEnemy(p.id, p.x, p.y, { elite: p.elite });
        this.pending.splice(i, 1);
      }
    }
  }

  /** 초당 스폰 수. 난이도의 스폰율 배율이 곱해집니다 */
  currentRate(w: World): number {
    const base = lerp(SPAWN.rateStart, SPAWN.rateMax, progress(w.time, 0, SPAWN.rateRampTime));
    return base * w.diff.spawnRateMul;
  }

  currentInterval(w: World): number {
    return 1 / this.currentRate(w);
  }

  /** 지금 나올 수 있는 적 종류. 해금은 "시간 OR 스킬 수" 입니다 */
  unlockedIds(w: World): EnemyId[] {
    const out: EnemyId[] = [];
    for (const id of ALL_ENEMY_IDS) {
      const bal = ENEMY_TABLE[id];
      const byTime = w.time >= bal.unlockTime;
      const bySkill = bal.unlockSkills > 0 && w.skillsTaken >= bal.unlockSkills;
      if (!byTime && !bySkill) continue;
      if (bal.maxAlive !== undefined && this.countAlive(w, id) >= bal.maxAlive) continue;
      out.push(id);
    }
    return out;
  }

  private countAlive(w: World, id: EnemyId): number {
    let n = 0;
    for (const e of w.enemies) {
      // 불려나온 하수인은 그 종류의 상한에도 안 셉니다. 세면 소환적이 부른 탱커 때문에
      // 탱커가 안 나오는 식으로, 소환적이 다른 적의 등장을 막게 됩니다
      if (!e.dead && e.defId === id && e.ownerId === 0) n++;
    }
    return n;
  }

  private scheduleOne(w: World): void {
    const ids = this.unlockedIds(w);
    if (ids.length === 0) return;

    // 후반으로 갈수록 위험한 적(해금이 늦은 적)의 비중을 올립니다.
    // 동시 존재 상한에 걸린 뒤로는 스폰이 드물어지므로, 늦게 나오는 적이 실제로
    // 등장하려면 초반 적의 가중치를 같이 낮춰야 합니다 (기획.md 7장의 "질로 전환").
    const lateBias = progress(w.time, 120, 660);
    const weights = ids.map((id) => {
      const bal = ENEMY_TABLE[id];
      const lateness = Math.min(bal.unlockTime / 660, 1);
      const up = 1 + lateness * lateBias * 2.6;
      const down = 1 - (1 - lateness) * lateBias * 0.75;
      return bal.weight * up * down;
    });

    const id = w.rng.weighted(ids, weights);
    const pos = randomEdge(w);
    const elite = rollElite(w);

    w.addTelegraph({
      kind: 'spawn',
      x: pos.x,
      y: pos.y,
      radius: 15,
      life: SPAWN.warning,
      color: elite ? '#ffb400' : '#ff5d5d',
    });
    this.pending.push({ id, x: pos.x, y: pos.y, elite, delay: SPAWN.warning });
  }

  /** 디버그용 즉시 소환 */
  spawnNow(w: World, id: EnemyId, elite = false): void {
    const pos = randomEdge(w);
    w.spawnEnemy(id, pos.x, pos.y, { elite });
  }
}

function randomEdge(w: World): { x: number; y: number } {
  const inset = SPAWN.edgeInset;
  const side = w.rng.int(0, 4);
  switch (side) {
    case 0:
      return { x: w.rng.range(inset, CANVAS.w - inset), y: inset };
    case 1:
      return { x: CANVAS.w - inset, y: w.rng.range(inset, CANVAS.h - inset) };
    case 2:
      return { x: w.rng.range(inset, CANVAS.w - inset), y: CANVAS.h - inset };
    default:
      return { x: inset, y: w.rng.range(inset, CANVAS.h - inset) };
  }
}
