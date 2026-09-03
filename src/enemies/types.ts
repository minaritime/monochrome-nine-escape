import type { BossId, EnemyId } from '../data/balance';
import type { Enemy } from '../game/types';
import type { World } from '../game/world';

export type EnemyBehavior = (e: Enemy, w: World, dt: number) => void;

export interface EnemyDef {
  id: EnemyId | BossId;
  name: string;
  /** 몸체 색 */
  color: string;
  /** 외곽선 / 포인트 색 */
  accent: string;
  /** 0 이면 원, 3 이상이면 정다각형 */
  sides: number;
  /** 진행 방향으로 회전해서 그릴지 */
  faceMove: boolean;
  /** 도감 2단계에 열리는 이동 패턴 설명 */
  pattern: string;
  init?: (e: Enemy, w: World) => void;
  behavior: EnemyBehavior;
  onDeath?: (e: Enemy, w: World) => void;
  /**
   * 체력이 0 이 된 순간. **true 를 돌려주면 죽지 않습니다** (미라의 부활).
   *
   * `damageEnemy` 에서만 불립니다. 파편이나 보스의 포식처럼 `killEnemy` 를 직접
   * 부르는 길은 그대로 진짜 죽음입니다.
   */
  onLethal?: (e: Enemy, w: World) => boolean;
  onDamaged?: (e: Enemy, w: World, amount: number) => void;
  /** 방패 내구도를 가지는가 (방패적) */
  hasShield?: boolean;
  /** true 를 돌려주면 방패가 그 피해를 대신 받습니다 (정면 판정) */
  blocks?: (e: Enemy, fromX: number, fromY: number) => boolean;
  /** 직접 그리는 추가 표현이 필요할 때 */
  extraDraw?:
    | 'ranged'
    | 'coward'
    | 'bomber'
    | 'splitter'
    | 'charger'
    | 'puddle'
    | 'shield'
    | 'summoner'
    | 'mummy'
    | 'stealth'
    | 'boss';
}
