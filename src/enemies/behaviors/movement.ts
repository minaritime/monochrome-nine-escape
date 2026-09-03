import { angleTo } from '../../core/math';
import type { Enemy } from '../../game/types';
import type { World } from '../../game/world';

/** 목표 지점을 향해 이동 속도를 설정합니다 */
export function moveToward(e: Enemy, tx: number, ty: number, speedMul = 1): void {
  const a = angleTo(e.x, e.y, tx, ty);
  e.vx = Math.cos(a) * e.speed * speedMul;
  e.vy = Math.sin(a) * e.speed * speedMul;
  e.facing = a;
}

/** 목표 지점에서 멀어지는 방향 */
export function moveAway(e: Enemy, tx: number, ty: number, speedMul = 1): void {
  const a = angleTo(tx, ty, e.x, e.y);
  e.vx = Math.cos(a) * e.speed * speedMul;
  e.vy = Math.sin(a) * e.speed * speedMul;
  e.facing = a;
}

export function stopMoving(e: Enemy): void {
  e.vx = 0;
  e.vy = 0;
}

/**
 * 일정 시간마다 방향을 새로 뽑아 배회합니다.
 * state.timer 와 state.angle 을 사용합니다.
 */
export function wander(e: Enemy, w: World, dt: number, changeInterval: number, speedMul = 1): void {
  e.state.timer -= dt;
  if (e.state.timer <= 0) {
    e.state.timer = changeInterval * w.rng.range(0.7, 1.3);
    e.state.angle = w.rng.angle();
  }
  e.vx = Math.cos(e.state.angle) * e.speed * speedMul;
  e.vy = Math.sin(e.state.angle) * e.speed * speedMul;
  e.facing = e.state.angle;
}

/** 화면 밖으로 계속 밀지 않도록, 벽 근처면 안쪽으로 방향을 돌립니다 */
export function avoidWalls(e: Enemy, width: number, height: number, margin = 50): void {
  if (e.x < margin && e.vx < 0) e.vx = Math.abs(e.vx);
  if (e.x > width - margin && e.vx > 0) e.vx = -Math.abs(e.vx);
  if (e.y < margin && e.vy < 0) e.vy = Math.abs(e.vy);
  if (e.y > height - margin && e.vy > 0) e.vy = -Math.abs(e.vy);
  e.state.angle = Math.atan2(e.vy, e.vx);
}
