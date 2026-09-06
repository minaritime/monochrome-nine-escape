import { BESTIARY_TIERS, BESTIARY_TIERS_BOSS, DIFFICULTY } from '../data/balance';
import { isBossId } from '../enemies/boss';
import { unlockTimeFor } from './difficulty';
import { ownedSlots } from '../game/player';
import type { World } from '../game/world';
import type { SkillId } from '../skills/types';
import type { BestiaryEntry, SaveData } from './save';

export type BestiaryTier = 'unknown' | 'seen' | 'pattern' | 'numbers';

export function entryOf(save: SaveData, id: string): BestiaryEntry {
  return save.bestiary[id] ?? { seen: false, kills: 0 };
}

/** 그 항목의 해금 문턱. 보스는 절반입니다 */
export function tiersFor(id: string): { pattern: number; numbers: number } {
  return isBossId(id) ? BESTIARY_TIERS_BOSS : BESTIARY_TIERS;
}

/**
 * 처치 수에 따라 정보가 단계적으로 열립니다 (기획.md 8장).
 *
 * **개발자 모드 스위치가 켜져 있으면 전부 마지막 단계로 봅니다** (2026-09-06).
 * 적을 하나 고칠 때마다 50마리를 잡아 와야 수치 칸을 볼 수 있으면, 그 화면은
 * 사실상 확인할 수 없는 화면입니다.
 *
 * **저장은 안 건드립니다.** 기록을 실제로 채우면 껐을 때 원래 진행도가 사라집니다.
 * 그리고 `devMode` 를 같이 보므로 개발자 모드를 끄면 저절로 안 듣습니다.
 */
export function tierOf(save: SaveData, id: string): BestiaryTier {
  if (save.devMode && save.devBestiary) return 'numbers';
  const e = entryOf(save, id);
  if (!e.seen) return 'unknown';
  const t = tiersFor(id);
  if (e.kills >= t.numbers) return 'numbers';
  if (e.kills >= t.pattern) return 'pattern';
  return 'seen';
}

/** 판이 끝나면 도감과 기록, 코인을 저장 데이터에 반영합니다 */
export function commitRun(save: SaveData, w: World): void {
  for (const id of w.encountered) {
    const e = entryOf(save, id);
    save.bestiary[id] = { seen: true, kills: e.kills };
  }
  for (const [id, kills] of Object.entries(w.stats.killsByType)) {
    const e = entryOf(save, id);
    save.bestiary[id] = { seen: true, kills: e.kills + (kills ?? 0) };
  }

  save.coins += w.earnedCoins();

  const r = save.records;
  r.totalRuns++;
  r.totalKills += w.stats.kills;
  if (w.time > r.bestTime) {
    r.bestTime = w.time;
    r.bestBuild = ownedSlots(w.player).map((s) => s.id) as SkillId[];
  }
  if (w.stats.kills > r.bestKills) r.bestKills = w.stats.kills;
  if (w.player.level > r.bestLevel) r.bestLevel = w.player.level;

  const key = String(w.difficulty);
  if (w.time > (r.bestTimeByDifficulty[key] ?? 0)) r.bestTimeByDifficulty[key] = w.time;

  // 지금 난이도의 요구 시간을 채웠으면 다음 난이도가 열립니다.
  // -1 은 항상 고를 수 있으므로 해금 사슬은 0 에서 시작합니다.
  // 표는 15 에서 끝나므로 그 위로는 열리지 않습니다
  const next = Math.min(DIFFICULTY.max, w.difficulty + 1);
  if (w.time >= unlockTimeFor(w.difficulty) && save.maxDifficulty < next) {
    save.maxDifficulty = next;
  }
}
