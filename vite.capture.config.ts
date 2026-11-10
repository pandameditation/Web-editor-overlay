import { defineConfig } from 'vite';
/**
 * The capture bundle: `dist/heo-capture.js`, the one file the browser extension injects.
 *
 * Separate from the library build because it has the opposite constraint. The overlay bundles
 * Lit on purpose; this has to stay small (under 50 KB, enforced by
 * `scripts/check-capture-size.mjs`) because it is injected into every page the user picks
 * from, so it pulls only the pure helpers it shares with the editor and no UI framework.
 */
export default defineConfig({
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: false,
    minify: 'esbuild',
    lib: {
      entry: 'src/capture/index.ts',
      name: 'HeoCapture',
      formats: ['iife'],
      fileName: () => 'heo-capture.js',
    },
    rollupOptions: {
      output: { exports: 'named' },
    },
  },
});
