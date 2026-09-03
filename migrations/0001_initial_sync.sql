CREATE TABLE IF NOT EXISTS roster_syncs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'rtsports',
  page_url TEXT,
  fantasy_team TEXT,
  synced_at TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  player_count INTEGER NOT NULL,
  roster_json TEXT NOT NULL,
  optimized_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_roster_syncs_received_at
  ON roster_syncs(received_at DESC);

CREATE INDEX IF NOT EXISTS idx_roster_syncs_device_id
  ON roster_syncs(device_id, received_at DESC);
