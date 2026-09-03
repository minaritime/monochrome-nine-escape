import { defineConfig } from 'vite';

// GitHub Pages 배포 시 저장소 하위 경로에서도 동작하도록 상대 경로를 씁니다.
export default defineConfig({
  base: './',
  server: { open: true },
  build: { target: 'es2022' },
});
