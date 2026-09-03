/**
 * 생존 한계 측정.
 * 회피에만 집중하는 봇을 여러 시드로 돌려 몇 분까지 버티는지 봅니다.
 * "무한히 버틸 수 있는가"를 판단하는 것이 목적입니다.
 *
 *   npx esbuild scripts/survival.ts --bundle --format=esm --platform=node --outfile=.survival.mjs
 *   node .survival.mjs [최대분] [시드개수]
 */
import { DIFFICULTY, FIXED_DT } from '../src/data/balance';
import type { Input } from '../src/core/input';
import { World } from '../src/game/world';
import { ownedSlots } from '../src/game/player';
import { applySkillChoice, generateSkillChoices } from '../src/progression/skillChoice';
import {
  BRANCH_MODE_LABEL,
  BotInput,
  TIER_LABEL,
  decideMove,
  drainBranches,
  pickChoice,
  saveFor,
  setBranchMode,
  useSkills,
  type BranchMode,
  type ShopTier,
} from './bot';

function runOnce(
  seed: number,
  maxMinutes: number,
  tier: ShopTier,
  difficulty = 0,
): { time: number; level: number; kills: number; enemies: number; bossKills: number; coins: number } {
  const input = new BotInput();
  const w = new World(saveFor(tier), input as unknown as Input, seed, difficulty);
  const maxSteps = Math.round(maxMinutes * 60 / FIXED_DT);

  for (let i = 0; i < maxSteps; i++) {
    input.dir = decideMove(w);
    useSkills(w, ownedSlots(w.player));

    w.update(FIXED_DT);

    while (w.pendingSkillChoices > 0) {
      w.pendingSkillChoices--;
      const choices = generateSkillChoices(w);
      if (choices.length === 0) break;
      applySkillChoice(w, pickChoice(w, choices));
    }
    // 갈래 큐를 안 비우면 무한히 쌓이고, 그 측정은 "분기가 없는 게임"을 잰 값이 됩니다.
    // 오류가 안 나므로 눈치채기 어렵습니다
    drainBranches(w);

    if (w.gameOver) break;
  }

  return {
    time: w.time,
    level: w.player.level,
    kills: w.stats.kills,
    enemies: w.enemies.length,
    bossKills: w.stats.bossKills,
    coins: w.earnedCoins(),
  };
}

const maxMinutes = Number(process.argv[2] ?? 25);
const seedCount = Number(process.argv[3] ?? 5);
/**
 * 세 번째 인자로 무엇을 잴지 고릅니다.
 *   npm run survival -- 12 3 sweep        전 난이도(-1~15) 를 상점 전부 구매로 한 번씩
 *   npm run survival -- 12 3 tiers 8,9    난이도 8·9 를 상점 3단계(없음/절반/전부)로
 *   npm run survival -- 12 3 5            난이도 5 만
 * 없으면 예전처럼 난이도 0 으로 상점 없음 / 전부 구매 두 줄을 냅니다.
 */
const mode = process.argv[4];

if (mode === 'branch') {
  // 6레벨 갈래를 조건별로 재는 모드.
  //   npm run survival -- 20 6 branch
  //   npm run survival -- 20 6 branch 0:none,15:full
  // 갈래 없음(대조군) · 강화 · 특수 세 가지를 같은 시드로 돌려 견줍니다
  const specs = (process.argv[5] ?? '0:none,15:full').split(',').map((s) => {
    const [lv, tier] = s.split(':');
    return { lv: Number(lv), tier: tier as ShopTier };
  });

  console.log(`\n6레벨 갈래별 · 최대 ${maxMinutes}분 · 시드 ${seedCount}개`);
  for (const spec of specs) {
    console.log(`\n[난이도 ${spec.lv} · ${TIER_LABEL[spec.tier]}]`);
    console.log('  갈래        | 최소 생존 | 중앙 | 평균 | 최대 | 완주 | Lv | 처치 | 보스 | 코인');
    for (const bm of ['none', 'enhance', 'special'] as BranchMode[]) {
      setBranchMode(bm);
      const rs = [];
      for (let i = 0; i < seedCount; i++) rs.push(runOnce(1000 + i * 7919, maxMinutes, spec.tier, spec.lv));
      const times = rs.map((r) => r.time).sort((a, b) => a - b);
      const avg = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
      const done = times.filter((t) => t >= maxMinutes * 60 - 1).length;
      console.log(
        `  ${BRANCH_MODE_LABEL[bm].padEnd(11)} | ${fmt(times[0]).padStart(9)}` +
          ` | ${fmt(times[Math.floor(times.length / 2)])} | ${fmt(avg(times))} | ${fmt(times[times.length - 1])}` +
          ` | ${done}/${seedCount} | ${avg(rs.map((r) => r.level)).toFixed(0).padStart(2)}` +
          ` | ${avg(rs.map((r) => r.kills)).toFixed(0).padStart(5)} | ${avg(rs.map((r) => r.bossKills)).toFixed(1)}` +
          ` | ${avg(rs.map((r) => r.coins)).toFixed(0)}`,
      );
    }
  }
  setBranchMode('enhance');
} else if (mode === 'tiers') {
  // 상점 단계별로 나눠 재는 모드. 어느 구간에서 벽에 부딪히는지를 봅니다
  const levels = (process.argv[5] ?? '8,9').split(',').map(Number);
  console.log(`\n상점 단계별 · 최대 ${maxMinutes}분 · 시드 ${seedCount}개`);
  console.log('  난이도 | 상점      | 최소 생존 | 중앙 | 평균 | 최대 | 완주 | Lv | 처치 | 보스 | 코인');
  for (const lv of levels) {
    for (const tier of ['none', 'half', 'full'] as ShopTier[]) {
      const rs = [];
      for (let i = 0; i < seedCount; i++) rs.push(runOnce(1000 + i * 7919, maxMinutes, tier, lv));
      const times = rs.map((r) => r.time).sort((a, b) => a - b);
      const avg = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
      const done = times.filter((t) => t >= maxMinutes * 60 - 1).length;
      console.log(
        `  ${String(lv).padStart(6)} | ${TIER_LABEL[tier].padEnd(9)} | ${fmt(times[0]).padStart(9)}` +
          ` | ${fmt(times[Math.floor(times.length / 2)])} | ${fmt(avg(times))} | ${fmt(times[times.length - 1])}` +
          ` | ${done}/${seedCount} | ${avg(rs.map((r) => r.level)).toFixed(0).padStart(2)}` +
          ` | ${avg(rs.map((r) => r.kills)).toFixed(0).padStart(4)} | ${avg(rs.map((r) => r.bossKills)).toFixed(1)}` +
          ` | ${avg(rs.map((r) => r.coins)).toFixed(0)}`,
      );
    }
  }
} else if (mode === 'sweep') {
  console.log(`\n난이도 훑기 · 상점 전부 구매 · 최대 ${maxMinutes}분 · 시드 ${seedCount}개`);
  console.log('  난이도 | 중앙 생존 | 평균 | 최대 | Lv | 처치 | 보스 | 코인');
  for (let lv = DIFFICULTY.min; lv <= DIFFICULTY.max; lv++) {
    const rs = [];
    for (let i = 0; i < seedCount; i++) rs.push(runOnce(1000 + i * 7919, maxMinutes, 'full', lv));
    const times = rs.map((r) => r.time).sort((a, b) => a - b);
    const avg = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
    console.log(
      `  ${String(lv).padStart(6)} | ${fmt(times[Math.floor(times.length / 2)]).padStart(9)} | ${fmt(avg(times))}` +
        ` | ${fmt(times[times.length - 1])} | ${avg(rs.map((r) => r.level)).toFixed(0)}` +
        ` | ${avg(rs.map((r) => r.kills)).toFixed(0)} | ${avg(rs.map((r) => r.bossKills)).toFixed(1)}` +
        ` | ${avg(rs.map((r) => r.coins)).toFixed(0)}`,
    );
  }
} else {
  const only = mode === undefined ? null : Number(mode);
  for (const tier of (only === null ? ['none', 'full'] : ['full']) as ShopTier[]) {
    const lv = only ?? 0;
    console.log(
      `\n회피 우선 봇 · ${TIER_LABEL[tier]} · 난이도 ${lv} · 최대 ${maxMinutes}분 · 시드 ${seedCount}개`,
    );

    const results: number[] = [];
    for (let i = 0; i < seedCount; i++) {
      const seed = 1000 + i * 7919;
      const r = runOnce(seed, maxMinutes, tier, lv);
      results.push(r.time);
      const survived = r.time >= maxMinutes * 60 - 1;
      console.log(
        `  시드 ${String(seed).padStart(6)} · ${fmt(r.time)} ${survived ? '(제한 도달, 생존 중)' : '사망'}` +
          ` · Lv.${r.level} · 처치 ${r.kills} · 보스 ${r.bossKills} · 남은 적 ${r.enemies}`,
      );
    }

    results.sort((a, b) => a - b);
    const avg = results.reduce((s, v) => s + v, 0) / results.length;
    const survivors = results.filter((t) => t >= maxMinutes * 60 - 1).length;
    console.log(
      `  → 최소 ${fmt(results[0])} · 중앙 ${fmt(results[Math.floor(results.length / 2)])} · 평균 ${fmt(avg)} · 최대 ${fmt(results[results.length - 1])} · 제한 도달 ${survivors}/${results.length}`,
    );
  }
}

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}분 ${String(s).padStart(2, '0')}초`;
}
