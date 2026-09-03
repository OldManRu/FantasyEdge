const API_URL = 'https://fantasyedge.rudarg.com/api/sync/roster';

type SyncMessage = {
  type: 'FANTASY_EDGE_SYNC_ROSTER';
  payload: unknown;
};

chrome.runtime.onMessage.addListener((message: SyncMessage, _sender, sendResponse) => {
  if (message?.type !== 'FANTASY_EDGE_SYNC_ROSTER') return;

  void fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(message.payload),
  })
    .then(async (response) => {
      const body = await response.json().catch(() => null);
      sendResponse({ ok: response.ok, status: response.status, body });
    })
    .catch((error) => {
      sendResponse({
        ok: false,
        status: 0,
        body: { error: error instanceof Error ? error.message : 'Sync failed' },
      });
    });

  return true;
});
