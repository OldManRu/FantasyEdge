import { parseRoster } from './roster-parser';
import { optimizeLineup } from '../../shared/optimizer/lineup-optimizer';
import { looksLikeCommissionerSettingsPage, parseLeagueConfig } from './config-parser';

console.clear();
console.log('%cFantasy Edge', 'font-size:18px;font-weight:bold;color:#2563eb;');

async function getDeviceId(): Promise<string> {
  const existing = await chrome.storage.local.get('fantasyEdgeDeviceId');
  if (existing.fantasyEdgeDeviceId) return existing.fantasyEdgeDeviceId as string;
  const deviceId = crypto.randomUUID();
  await chrome.storage.local.set({ fantasyEdgeDeviceId: deviceId });
  return deviceId;
}

function playerScore(player: ReturnType<typeof parseRoster>[number]): number { return player.projection ?? player.averagePoints ?? 0; }
function currentStarterProjection(roster: ReturnType<typeof parseRoster>): number { return roster.filter(player => player.rosterGroup === 'starter').reduce((total, player) => total + playerScore(player), 0); }

function send(type: 'FANTASY_EDGE_SYNC_ROSTER' | 'FANTASY_EDGE_SYNC_CONFIG', payload: unknown) {
  chrome.runtime.sendMessage({ type, payload }, response => {
    if (chrome.runtime.lastError) return console.warn('Fantasy Edge sync failed', chrome.runtime.lastError.message);
    if (!response?.ok) console.warn('Fantasy Edge sync not stored yet', response);
  });
}

async function syncConfigIfPresent() {
  if (!looksLikeCommissionerSettingsPage()) return false;
  const sections = parseLeagueConfig();
  if (!sections.length) return false;
  const deviceId = await getDeviceId();
  send('FANTASY_EDGE_SYNC_CONFIG', {
    schemaVersion: 1,
    source: 'rtsports',
    deviceId,
    pageUrl: location.href,
    syncedAt: new Date().toISOString(),
    pageTitle: document.title,
    sections,
    rawText: document.body?.innerText?.slice(0, 50000) ?? '',
  });
  console.info(`Fantasy Edge discovered ${sections.length} commissioner settings sections.`);
  return true;
}

async function runCollector() {
  await syncConfigIfPresent();
  const rosterRows = document.querySelectorAll('.player-row');
  if (!rosterRows.length) {
    console.debug(`Fantasy Edge: no supported roster rows on ${window.location.pathname}; skipping roster collection.`);
    return;
  }
  try {
    const roster = parseRoster();
    const optimized = optimizeLineup(roster);
    const currentProjectedPoints = currentStarterProjection(roster);
    const optimizedProjectedPoints = optimized.projectedPoints;
    const projectedGain = optimizedProjectedPoints - currentProjectedPoints;
    console.group('Fantasy Edge Summary');
    console.log('Players Parsed:', roster.length);
    console.log('Current Projection:', currentProjectedPoints.toFixed(2));
    console.log('Optimized Projection:', optimizedProjectedPoints.toFixed(2));
    console.log('Potential Gain:', projectedGain.toFixed(2));
    console.groupEnd();
    (window as any).fantasyEdge = { roster, optimized, summary: { currentProjectedPoints, optimizedProjectedPoints, projectedGain } };
    const deviceId = await getDeviceId();
    send('FANTASY_EDGE_SYNC_ROSTER', {
      schemaVersion: 1,
      source: 'rtsports',
      deviceId,
      pageUrl: window.location.href,
      syncedAt: new Date().toISOString(),
      fantasyTeam: roster.find(player => player.fantasyTeam)?.fantasyTeam ?? null,
      roster,
      optimized,
    });
    console.info(`Fantasy Edge synced ${roster.length} players.`);
  } catch (error) { console.error('Fantasy Edge Error', error); }
}

void runCollector();
