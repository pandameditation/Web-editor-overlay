// WebSocket communication via Vite's HMR channel

declare const __HMR_PORT__: string | undefined;

let hot: any = null;

export function connectWs() {
  if (import.meta.hot) {
    hot = import.meta.hot;
  }
}

export function sendEdit(payload: Record<string, any>): void {
  if (hot) hot.send('live-edit:message', payload);
}

export function onMessage(event: string, cb: (data: any) => void): void {
  if (hot) hot.on(event, cb);
}
