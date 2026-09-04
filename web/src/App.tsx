import { useEffect, useMemo, useState } from 'react';

type Health = { ok: boolean; service: string; platform: string; storage: string; intelligence?: string };
type Player = { name?: string; position?: string; nflTeam?: string; rosterGroup?: string; lineupSlot?: string; injury?: string | null; opponent?: string | null; projection?: number | null; averagePoints?: number | null; adjustedProjection?: number | null };
type Change = { add?: Player; remove?: Player | null; projectedGain?: number };
type Optimized = { projectedPoints?: number; lineup?: Array<{ slot?: string; player?: Player }>; changes?: Change[] };
type LatestSync = { fantasyTeam: string | null; syncedAt: string; playerCount: number; source: string; roster: Player[]; optimized?: Optimized | null };
type LatestSyncResponse = { ok: boolean; storage?: string; sync?: LatestSync | null };
type IntelligencePlayer = { playerKey: string; name: string; position: string; team: string; projection: number | null; confidence: number; trend: 'up' | 'down' | 'steady' | 'unknown'; reasons: string[]; sourceGames: number; modelVersion: string; updatedAt: string };
type IntelligenceResponse = { ok: boolean; run?: { id?: number; status?: string; completed_at?: string; player_count?: number; message?: string; source_summary?: Record<string, unknown> } | null; players?: IntelligencePlayer[] };
type SignalRow = { id?: number; player_key?: string; display_name?: string; kind?: string; severity?: number; projection_multiplier?: number; confidence_delta?: number; headline?: string; detail?: string | null; source?: string; source_url?: string | null; observed_at?: string; expires_at?: string | null };
type SignalsResponse = { ok: boolean; signals?: SignalRow[] };

const normalizeName = (value = '') => value.toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\.?\b/g, '').replace(/[^a-z0-9]/g, '');
const rtsScore = (player?: Player | null) => player?.adjustedProjection ?? player?.projection ?? player?.averagePoints ?? 0;
const fmt = (value: number) => Number.isFinite(value) ? value.toFixed(1) : '0.0';
const pct = (value: number) => `${Math.round(value * 100)}%`;

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [latest, setLatest] = useState<LatestSync | null>(null);
  const [intel, setIntel] = useState<IntelligenceResponse | null>(null);
  const [signals, setSignals] = useState<SignalRow[]>([]);

  useEffect(() => {
    fetch('/api/health').then(async r => (await r.json()) as Health).then(setHealth).catch(() => setHealth(null));
    fetch('/api/sync/latest').then(async r => (await r.json()) as LatestSyncResponse).then(b => setLatest(b.sync ?? null)).catch(() => setLatest(null));
    fetch('/api/intelligence/latest').then(async r => (await r.json()) as IntelligenceResponse).then(setIntel).catch(() => setIntel(null));
    fetch('/api/signals/latest?limit=100').then(async r => (await r.json()) as SignalsResponse).then(b => setSignals(b.signals ?? [])).catch(() => setSignals([]));
  }, []);

  const activeSignals = useMemo(() => {
    const now = Date.now();
    return signals.filter(signal => {
      if (!signal.expires_at) return true;
      const expiry = new Date(signal.expires_at).getTime();
      return !Number.isFinite(expiry) || expiry > now;
    });
  }, [signals]);

  const insights = useMemo(() => {
    if (!latest) return null;
    const starters = latest.roster.filter(p => p.rosterGroup === 'starter');
    const bench = latest.roster.filter(p => p.rosterGroup === 'bench');
    const intelByPlayer = new Map<string, IntelligencePlayer>();
    for (const p of intel?.players ?? []) intelByPlayer.set(`${normalizeName(p.name)}:${p.position.toUpperCase()}`, p);
    const intelFor = (player?: Player | null) => player ? intelByPlayer.get(`${normalizeName(player.name)}:${(player.position ?? '').toUpperCase()}`) : undefined;
    const score = (player?: Player | null) => intelFor(player)?.projection ?? rtsScore(player);
    const hasScore = (player?: Player | null) => score(player) > 0;
    const scoredPlayers = latest.roster.filter(hasScore);
    const current = starters.reduce((sum, p) => sum + score(p), 0);
    const hasLineupData = starters.some(hasScore) && bench.some(hasScore) && scoredPlayers.length >= 2;
    const benchPressure = hasLineupData ? bench.filter(hasScore).map(p => {
      const same = starters.filter(s => s.position === p.position && hasScore(s));
      if (!same.length) return null;
      const weakest = [...same].sort((a,b) => score(a)-score(b))[0];
      return { player:p, replace:weakest, edge:score(p)-score(weakest), projection:score(p), confidence:intelFor(p)?.confidence ?? .35, intelligence:intelFor(p) };
    }).filter((x): x is NonNullable<typeof x> => Boolean(x && Number.isFinite(x.edge) && x.edge > .05)).sort((a,b) => b.edge-a.edge) : [];
    const rtsAlerts = latest.roster.filter(p => p.injury && !['','-','healthy'].includes(String(p.injury).toLowerCase()));
    const rosterNames = new Set(latest.roster.map(p => normalizeName(p.name)));
    const rosterSignals = activeSignals.filter(signal => rosterNames.has(normalizeName(signal.display_name)));
    const modeledRoster = latest.roster.map(player => ({ player, intelligence:intelFor(player), projection:score(player) }));
    const watched = modeledRoster.filter(x => x.intelligence && x.projection > 0).sort((a,b) => b.projection-a.projection).slice(0,8);
    const projectionCoverage = modeledRoster.filter(x => x.intelligence && x.projection > 0).length;
    return { starters, current, gain:benchPressure[0]?.edge ?? 0, topMove:benchPressure[0], rtsAlerts, rosterSignals, benchPressure, hasLineupData, projectionCoverage, modeledRoster, watched };
  }, [latest, intel, activeSignals]);

  const starters = insights?.starters.slice(0,12) ?? [];
  const modelReady = Boolean(intel?.run?.status === 'success' && (intel.players?.length ?? 0) > 0);
  const sourceSummary = intel?.run?.source_summary ?? {};
  const topSignals = (insights?.rosterSignals ?? []).slice(0,8);
  const availabilityCount = (insights?.rtsAlerts.length ?? 0) + (insights?.rosterSignals.filter(s => ['injury','practice','availability'].includes(String(s.kind))).length ?? 0);

  return <main className="shell">
    <header className="hero"><div><p className="eyebrow">RTSports intelligence, centralized</p><h1>Fantasy Edge</h1><p className="lede">Your weekly command center for lineup decisions, roster risk, matchup preparation, and the moves most likely to improve your team.</p></div><div className={`status ${health?.ok ? 'online' : ''}`}><span className="status-dot" />{health?.ok ? `Backend online · ${health.storage}` : 'Checking backend'}</div></header>

    {latest && insights && <section className="insights"><div className="section-title"><div><p className="label">This week</p><h2>Action Center</h2></div><span className="pill">{modelReady ? 'Fantasy Edge model active' : 'Building Fantasy Edge model'}</span></div><div className="insight-grid">
      <article className={`insight-card ${!insights.hasLineupData ? 'attention' : insights.gain > .05 ? 'attention' : 'good'}`}><span className="insight-kicker">Lineup</span><strong>{!insights.hasLineupData ? 'Waiting for usable projections' : insights.gain > .05 ? `+${fmt(insights.gain)} pts available` : 'No same-position upgrade found'}</strong><p>{!insights.hasLineupData ? 'The projection engine is still establishing enough coverage to rank lineup choices.' : insights.topMove ? `Start ${insights.topMove.player.name} over ${insights.topMove.replace.name}. Fantasy Edge projects ${fmt(insights.topMove.projection)} points with ${pct(insights.topMove.confidence)} confidence.` : 'No bench player currently projects above a same-position starter.'}</p></article>
      <article className={`insight-card ${availabilityCount ? 'danger' : 'good'}`}><span className="insight-kicker">Availability</span><strong>{availabilityCount ? `${availabilityCount} active availability signal${availabilityCount === 1 ? '' : 's'}` : 'No active availability flags'}</strong><p>{availabilityCount ? topSignals.filter(s => ['injury','practice','availability'].includes(String(s.kind))).slice(0,2).map(s => s.headline).join(' · ') || insights.rtsAlerts.slice(0,2).map(p => `${p.name} (${p.injury})`).join(' · ') : 'RTSports and public injury feeds currently show no roster availability issues.'}</p></article>
      <article className={`insight-card ${insights.benchPressure.length ? 'attention' : 'neutral'}`}><span className="insight-kicker">Bench pressure</span><strong>{insights.benchPressure.length ? `${insights.benchPressure.length} possible upgrade${insights.benchPressure.length === 1 ? '' : 's'}` : modelReady ? 'Starters currently lead' : 'Model refresh pending'}</strong><p>{insights.benchPressure[0] ? `${insights.benchPressure[0].player.name} projects ${fmt(insights.benchPressure[0].edge)} above ${insights.benchPressure[0].replace.name}.` : modelReady ? 'No modeled bench player currently grades above a same-position starter.' : 'A projection refresh will run automatically after roster sync or on the scheduled data cycle.'}</p></article>
      <article className="insight-card neutral"><span className="insight-kicker">Fantasy Edge coverage</span><strong>{insights.projectionCoverage}/{latest.playerCount} modeled</strong><p>{modelReady ? `Current starter baseline: ${fmt(insights.current)} pts. Model ${intel?.players?.[0]?.modelVersion ?? ''} blends performance, role, opponent, injury, transaction, and news context.` : 'The backend has roster data and is preparing the first persistent projection snapshot.'}</p></article>
    </div></section>}

    <section className="grid"><article className="card feature-card"><div className="card-heading"><div><p className="label">RTSports Sync</p><h2>{latest ? latest.fantasyTeam ?? 'Roster connected' : 'Waiting for first sync'}</h2></div><span className="pill">Extension bridge</span></div><p className="muted">{latest ? 'RTSports supplies league-specific roster state. Fantasy Edge layers independent NFL intelligence on top of it.' : 'Visit an RTSports roster page with the extension installed to send your first roster snapshot.'}</p><div className="sync-state"><div><span>Last sync</span><strong>{latest ? new Date(latest.syncedAt).toLocaleString() : 'Not connected'}</strong></div><div><span>Players imported</span><strong>{latest?.playerCount ?? 0}</strong></div><div><span>Model refresh</span><strong>{intel?.run?.completed_at ? new Date(intel.run.completed_at).toLocaleString() : 'Pending'}</strong></div></div>{insights?.benchPressure.length ? <div className="moves"><p className="label">Recommended same-position changes</p>{insights.benchPressure.slice(0,5).map((move,i) => <div className="move-row" key={`${move.player.name}-${i}`}><div><strong>START {move.player.name}</strong><span>Bench {move.replace.name} · Confidence {pct(move.confidence)}</span></div><b>+{fmt(move.edge)}</b></div>)}</div> : null}</article>

    <article className="card"><p className="label">Starting lineup</p><h2>{latest ? `${insights?.starters.length ?? 0} starters detected` : 'No roster imported yet'}</h2>{starters.length ? <div className="roster-preview">{starters.map((p,i) => { const modeled=insights?.modeledRoster.find(x=>x.player===p); return <div key={`${p.name}-${i}`} className="roster-row"><div><strong>{p.name ?? 'Unknown player'}</strong><small>{p.lineupSlot ?? p.position ?? ''}{modeled?.intelligence ? ` · FE ${fmt(modeled.projection)} · ${pct(modeled.intelligence.confidence)}` : ''}</small></div><span>{p.position ?? ''} · {p.nflTeam ?? ''}</span></div> })}</div> : <p className="muted">Starters, bench, injuries, projections, and weekly scoring will appear here.</p>}</article>

    <article className="card"><p className="label">Fantasy Edge Intelligence</p><h2>{modelReady ? 'Season-long model online' : 'First model refresh pending'}</h2><p className="muted">The backend stores historical projection snapshots and refreshes public NFL data twice daily. Current feeds now include performance, depth charts, schedule context, trades, ESPN injuries, and ESPN NFL news.</p><div className="mini-stats"><span>2025 rows <strong>{String(sourceSummary.stats2025Rows ?? '—')}</strong></span><span>Depth rows <strong>{String(sourceSummary.depth2026Rows ?? '—')}</strong></span><span>Active signals <strong>{String(insights?.rosterSignals.length ?? 0)}</strong></span></div></article></section>

    {topSignals.length ? <section className="signal-watch"><div className="section-title"><div><p className="label">Live context</p><h2>Player Signals</h2></div><span className="pill">Why projections changed</span></div><div className="signal-list">{topSignals.map((signal,i) => <article className="signal-row" key={`${signal.id ?? i}-${signal.headline}`}><div className="signal-badge">{String(signal.kind ?? 'news')}</div><div className="signal-copy"><strong>{signal.headline ?? signal.display_name}</strong><p>{signal.detail || `${signal.source ?? 'Public source'} signal applied to the current Fantasy Edge projection.`}</p><span>{signal.source ?? 'Public source'} · {signal.observed_at ? new Date(signal.observed_at).toLocaleString() : 'recent'}{signal.expires_at ? ` · expires ${new Date(signal.expires_at).toLocaleString()}` : ''}</span></div><div className="signal-impact"><b>{Number(signal.projection_multiplier ?? 1) === 0 ? 'OUT' : `${Math.round((Number(signal.projection_multiplier ?? 1)-1)*100)}%`}</b><span>projection</span></div></article>)}</div></section> : null}

    {insights?.watched.length ? <section className="model-watch"><div className="section-title"><div><p className="label">Model transparency</p><h2>Projection Watch</h2></div><span className="pill">Why Fantasy Edge thinks this</span></div><div className="watch-grid">{insights.watched.map(({player,intelligence,projection}) => <article className="watch-card" key={`${player.name}-${player.position}`}><div className="watch-head"><div><strong>{player.name}</strong><span>{player.position} · {player.nflTeam}</span></div><b>{fmt(projection)} pts</b></div><div className="watch-meta"><span>{pct(intelligence?.confidence ?? 0)} confidence</span><span>{intelligence?.trend ?? 'unknown'} trend</span><span>{intelligence?.sourceGames ?? 0} source games</span></div><p>{intelligence?.reasons?.slice(-3).join(' ')}</p></article>)}</div></section> : null}

    <section className="extension-card"><div><p className="label">Browser extension</p><h2>Install the RTSports sync bridge</h2><p className="muted">The extension remains the league adapter. Public NFL intelligence is refreshed by the hosted backend, so projections continue updating even when RTSports is closed.</p></div><div className="extension-actions"><a className="download-button" href="/downloads/fantasy-edge-extension.zip" download>Download Extension</a><span className="download-note">Chrome / Edge · Manifest V3</span></div><div className="install-steps"><span><strong>1.</strong> Download and unzip</span><span><strong>2.</strong> Open browser extensions</span><span><strong>3.</strong> Enable Developer mode</span><span><strong>4.</strong> Load unpacked folder</span></div></section>

    <section className="coming-next"><p className="label">Intelligence pipeline</p><div className="roadmap"><span>✓ Roster sync</span><span>✓ Historical performance</span><span>✓ Projection snapshots</span><span>✓ Scheduled refresh</span><span>✓ Depth charts</span><span>✓ Next opponent</span><span>✓ Injury reports</span><span>✓ News signals</span><span>Waiver recommendations</span></div></section>
  </main>;
}
