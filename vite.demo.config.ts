import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import editorOverlay from './src/integrations/vite-plugin.js';

const src = fileURLToPath(new URL('./src/index.ts', import.meta.url));

/**
 * Dev server for the demo fixture.
 *
 * The alias points the plugin's `html-editor-overlay` import at the source tree
 * so the demo exercises the real plugin path without needing a build first.
 */
export default defineConfig({
  root: 'demo',
  resolve: {
    alias: { 'html-editor-overlay': src },
  },
  plugins: [
    editorOverlay({
      startInEditMode: false,
      accent: '#4f46e5',
      theme: 'dark',
    }),
  ],
  server: { port: 5180 },
  build: { outDir: '../dist-demo', emptyOutDir: true },
});
