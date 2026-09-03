/**
 * 레벨 곡선과 난도 곡선 측정.
 *
 * "30분 판을 완주하면 몇 레벨인가", "판당 스킬 선택이 몇 번 오는가",
 * "시간이 갈수록 적이 얼마나 세지는가"를 봅니다.
 *
 * 봇은 `scripts/bot.ts` 것을 그대로 쓰되 **죽지 않게** 매 스텝 체력을 되돌립니다.
 * 죽는 시점을 재는 것이 아니라 경험치가 쌓이는 속도를 보는 것이 목적이라,
 * 생존 실력이 결과에 섞이면 안 됩니다.
 *
 *   npm run levelcurve -- [분] [시드개수] [난이도]
 */
import { FIXED_DT, LEVEL, SPAWN } from '../src/data/balance';
import type { Input } from '../src/core/input';
import { World, isSkillLevel } from '../src/game/world';
import { ownedSlots } from '../src/game/player';
import { applySkillChoice, generateSkillChoices } from '../src/progression/skillChoice';
import { BotInput, TIER_LABEL, decideMove, drainBranches, pickChoice, saveFor, useSkills, type ShopTier } from './bot';

interface Sample {
  /** 분 단위 레벨 기록 (index 0 = 1분) */
  levelAt: number[];
  /** 적 체력 배율 (시간 경과 강화 + 난이도 배율) */
  hpMulAt: number[];
  /** 플레이어 공격력 스탯 */
  attackAt: number[];
  /** 화면에 살아 있는 적 수. 상한(80)에 붙으면 처치가 스폰을 못 따라간다는 뜻입니다 */
  aliveAt: number[];
  /** 그 1분 동안 잡은 수 */
  killsPerMinAt: number[];
  choices: number;
  kills: number;
}

function runOnce(seed: number, minutes: number, tier: ShopTier, difficulty: number): Sample {
  const input = new BotInput();
  const w = new World(saveFor(tier), input as unknown as Input, seed, difficulty);
  const maxSteps = Math.round((minutes * 60) / FIXED_DT);
  const levelAt: number[] = [];
  const hpMulAt: number[] = [];
  const attackAt: number[] = [];
  const aliveAt: number[] = [];
  const killsPerMinAt: number[] = [];
  let choices = 0;
  let nextMark = 60;
  let killsAtLastMark = 0;

  const mark = () => {
    levelAt.push(w.player.level);
    hpMulAt.push(w.timeScale().hp);
    attackAt.push(w.player.stats.attack);
    aliveAt.push(w.enemies.filter((e) => !e.dead).length);
    killsPerMinAt.push(w.stats.kills - killsAtLastMark);
    killsAtLastMark = w.stats.kills;
  };

  for (let i = 0; i < maxSteps; i++) {
    input.dir = decideMove(w);
    useSkills(w, ownedSlots(w.player));

    w.update(FIXED_DT);

    // 죽지 않게 되돌립니다. 생존 실력이 아니라 경험치 곡선을 보는 것이 목적입니다
    w.player.hp = w.player.stats.maxHp;
    w.player.alive = true;
    w.gameOver = false;

    while (w.pendingSkillChoices > 0) {
      w.pendingSkillChoices--;
      choices++;
      const list = generateSkillChoices(w);
      if (list.length === 0) break;
      applySkillChoice(w, pickChoice(w, list));
    }
    drainBranches(w);

    if (w.time >= nextMark) {
      mark();
      nextMark += 60;
    }
  }

  while (levelAt.length < minutes) mark();
  return { levelAt, hpMulAt, attackAt, aliveAt, killsPerMinAt, choices, kills: w.stats.kills };
}

const minutes = Number(process.argv[2] ?? 30);
const seedCount = Number(process.argv[3] ?? 3);
const difficulty = Number(process.argv[4] ?? 0);

console.log(`\n레벨 곡선 · 무적 봇 · ${minutes}분 · 시드 ${seedCount}개 · 난이도 ${difficulty}`);

const marks = [1, 3, 5, 10, 15, 20, 25, 30].filter((m) => m <= minutes);
const avg = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;

for (const tier of ['none', 'full'] as ShopTier[]) {
  const runs: Sample[] = [];
  for (let i = 0; i < seedCount; i++) runs.push(runOnce(1000 + i * 7919, minutes, tier, difficulty));

  const col = (pick: (r: Sample) => number[], fmt: (v: number) => string) =>
    marks.map((m) => fmt(avg(runs.map((r) => pick(r)[m - 1]))).padStart(7)).join('');

  console.log(`\n[${TIER_LABEL[tier]}]  처치 평균 ${avg(runs.map((r) => r.kills)).toFixed(0)}`);
  console.log(`  시각 ${marks.map((m) => `${m}분`.padStart(7)).join('')}`);
  console.log(`  레벨 ${col((r) => r.levelAt, (v) => v.toFixed(0))}`);
  console.log(`  공격력${col((r) => r.attackAt, (v) => v.toFixed(0))}`);
  // 적 체력 배율은 시드와 무관하지만, 공격력과 나란히 놓아야 격차가 읽힙니다
  console.log(`  적HP ${col((r) => r.hpMulAt, (v) => `x${v.toFixed(2)}`)}`);
  console.log(`  화면적${col((r) => r.aliveAt, (v) => v.toFixed(0))}`);
  console.log(`  분당처치${col((r) => r.killsPerMinAt, (v) => v.toFixed(0))}`);

  // 상대 난도: 적 체력 배율을 내 공격력 성장으로 나눈 값. 1 에서 시작해
  // 오를수록 "적이 나보다 빨리 세지고 있다"는 뜻입니다. 곡선이 어디서 꺾이는지를 봅니다
  const a0 = avg(runs.map((r) => r.attackAt[0]));
  const h0 = avg(runs.map((r) => r.hpMulAt[0]));
  console.log(
    `  상대난도${marks
      .map((m) => {
        const a = avg(runs.map((r) => r.attackAt[m - 1]));
        const h = avg(runs.map((r) => r.hpMulAt[m - 1]));
        return `x${(h / h0 / (a / a0)).toFixed(2)}`.padStart(7);
      })
      .join('')}`,
  );

  const finalLv = Math.round(avg(runs.map((r) => r.levelAt[minutes - 1])));
  console.log(`  → ${minutes}분 도달 Lv.${finalLv} · 스킬 선택 ${avg(runs.map((r) => r.choices)).toFixed(1)}회`);

  let cur = 0;
  for (let l = 2; l <= finalLv; l++) if (isSkillLevel(l)) cur++;
  console.log(`     Lv.${finalLv} 기준 · 현재 규칙 ${cur}회 · 4레벨마다 ${Math.floor(finalLv / 4)}회 · 6레벨마다 ${Math.floor(finalLv / 6)}회`);
}

console.log(`\n(참고) 스킬 선택 레벨: ${LEVEL.skillLevels.join(', ')} 이후 ${LEVEL.skillLevelStepAfter}레벨마다`);
console.log(`(참고) 스폰율 ${SPAWN.rateStart}/초 → ${SPAWN.rateMax}/초 (${SPAWN.rateRampTime / 60}분에 최대) · 동시 상한 ${SPAWN.maxAlive}\n`);
