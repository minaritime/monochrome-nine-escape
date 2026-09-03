/**
 * 친구에게 그대로 건네줄 수 있는 단일 HTML 을 만듭니다.
 *
 * 왜 한 파일인가:
 *   Vite 가 내놓는 기본 결과물은 `<script type="module" src="...">` 라서
 *   file:// 로 열면 브라우저가 CORS 로 막습니다. 서버를 띄워야만 돌아갑니다.
 *   IIFE 한 덩어리로 묶어 HTML 안에 넣으면 그냥 더블클릭으로 열립니다.
 *   설치도, 서버도, 인터넷도 필요 없습니다.
 *
 *   npm run standalone
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = join(root, '.standalone');
const outDir = join(root, '..', '피하기게임-배포');

const js = readFileSync(join(buildDir, 'main.js'), 'utf8');
const css = readFileSync(join(buildDir, 'main.css'), 'utf8');

/** `</script>` 가 문자열 안에 들어 있으면 인라인 스크립트가 거기서 끊깁니다 */
const safeJs = js.replace(/<\/script/gi, '<\\/script');

const html = `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>모노크롬 나인 이스케이프</title>
    <style>
${css}
    </style>
  </head>
  <body>
    <div id="app">
      <canvas id="game"></canvas>
      <div id="overlay"></div>
    </div>
    <script>
${safeJs}
    </script>
  </body>
</html>
`;

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, '피하기게임.html'), html, 'utf8');

const kb = (n) => `${Math.round(n / 1024)}KB`;
console.log(`만들었습니다: ${join(outDir, '피하기게임.html')}`);
console.log(`  스크립트 ${kb(js.length)} · 스타일 ${kb(css.length)} · 전체 ${kb(html.length)}`);
