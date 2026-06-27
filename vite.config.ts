import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  base: '/NEONLab/',
  root: '.',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: 'index.html',
    },
  },
  plugins: [
    viteStaticCopy({
      targets: [{ src: 'engine/*', dest: 'engine' }],
    }),
  ],
  server: {
    fs: { allow: ['.'] },
  },
});
