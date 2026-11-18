import { defineConfig } from 'vite'

// พอร์ตคงที่ตามที่ tauri.conf.json อ้างถึง
export default defineConfig({
  clearScreen: false,
  // รุ่นของแอป (commit สั้น) — CI ส่ง BUILD_SHA มา, เครื่องนักพัฒนาเป็น "dev"
  define: { __BUILD__: JSON.stringify((process.env.BUILD_SHA ?? 'dev').slice(0, 7)) },
  server: { port: 1420, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  build: { target: 'es2022', outDir: 'dist' },
})
