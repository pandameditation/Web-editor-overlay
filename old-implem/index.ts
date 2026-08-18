import type { Plugin } from 'vite';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { transformHtml } from './transform/html.js';
import { transformLit } from './transform/lit.js';
import { createWsHandler } from './server/ws.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface LiveEditOptions {
  include?: string[];
  exclude?: string[];
  toggleKey?: string;
}

export default function liveEdit(options: LiveEditOptions = {}): Plugin {
  let root = '';

  return {
    name: 'vite-plugin-live-edit',
    apply: 'serve',

    configResolved(config) {
      root = config.root;
    },

    configureServer(server) {
      createWsHandler(server);

      server.middlewares.use('/__live-edit/client.js', (_req, res) => {
        const clientPath = join(__dirname, 'client/overlay.js');
        res.setHeader('Content-Type', 'application/javascript');
        res.end(readFileSync(clientPath, 'utf-8'));
      });
    },

    transformIndexHtml(html, ctx) {
      const transformed = transformHtml(html, ctx.filename, root);
      return {
        html: transformed,
        tags: [{ tag: 'script', attrs: { type: 'module', src: '/__live-edit/client.js' }, injectTo: 'body' }],
      };
    },

    transform(code, id) {
      if (id.includes('node_modules')) return;
      if (/\.(ts|js)$/.test(id) && code.includes('html`')) {
        return transformLit(code, id, root);
      }
    },
  };
}
