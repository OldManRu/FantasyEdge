import { useEffect, useState } from 'react';

type Health = {
  ok: boolean;
  service: string;
  platform: string;
  storage: string;
};

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((response) => response.json())
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

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
          {health?.ok ? 'Cloudflare backend online' : 'Checking backend'}
        </div>
      </header>

      <section className="grid">
        <article className="card feature-card">
          <div className="card-heading">
            <div>
              <p className="label">RTSports Sync</p>
              <h2>Waiting for first sync</h2>
            </div>
            <span className="pill">Extension bridge</span>
          </div>
          <p className="muted">
            The browser extension will collect authenticated RTSports data and send
            it here. Once synchronized, Fantasy Edge will be available from any device.
          </p>
          <div className="sync-state">
            <div>
              <span>Last sync</span>
              <strong>Not connected</strong>
            </div>
            <div>
              <span>Players imported</span>
              <strong>0</strong>
            </div>
            <div>
              <span>Data source</span>
              <strong>RTSports</strong>
            </div>
          </div>
        </article>

        <article className="card">
          <p className="label">Roster</p>
          <h2>No roster imported yet</h2>
          <p className="muted">
            Starters, bench, injury status, projections, and weekly scoring will appear here.
          </p>
        </article>

        <article className="card">
          <p className="label">Fantasy Edge Status</p>
          <h2>Foundation online</h2>
          <p className="muted">
            Hosted dashboard and Worker API are ready for the RTSports synchronization layer.
          </p>
        </article>
      </section>

      <section className="coming-next">
        <p className="label">Coming next</p>
        <div className="roadmap">
          <span>Secure sync</span>
          <span>Persistent league data</span>
          <span>Lineup optimizer</span>
          <span>Matchup intelligence</span>
          <span>Waiver recommendations</span>
        </div>
      </section>
    </main>
  );
}
