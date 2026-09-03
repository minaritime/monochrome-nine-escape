import type { BossId, EnemyId } from '../data/balance';
import { BOSS_DEFS, isBossId } from './boss';
import { bounce, chase, mummy, mummyOnLethal, puddleChase, puddleOnDeath, shieldBlocks, shielded } from './behaviors/simple';
import { bomber, bomberIgnite, bomberInit, bomberOnDeath, coward, ranged, splitter, splitterOnDeath } from './behaviors/special';
import { charger, stealth, summoner } from './behaviors/advanced';
import type { EnemyDef } from './types';

/**
 * 적 14종 정의. 수치는 전부 data/balance.ts 에 있습니다.
 *
 * ★ 색과 모양에는 규칙이 있습니다. 새 적을 넣을 때 반드시 지키십시오.
 *
 * - **색 = 위험도**: 접촉 피해가 클수록 강렬한 난색(주황 → 빨강 → 진홍)을 씁니다.
 *   덜 위험한 적은 차분한 한색(회청 · 하늘 · 초록 · 청록)으로 물러납니다.
 *   가장 흔한 기본적이 가장 강한 빨강을 쓰고 있어서 위험한 적이 묻혔던 것을 바로잡은 것입니다.
 * - **모양 = 행동 유형**: 같은 실루엣이 겹치면 난전에서 색만으로는 구분되지 않습니다.
 *   원형을 쓰는 다섯 종(기본 · 자폭 · 분열 · 미라 · 은신)은 표식으로 실루엣을 갈라놓았습니다.
 *   기본만 아무 표식이 없는 순수한 원입니다.
 * - 표식에 쓰는 색은 여기 `color` / `accent` 를 가져다 씁니다. render 쪽에 색을 직접 쓰지 마십시오.
 */
export const ENEMY_DEFS: Record<EnemyId, EnemyDef> = {
  basic: {
    id: 'basic',
    name: '기본',
    // 화면의 대다수를 차지하므로 가장 조용한 색입니다. 표식도 없는 순수한 원입니다
    color: '#7d8698',
    accent: '#c2cad8',
    sides: 0,
    faceMove: false,
    pattern: '플레이어를 곧장 추적합니다',
    behavior: chase,
  },
  fast: {
    id: 'fast',
    name: '빠른',
    // 청록(소환)과 붙지 않게 파랑 쪽으로 밀어둔 하늘색입니다
    color: '#7cc4ff',
    accent: '#d6ecff',
    sides: 3,
    faceMove: true,
    pattern: '체력은 낮지만 훨씬 빠르게 추적합니다',
    behavior: chase,
  },
  tank: {
    id: 'tank',
    name: '탱커',
    // 유일한 육각형입니다. 덩치가 1.45배라 어두운 색이어도 충분히 보입니다
    color: '#3b5570',
    accent: '#9dbbdd',
    sides: 6,
    faceMove: false,
    pattern: '아주 느리지만 체력이 세 배입니다',
    behavior: chase,
  },
  ranged: {
    id: 'ranged',
    name: '원거리',
    // 접촉 피해는 낮은 적입니다. 붉은 계열을 쓰면 즉사급 적과 섞입니다
    color: '#4dc98a',
    accent: '#baf0d5',
    sides: 4,
    faceMove: false,
    pattern: '사거리에 들어오면 멈춰 2초 조준한 뒤 느린 탄을 쏩니다. 조준선을 보고 피할 수 있습니다',
    behavior: ranged,
    extraDraw: 'ranged',
  },
  coward: {
    id: 'coward',
    name: '겁쟁이',
    // 가까이 가면 즉사급으로 달려듭니다. 경고색인 노랑을 씁니다
    color: '#ffd84d',
    accent: '#fff3c0',
    sides: 5,
    faceMove: true,
    pattern: '느리게 배회하다가 가까워지면 플레이어보다 빠른 속도로 달려듭니다. 돌진 뒤에는 잠시 멈춥니다',
    behavior: coward,
    extraDraw: 'coward',
  },
  fool: {
    id: 'fool',
    name: '바보',
    color: '#b06bff',
    accent: '#e2ccff',
    sides: 4,
    faceMove: true,
    pattern: '쫓아오지 않고 직진만 하며 벽에서 반사됩니다',
    behavior: bounce,
  },
  bomber: {
    id: 'bomber',
    name: '자폭',
    // 즉사급입니다. 원형이지만 심지가 달려 있어 기본적과 실루엣이 다릅니다
    color: '#ff8c1a',
    accent: '#ffd9a8',
    sides: 0,
    faceMove: false,
    pattern: '나타난 뒤 잠시 멈췄다가 쫓아옵니다. 맞으면 점화되어 빨라지고 4초 뒤 폭발하며, 처치해도 2초 뒤 시체가 터집니다 (적에게도 피해)',
    init: bomberInit,
    behavior: bomber,
    onDamaged: (e, w) => bomberIgnite(e, w),
    onDeath: bomberOnDeath,
    extraDraw: 'bomber',
  },
  splitter: {
    id: 'splitter',
    name: '분열',
    color: '#8f7fd8',
    accent: '#ded6ff',
    sides: 0,
    faceMove: false,
    pattern: '죽으면 작은 개체 3마리로 분열합니다. 분열체는 다시 나뉘지 않습니다',
    behavior: splitter,
    onDeath: splitterOnDeath,
    // 안에 작은 원이 하나 더 있습니다. "안에 뭔가 들어 있다"를 실루엣으로 보여줍니다
    extraDraw: 'splitter',
  },
  charger: {
    id: 'charger',
    name: '돌진',
    // 즉사급입니다
    color: '#ff2d4d',
    accent: '#ffb3bf',
    sides: 3,
    faceMove: true,
    pattern: '배회하다가 직선 예고를 띄우고 3초 멈춘 뒤 돌진합니다. 벽에 부딪히면 기절합니다',
    behavior: charger,
    extraDraw: 'charger',
  },
  puddle: {
    id: 'puddle',
    name: '장판',
    color: '#4d7fd8',
    accent: '#b9d1ff',
    // 탱커와 같은 육각형이면 색만으로 갈라야 해서 팔각형으로 뺐습니다
    sides: 8,
    faceMove: false,
    pattern: '체력이 아주 높고, 죽은 자리에 감속 장판을 남깁니다',
    behavior: puddleChase,
    onDeath: puddleOnDeath,
    // 죽으면 깔릴 장판 범위를 발밑에 미리 보여줍니다
    extraDraw: 'puddle',
  },
  summoner: {
    id: 'summoner',
    name: '소환',
    color: '#4dd2c4',
    accent: '#c6f5ef',
    sides: 5,
    faceMove: false,
    pattern: '도주하며 못 죽이는 하수인을 최대 5마리까지 부릅니다. 하수인은 이 적을 잡아야만 한꺼번에 사라집니다',
    behavior: summoner,
    extraDraw: 'summoner',
  },
  shield: {
    id: 'shield',
    name: '방패',
    color: '#9fb4d4',
    accent: '#dbe6f7',
    sides: 4,
    faceMove: true,
    pattern: '정면 90도 피해를 방패가 대신 받습니다. 방패가 깨지면 무효화가 사라지는 대신 빨라집니다. 관통·폭발·전방위 스킬은 방패를 무시합니다',
    behavior: shielded,
    hasShield: true,
    blocks: shieldBlocks,
    extraDraw: 'shield',
  },
  mummy: {
    id: 'mummy',
    name: '미라',
    // 붕대 빛깔. 위험도는 중간이라 난색이되 채도가 낮습니다
    color: '#c9b48a',
    accent: '#f2e3c4',
    sides: 0,
    faceMove: false,
    pattern: '느리게 쫓아옵니다. 처치해도 3초 뒤 되살아나 체력 3배 · 공격력 2배가 되지만, 그때부터 매초 최대 체력의 20%씩 스스로 무너집니다',
    behavior: mummy,
    onLethal: mummyOnLethal,
    // 몸을 가로지르는 붕대 줄무늬
    extraDraw: 'mummy',
  },
  stealth: {
    id: 'stealth',
    name: '은신',
    // 접촉 피해가 가장 큰 적입니다. 드러나는 1초 동안만큼은 가장 강한 색이어야 합니다
    color: '#c81e3c',
    accent: '#ff8f9f',
    sides: 0,
    faceMove: false,
    pattern: '가까이 오면 모습을 드러냅니다. 드러난 동안에만 조준할 수 있습니다',
    behavior: stealth,
    extraDraw: 'stealth',
  },
};

export const ALL_ENEMY_IDS = Object.keys(ENEMY_DEFS) as EnemyId[];

export function getEnemyDef(id: EnemyId | BossId): EnemyDef {
  return isBossId(id) ? BOSS_DEFS[id] : ENEMY_DEFS[id];
}
