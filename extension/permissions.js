// Asks for the optional <all_urls> host permission. Firefox only allows the request inside the
// click handler itself, so nothing is awaited before permissions.request.
const api = globalThis.browser ?? globalThis.chrome;
const status = document.getElementById('status');

document.getElementById('allow').addEventListener('click', () => {
  api.permissions.request({ origins: ['<all_urls>'] }).then(
    (granted) => {
      if (granted) {
        status.textContent = 'Allowed. Pick the element again to capture it with its assets.';
        // window.close() is not honoured everywhere for a tab the background opened; tabs.remove is.
        setTimeout(() => {
          api.tabs.getCurrent().then((tab) => (tab ? api.tabs.remove(tab.id) : window.close()), () => window.close());
        }, 1200);
      } else {
        status.textContent = 'Not allowed. Assets from other sites will keep their original URLs.';
      }
    },
    () => {
      status.textContent = 'The browser refused the request.';
    },
  );
});
