import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';

/** Separate build for the Node-side Vite plugin, which must stay external-friendly. */
export default defineConfig({
  build: {
    target: 'node18',
    outDir: 'dist',
    emptyOutDir: false,
    ssr: true,
    minify: false,
    lib: {
      entry: 'src/integrations/vite-plugin.ts',
      formats: ['es'],
      fileName: () => 'vite-plugin.js',
    },
    rollupOptions: {
      external: [...builtinModules, ...builtinModules.map((m) => `node:${m}`), 'vite'],
    },
  },
});
