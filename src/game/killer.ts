import type { Enemy, KillerInfo } from './types';

/**
 * 적을 게임오버 화면에 띄울 사인 정보로 바꿉니다.
 *
 * world.ts 가 아니라 이 파일에 두는 이유가 있습니다.
 * 적 행동 파일(enemies/*)이 world.ts 에서 값을 가져오면 순환 참조가 생깁니다.
 * world.ts → registry → boss/behaviors → world.ts 순으로 물려서, 적 정의표가
 * 아직 채워지기 전에 읽히고 behavior 가 undefined 가 됩니다.
 * 타입만 가져오는 이 파일은 어디서 불러도 안전합니다.
 */
export function killerOf(e: Enemy): KillerInfo {
  return { id: e.defId, elite: e.elite };
}
