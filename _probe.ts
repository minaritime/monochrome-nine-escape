import { FIXED_DT } from './src/data/balance';
import { Input } from './src/core/input';
import { World } from './src/game/world';
import { emptySave } from './src/meta/save';
const input = new Input({ addEventListener: () => {} } as unknown as Window);
const w = new World(emptySave(), input, 909, 0);
for (let i = 0; i < 120; i++) w.update(FIXED_DT);
console.log('적', w.enemies.length, '파티클', w.effects.particles.length, '코인', w.coins.length, '예고', w.telegraphs.length, 'rng', (w.rng as unknown as { s?: number }).s);
