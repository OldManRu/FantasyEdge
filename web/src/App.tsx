import { useEffect, useState } from 'react';

type Health = {
  ok: boolean;
  service: string;
  platform: string;
  storage: string;
};

type LatestSync = {
  fantasyTeam: string | null;
  syncedAt: string;
  playerCount: number;
  source: string;
  roster: Array<{ name?: string; position?: string; nflTeam?: string; rosterGroup?: string }>;
};

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [latest, setLatest] = useState<LatestSync | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((response) => response.json())
      .then(setHealth)
      .catch(() => setHealth(null));

    fetch('/api/sync/latest')
      .then((response) => response.json())
      .then((body) => setLatest(body.sync ?? null))
      .catch(() => setLatest(null));
  }, []);

  const starters = latest?.roster.filter((player) => player.rosterGroup === 'starter').slice(0, 8) ?? [];

  return (
    <main className="shell">
      <header className="hero">
        <div>
          <p className="eyebrow">RTSports intelligence, centralized</p>
          <h1>Fantasy Edge</h1>
          <p className="lede">
            Your hosted command center for roster decisions, lineup optimization,
            waiver analysis, matchup intelligence, and weekly recommendations.
          </p>
        </div>
        <div className={`status ${health?.ok ? 'online' : ''}`}>
          <span className="status-dot" />
          {health?.ok ? `Backend online · ${health.storage}` : 'Checking backend'}
        </div>
      </header>

      <section className="grid">
        <article className="card feature-card">
          <div className="card-heading">
            <div>
              <p className="label">RTSports Sync</p>
              <h2>{latest ? latest.fantasyTeam ?? 'Roster connected' : 'Waiting for first sync'}</h2>
            </div>
            <span className="pill">Extension bridge</span>
          </div>
          <p className="muted">
            {latest
              ? 'Fantasy Edge has received RTSports roster data and can now use it across devices.'
              : 'Visit an RTSports roster page with the extension installed to send your first roster snapshot.'}
          </p>
          <div className="sync-state">
            <div>
              <span>Last sync</span>
              <strong>{latest ? new Date(latest.syncedAt).toLocaleString() : 'Not connected'}</strong>
            </div>
            <div>
              <span>Players imported</span>
              <strong>{latest?.playerCount ?? 0}</strong>
            </div>
            <div>
              <span>Data source</span>
              <strong>{latest?.source?.toUpperCase() ?? 'RTSports'}</strong>
            </div>
          </div>
        </article>

        <article className="card">
          <p className="label">Roster</p>
          <h2>{latest ? `${latest.playerCount} players available` : 'No roster imported yet'}</h2>
          {starters.length ? (
            <div className="roster-preview">
              {starters.map((player, index) => (
                <div key={`${player.name}-${index}`} className="roster-row">
                  <strong>{player.name ?? 'Unknown player'}</strong>
                  <span>{player.position ?? ''} · {player.nflTeam ?? ''}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">Starters, bench, injuries, projections, and weekly scoring will appear here.</p>
          )}
        </article>

        <article className="card">
          <p className="label">Fantasy Edge Status</p>
          <h2>{health?.storage === 'd1' ? 'Persistent storage online' : 'D1 connection pending'}</h2>
          <p className="muted">
            The extension transport and hosted sync API are now wired. D1 is the remaining infrastructure binding for persistent roster history.
          </p>
        </article>
      </section>

      <section className="extension-card">
        <div>
          <p className="label">Browser extension</p>
          <h2>Install the RTSports sync bridge</h2>
          <p className="muted">
            Download the latest Fantasy Edge extension package. It is rebuilt and repackaged automatically whenever the hosted app is deployed.
          </p>
        </div>
        <div className="extension-actions">
          <a className="download-button" href="/downloads/fantasy-edge-extension.zip" download>Download Extension</a>
          <span className="download-note">Chrome / Edge · Manifest V3</span>
        </div>
        <div className="install-steps">
          <span><strong>1.</strong> Download and unzip</span>
          <span><strong>2.</strong> Open browser extensions</span>
          <span><strong>3.</strong> Enable Developer mode</span>
          <span><strong>4.</strong> Load unpacked folder</span>
        </div>
      </section>

      <section className="coming-next">
        <p className="label">Coming next</p>
        <div className="roadmap">
          <span>Secure pairing</span>
          <span>Roster history</span>
          <span>Lineup optimizer</span>
          <span>Matchup intelligence</span>
          <span>Waiver recommendations</span>
        </div>
      </section>
    </main>
  );
}
