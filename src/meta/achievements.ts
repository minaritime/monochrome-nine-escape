import { ACHIEVEMENT } from '../data/balance';
import { ACHIEVEMENTS, tierName, type AchieveCtx, type AchieveDef } from '../data/achievements';
import { emptyAchieveStats, saveGame, type SaveData } from './save';
import type { World } from '../game/world';

/** 방금 달성된 것 하나. 알림이 이 모양으로 화면에 뜹니다 */
export interface AchieveUnlock {
  id: string;
  name: string;
  desc: string;
  /** 단계형이면 "3단계" 처럼 붙습니다 */
  tierLabel: string;
  coin: number;
}

/** 그 업적으로 지금까지 받은 단계 수 */
export function tierOf(save: SaveData, id: string): number {
  return save.achievements[id] ?? 0;
}

export function isUnlocked(save: SaveData, id: string): boolean {
  return tierOf(save, id) > 0;
}

/** 단계형이면 다 채웠는가, 단발형이면 받았는가 */
export function isComplete(save: SaveData, def: AchieveDef): boolean {
  return tierOf(save, def.id) >= def.tiers.length;
}

function coinFor(def: AchieveDef, tierIndex: number): number {
  return Math.round((def.tiers[tierIndex]?.coin ?? 0) * ACHIEVEMENT.coinMul);
}

/**
 * 지금 상태로 새로 달성된 것을 전부 찾아 저장에 반영하고, 알림 목록을 돌려줍니다.
 *
 * **코인은 여기서 즉시 지급하고 즉시 저장합니다.** 판이 끝날 때 몰아주면
 * 중간에 그만둔 판의 업적이 사라집니다. 업적은 판의 성과가 아니라 계정의 성과입니다.
 *
 * 단계형은 한 번에 여러 단계가 열릴 수 있습니다 (누적 처치가 한꺼번에 넘는 경우).
 * 그때는 넘은 단계의 코인을 전부 주고 알림은 마지막 단계 하나만 띄웁니다.
 */
export function checkAchievements(save: SaveData, w: World | null, runEnded = false): AchieveUnlock[] {
  const ctx: AchieveCtx = { save, w, runEnded };
  const out: AchieveUnlock[] = [];
  let dirty = false;

  for (const def of ACHIEVEMENTS) {
    const have = tierOf(save, def.id);
    if (have >= def.tiers.length) continue;

    const target = reachedTier(def, ctx);
    if (target <= have) continue;

    let coin = 0;
    for (let i = have; i < target; i++) coin += coinFor(def, i);

    save.achievements[def.id] = target;
    save.coins += coin;
    dirty = true;

    out.push({
      id: def.id,
      // 방금 딴 단계의 이름입니다. `def.name` 을 그대로 쓰면 부자 → 집주인 → 땅주인
      // 처럼 단계마다 이름이 다른 업적에서 화면과 알림이 서로 다른 말을 합니다
      name: tierName(def, target - 1),
      desc: def.desc,
      tierLabel: def.tiers.length > 1 ? `${target}/${def.tiers.length}단계` : '',
      coin,
    });
  }

  if (dirty) saveGame(save);
  return out;
}

/** 지금 조건으로 도달한 단계 수 */
function reachedTier(def: AchieveDef, ctx: AchieveCtx): number {
  if (def.progress) {
    const value = def.progress(ctx);
    let n = 0;
    for (const t of def.tiers) {
      if (value >= (t.goal ?? 0)) n++;
      else break;
    }
    return n;
  }
  // 조건식이 없는 업적(코나미 코드처럼 밖에서 직접 여는 것)은 스스로 열리지 않습니다
  if (!def.check) return 0;
  try {
    return def.check(ctx) ? 1 : 0;
  } catch {
    // 업적 하나가 터져서 게임이 멈추는 것이 가장 나쁩니다
    return 0;
  }
}

/**
 * 조건식 없이 밖에서 직접 여는 업적 (코나미 코드처럼 게임 상태로 표현되지 않는 것).
 * 이미 열려 있으면 아무 일도 안 하고 빈 배열을 돌려줍니다.
 */
export function unlockDirect(save: SaveData, id: string): AchieveUnlock[] {
  const def = ACHIEVEMENTS.find((a) => a.id === id);
  if (!def || tierOf(save, id) > 0) return [];

  const coin = coinFor(def, 0);
  save.achievements[id] = 1;
  save.coins += coin;
  saveGame(save);
  return [{ id, name: tierName(def, 0), desc: def.desc, tierLabel: '', coin }];
}

/**
 * **테스트용.** 업적과 업적 전용 누적값만 지웁니다 (설정 화면).
 *
 * 코인은 되돌리지 않습니다. 이미 쓴 코인까지 추적해야 하는데 그 장부가 없고,
 * 어차피 밸런스를 다 보고 나면 이 통로째로 지울 것이라 그만큼 정확할 이유가 없습니다.
 * **기록으로 판정되는 업적(난이도 클리어·누적 처치)은 다음 판정에서 곧바로 다시
 * 열리면서 코인이 또 들어옵니다.** 알림을 다시 보려고 만든 버튼이라 그게 맞습니다.
 */
export function resetAchievements(save: SaveData): void {
  save.achievements = {};
  save.achieveStats = emptyAchieveStats();
  saveGame(save);
}

/** 판이 끝났을 때 누적값을 저장에 옮깁니다. `commitRun` 뒤에 부릅니다 */
export function commitAchieveStats(save: SaveData, w: World): void {
  const s = save.achieveStats;
  s.playTime += w.time;
  s.coinsEarned += w.earnedCoins();
  s.eliteKills += w.track.eliteKills;
  s.shardKills += w.shardKills;

  // 사인 수집가: 나를 죽인 적의 종류를 모읍니다. 보스는 세지 않습니다
  const killer = w.killedBy;
  if (killer && !s.deathCauses.includes(killer.id)) s.deathCauses.push(killer.id);
}

/**
 * 화면에 보일 업적 목록.
 *
 * 사슬(`AchieveDef.chain`)로 묶인 것은 **깬 것 전부 + 다음 한 칸**만 남깁니다.
 * 하나를 깨면 그 자리에 다음 칸이 새로 나타납니다. 목록의 길이가 곧 진행도가
 * 되므로, 아직 못 깬 뒤쪽이 화면을 채우지 않습니다.
 *
 * 진행도 숫자(`achieveProgress`)는 여기서 가린 것까지 전부 셉니다. 보이는 줄 수를
 * 분모로 삼으면 사슬을 깰 때마다 분모가 같이 늘어서 진행도가 안 움직입니다.
 */
export function visibleAchievements(save: SaveData): AchieveDef[] {
  const chainShown = new Set<string>();
  const out: AchieveDef[] = [];

  for (const def of ACHIEVEMENTS) {
    if (!def.chain || isComplete(save, def)) {
      out.push(def);
      continue;
    }
    if (chainShown.has(def.chain)) continue;
    chainShown.add(def.chain);
    out.push(def);
  }
  return out;
}

/** 전체 진행도 (업적 화면 머리말) */
export function achieveProgress(save: SaveData): { done: number; total: number } {
  let done = 0;
  for (const def of ACHIEVEMENTS) {
    if (isComplete(save, def)) done++;
  }
  return { done, total: ACHIEVEMENTS.length };
}
