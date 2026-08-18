import type { ViteDevServer } from 'vite';
import { mutateSource } from './mutate.js';

interface EditMessage {
  type: string;
  [key: string]: any;
}

export function createWsHandler(server: ViteDevServer): void {
  server.ws.on('live-edit:message', async (data: EditMessage, client) => {
    try {
      const root = server.config.root;
      const result = await handleMessage(data, root);
      client.send('live-edit:ack', { type: data.type, src: data.src, ...result });
    } catch (err: any) {
      client.send('live-edit:error', { type: data.type, src: data.src, message: err.message });
    }
  });
}

async function handleMessage(msg: EditMessage, root: string) {
  switch (msg.type) {
    case 'edit:text':
      return mutateSource({ type: 'text', src: msg.src, content: msg.content, root });
    case 'edit:move':
      return mutateSource({ type: 'move', src: msg.src, direction: msg.direction, root });
    case 'edit:reparent':
      return mutateSource({ type: 'reparent', src: msg.src, direction: msg.direction, root });
    case 'edit:html':
      return mutateSource({ type: 'html', src: msg.src, html: msg.html, root });
    case 'edit:style':
      return mutateSource({ type: 'style', src: msg.src, property: msg.property, value: msg.value, root });
    case 'edit:paste':
      return mutateSource({ type: 'paste', cutSrc: msg.cutSrc, targetSrc: msg.targetSrc, position: msg.position, root });
    case 'save':
      // Save is already handled by the individual mutations (they write to disk immediately)
      return { ok: true, message: 'All changes already persisted.' };
    default:
      throw new Error(`Unknown message type: ${msg.type}`);
  }
}
