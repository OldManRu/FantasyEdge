import { useEffect, useMemo, useState } from 'react';

type Health = { ok: boolean; service: string; platform: string; storage: string };
type Player = {
  name?: string;
  position?: string;
  nflTeam?: string;
  rosterGroup?: string;
  lineupSlot?: string;
  injury?: string | null;
  opponent?: string | null;
  projection?: number | null;
  averagePoints?: number | null;
  adjustedProjection?: number | null;
};
type Change = { add?: Player; remove?: Player | null; projectedGain?: number };
type Optimized = { projectedPoints?: number; lineup?: Array<{ slot?: string; player?: Player }>; changes?: Change[] };
type LatestSync = {
  fantasyTeam: string | null;
  syncedAt: string;
  playerCount: number;
  source: string;
  roster: Player[];
  optimized?: Optimized | null;
};
type LatestSyncResponse = { ok: boolean; storage?: string; sync?: LatestSync | null };

const score = (player?: Player | null) => player?.adjustedProjection ?? player?.projection ?? player?.averagePoints ?? 0;
const hasScore = (player?: Player | null) => score(player) > 0;
const fmt = (value: number) => Number.isFinite(value) ? value.toFixed(1) : '0.0';

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [latest, setLatest] = useState<LatestSync | null>(null);

  useEffect(() => {
    fetch('/api/health').then(async r => (await r.json()) as Health).then(setHealth).catch(() => setHealth(null));
    fetch('/api/sync/latest').then(async r => (await r.json()) as LatestSyncResponse).then(b => setLatest(b.sync ?? null)).catch(() => setLatest(null));
  }, []);

  const insights = useMemo(() => {
    if (!latest) return null;
    const starters = latest.roster.filter(p => p.rosterGroup === 'starter');
    const bench = latest.roster.filter(p => p.rosterGroup === 'bench');
    const scoredPlayers = latest.roster.filter(hasScore);
    const hasLineupData = starters.some(hasScore) && bench.some(hasScore) && scoredPlayers.length >= 2;
    const current = starters.reduce((sum, p) => sum + score(p), 0);
    const optimized = hasLineupData ? (latest.optimized?.projectedPoints ?? current) : 0;
    const changes = hasLineupData
      ? (latest.optimized?.changes ?? []).filter(c => c.add?.name && (c.projectedGain ?? 0) > 0).sort((a, b) => (b.projectedGain ?? 0) - (a.projectedGain ?? 0))
      : [];
    const alerts = latest.roster.filter(p => p.injury && !['', '-', 'healthy'].includes(String(p.injury).toLowerCase()));
    const benchPressure = hasLineupData
      ? bench
          .filter(hasScore)
          .map(p => {
            const samePositionStarters = starters.filter(s => s.position === p.position && hasScore(s));
            if (!samePositionStarters.length) return { player: p, edge: Number.NEGATIVE_INFINITY };
            return { player: p, edge: score(p) - Math.min(...samePositionStarters.map(score)) };
          })
          .filter(x => Number.isFinite(x.edge) && x.edge > 0)
          .sort((a, b) => b.edge - a.edge)
      : [];
    return { starters, current, optimized, gain: optimized - current, changes, alerts, benchPressure, hasLineupData, scoreCoverage: scoredPlayers.length };
  }, [latest]);

  const starters = insights?.starters.slice(0, 10) ?? [];
  const topMove = insights?.changes[0];

  return (
    <main className="shell">
      <header className="hero">
        <div>
          <p className="eyebrow">RTSports intelligence, centralized</p>
          <h1>Fantasy Edge</h1>
          <p className="lede">Your weekly command center for lineup decisions, roster risk, matchup preparation, and the moves most likely to improve your team.</p>
        </div>
        <div className={`status ${health?.ok ? 'online' : ''}`}><span className="status-dot" />{health?.ok ? `Backend online · ${health.storage}` : 'Checking backend'}</div>
      </header>

      {latest && insights && (
        <section className="insights">
          <div className="section-title"><div><p className="label">This week</p><h2>Action Center</h2></div><span className="pill">Based on latest RTSports sync</span></div>
          <div className="insight-grid">
            <article className={`insight-card ${!insights.hasLineupData ? 'attention' : insights.gain > 0.05 ? 'attention' : 'good'}`}>
              <span className="insight-kicker">Lineup</span>
              <strong>{!insights.hasLineupData ? 'Waiting for usable projections' : insights.gain > 0.05 ? `+${fmt(insights.gain)} pts available` : 'Best lineup already set'}</strong>
              <p>{!insights.hasLineupData ? `Fantasy Edge only has scoring data for ${insights.scoreCoverage} of ${latest.playerCount} players, so it will not declare your lineup optimal yet.` : topMove?.add?.name ? `Start ${topMove.add.name}${topMove.remove?.name ? ` over ${topMove.remove.name}` : ''}.` : 'No higher-scoring lineup change is currently identified from the available RTSports data.'}</p>
            </article>
            <article className={`insight-card ${insights.alerts.length ? 'danger' : 'good'}`}>
              <span className="insight-kicker">Availability</span>
              <strong>{insights.alerts.length ? `${insights.alerts.length} player${insights.alerts.length === 1 ? '' : 's'} flagged` : 'No injury flags detected'}</strong>
              <p>{insights.alerts.length ? insights.alerts.slice(0, 3).map(p => `${p.name} (${p.injury})`).join(' · ') : 'Your synchronized roster has no current injury designations requiring attention.'}</p>
            </article>
            <article className={`insight-card ${!insights.hasLineupData ? 'neutral' : insights.benchPressure.length ? 'attention' : 'neutral'}`}>
              <span className="insight-kicker">Bench pressure</span>
              <strong>{!insights.hasLineupData ? 'Cannot compare yet' : insights.benchPressure.length ? `${insights.benchPressure.length} possible upgrade${insights.benchPressure.length === 1 ? '' : 's'}` : 'Starters lead their backups'}</strong>
              <p>{!insights.hasLineupData ? 'Bench-versus-starter comparisons are disabled until Fantasy Edge has real projection or scoring values.' : insights.benchPressure[0] ? `${insights.benchPressure[0].player.name} is scoring ${fmt(insights.benchPressure[0].edge)} above the lowest same-position starter.` : 'No bench player currently grades above a same-position starter.'}</p>
            </article>
            <article className="insight-card neutral">
              <span className="insight-kicker">Projection coverage</span>
              <strong>{insights.scoreCoverage}/{latest.playerCount} players</strong>
              <p>{insights.hasLineupData ? `Optimized lineup: ${fmt(insights.optimized)} pts · Current starter baseline: ${fmt(insights.current)}.` : 'The roster is connected, but the current RTSports snapshot is not providing enough non-zero projection/scoring data to rank lineup choices reliably.'}</p>
            </article>
          </div>
        </section>
      )}

      <section className="grid">
        <article className="card feature-card">
          <div className="card-heading"><div><p className="label">RTSports Sync</p><h2>{latest ? latest.fantasyTeam ?? 'Roster connected' : 'Waiting for first sync'}</h2></div><span className="pill">Extension bridge</span></div>
          <p className="muted">{latest ? 'Fantasy Edge has received RTSports roster data and can now use it across devices.' : 'Visit an RTSports roster page with the extension installed to send your first roster snapshot.'}</p>
          <div className="sync-state"><div><span>Last sync</span><strong>{latest ? new Date(latest.syncedAt).toLocaleString() : 'Not connected'}</strong></div><div><span>Players imported</span><strong>{latest?.playerCount ?? 0}</strong></div><div><span>Data source</span><strong>{latest?.source?.toUpperCase() ?? 'RTSports'}</strong></div></div>
          {insights?.hasLineupData && insights.changes.length ? <div className="moves"><p className="label">Recommended changes</p>{insights.changes.slice(0, 5).map((change, i) => <div className="move-row" key={`${change.add?.name}-${i}`}><div><strong>START {change.add?.name}</strong><span>{change.remove?.name ? `Bench ${change.remove.name}` : 'Open lineup slot'}</span></div><b>+{fmt(change.projectedGain ?? 0)}</b></div>)}</div> : null}
        </article>

        <article className="card"><p className="label">Starting lineup</p><h2>{latest ? `${insights?.starters.length ?? 0} starters detected` : 'No roster imported yet'}</h2>{starters.length ? <div className="roster-preview">{starters.map((p, i) => <div key={`${p.name}-${i}`} className="roster-row"><div><strong>{p.name ?? 'Unknown player'}</strong><small>{p.lineupSlot ?? p.position ?? ''}</small></div><span>{p.position ?? ''} · {p.nflTeam ?? ''}{p.opponent ? ` · ${p.opponent}` : ''}</span></div>)}</div> : <p className="muted">Starters, bench, injuries, projections, and weekly scoring will appear here.</p>}</article>

        <article className="card"><p className="label">Fantasy Edge Status</p><h2>{health?.storage === 'd1' ? 'Persistent storage online' : 'D1 connection pending'}</h2><p className="muted">Roster sync and D1 history are online. Next data targets are weekly matchups, free agents, league scoring, and richer player intelligence so recommendations can account for more than RTSports roster projections.</p></article>
      </section>

      <section className="extension-card"><div><p className="label">Browser extension</p><h2>Install the RTSports sync bridge</h2><p className="muted">Download the latest Fantasy Edge extension package. It is rebuilt and repackaged automatically whenever the hosted app is deployed.</p></div><div className="extension-actions"><a className="download-button" href="/downloads/fantasy-edge-extension.zip" download>Download Extension</a><span className="download-note">Chrome / Edge · Manifest V3</span></div><div className="install-steps"><span><strong>1.</strong> Download and unzip</span><span><strong>2.</strong> Open browser extensions</span><span><strong>3.</strong> Enable Developer mode</span><span><strong>4.</strong> Load unpacked folder</span></div></section>

      <section className="coming-next"><p className="label">Intelligence pipeline</p><div className="roadmap"><span>✓ Roster sync</span><span>✓ Lineup optimizer</span><span>Injuries</span><span>Weekly matchups</span><span>Free agents</span><span>Waiver recommendations</span><span>Opponent scouting</span></div></section>
    </main>
  );
}
