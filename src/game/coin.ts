import { CANVAS, COIN } from '../data/balance';
import { angleTo, dist } from '../core/math';
import type { Coin } from './types';
import type { World } from './world';

/**
 * 코인 이동과 획득.
 * 획득 범위에 한 번 들어오면 매 프레임 플레이어를 정확히 향해 날아옵니다.
 * 속도 벡터에 가속을 더하는 방식은 관성 때문에 플레이어를 지나쳐 공전하게 됩니다.
 */
export function updateCoins(w: World, dt: number): void {
  const p = w.player;

  for (const c of w.coins) {
    if (c.dead) continue;

    if (COIN.lifetime > 0) {
      c.life -= dt;
      if (c.life <= 0) {
        c.dead = true;
        continue;
      }
    }

    const d = dist(c.x, c.y, p.x, p.y);

    if (!c.magnet && d <= p.stats.pickupRange) {
      c.magnet = true;
      c.speed = Math.max(COIN.magnetStartSpeed, Math.hypot(c.vx, c.vy));
      c.vx = 0;
      c.vy = 0;
    }

    if (c.magnet) {
      c.speed = Math.min(COIN.magnetMaxSpeed, c.speed + COIN.magnetAccel * dt);
      const step = c.speed * dt;
      if (step >= d) {
        // 이번 스텝에 도달합니다. 지나쳐서 뒤로 넘어가지 않게 딱 붙입니다
        c.x = p.x;
        c.y = p.y;
      } else {
        const a = angleTo(c.x, c.y, p.x, p.y);
        c.x += Math.cos(a) * step;
        c.y += Math.sin(a) * step;
      }
    } else {
      // 떨어진 직후 살짝 튀는 구간
      const decay = Math.max(0, 1 - 3 * dt);
      c.vx *= decay;
      c.vy *= decay;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      bounceOffWalls(c);
    }

    if (dist(c.x, c.y, p.x, p.y) <= p.radius + COIN.radius) {
      c.dead = true;
      w.stats.coins += c.value;
      w.effects.burst(c.x, c.y, 4, '#ffcc4d', 90, 2, 0.25);
    }
  }
}

/**
 * 코인을 경기장 안에 가둡니다.
 *
 * 떨어질 때 무작위 방향으로 튀는데, 가장자리에서 죽은 적의 코인은 그대로 밖으로
 * 나가버려 영영 못 줍는 자리에 남았습니다. 벽에서 튕겨 돌려보냅니다.
 */
function bounceOffWalls(c: Coin): void {
  const r = COIN.radius;
  if (c.x < r) {
    c.x = r;
    c.vx = Math.abs(c.vx) * COIN.wallBounce;
  } else if (c.x > CANVAS.w - r) {
    c.x = CANVAS.w - r;
    c.vx = -Math.abs(c.vx) * COIN.wallBounce;
  }
  if (c.y < r) {
    c.y = r;
    c.vy = Math.abs(c.vy) * COIN.wallBounce;
  } else if (c.y > CANVAS.h - r) {
    c.y = CANVAS.h - r;
    c.vy = -Math.abs(c.vy) * COIN.wallBounce;
  }
}
