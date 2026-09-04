const API_BASE = 'https://fantasyedge.rudarg.com/api';

type SyncMessage = {
  type: 'FANTASY_EDGE_SYNC_ROSTER' | 'FANTASY_EDGE_SYNC_CONFIG';
  payload: unknown;
};

chrome.runtime.onMessage.addListener((message: SyncMessage, _sender, sendResponse) => {
  if (!message || !['FANTASY_EDGE_SYNC_ROSTER', 'FANTASY_EDGE_SYNC_CONFIG'].includes(message.type)) return;

  const endpoint = message.type === 'FANTASY_EDGE_SYNC_CONFIG' ? '/sync/config' : '/sync/roster';
  void fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(message.payload),
  })
    .then(async (response) => {
      const body = await response.json().catch(() => null);
      sendResponse({ ok: response.ok, status: response.status, body });
    })
    .catch((error) => {
      sendResponse({ ok: false, status: 0, body: { error: error instanceof Error ? error.message : 'Sync failed' } });
    });

  return true;
});
