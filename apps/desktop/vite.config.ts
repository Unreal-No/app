import { defineConfig } from 'vite'

// พอร์ตคงที่ตามที่ tauri.conf.json อ้างถึง
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  build: { target: 'es2022', outDir: 'dist' },
})
