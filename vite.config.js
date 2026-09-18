import { defineConfig } from 'vite';
export default defineConfig({ base:'./',server: { host: '127.0.0.1' }, build: { outDir: 'dist',rollupOptions:{output:{manualChunks:{terminal:['@xterm/xterm','@xterm/addon-fit'],react:['react','react-dom']}}} } });
