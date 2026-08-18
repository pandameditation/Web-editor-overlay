import { defineConfig } from 'vite';

/**
 * Library build. Produces two artefacts from one source tree:
 *
 *   dist/html-editor-overlay.js        ESM, for `import { mount } from 'html-editor-overlay'`
 *   dist/html-editor-overlay.iife.js   self-contained IIFE for `<script src="...">` injection
 *
 * Lit is bundled into both on purpose: the overlay has to drop into pages that
 * know nothing about npm.
 */
export default defineConfig({
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: true,
    minify: 'esbuild',
    lib: {
      entry: 'src/index.ts',
      name: 'HtmlEditorOverlay',
      formats: ['es', 'iife'],
      fileName: (format) =>
        format === 'iife' ? 'html-editor-overlay.iife.js' : 'html-editor-overlay.js',
    },
    rollupOptions: {
      output: { exports: 'named' },
    },
  },
});
