import { parseRoster } from './roster-parser';
import { optimizeLineup } from '../../shared/optimizer/lineup-optimizer';

console.clear();
console.log('%cFantasy Edge', 'font-size:18px;font-weight:bold;color:#2563eb;');

async function getDeviceId(): Promise<string> {
  const existing = await chrome.storage.local.get('fantasyEdgeDeviceId');
  if (existing.fantasyEdgeDeviceId) return existing.fantasyEdgeDeviceId as string;

  const deviceId = crypto.randomUUID();
  await chrome.storage.local.set({ fantasyEdgeDeviceId: deviceId });
  return deviceId;
}

function playerScore(player: ReturnType<typeof parseRoster>[number]): number {
  return player.projection ?? player.averagePoints ?? 0;
}

function currentStarterProjection(roster: ReturnType<typeof parseRoster>): number {
  return roster
    .filter((player) => player.rosterGroup === 'starter')
    .reduce((total, player) => total + playerScore(player), 0);
}

async function syncRoster(roster: ReturnType<typeof parseRoster>, optimized: ReturnType<typeof optimizeLineup>) {
  if (!roster.length) {
    console.warn('Fantasy Edge found no RTSports roster rows on this page.');
    return;
  }

  const deviceId = await getDeviceId();
  const fantasyTeam = roster.find((player) => player.fantasyTeam)?.fantasyTeam ?? null;

  const payload = {
    schemaVersion: 1,
    source: 'rtsports',
    deviceId,
    pageUrl: window.location.href,
    syncedAt: new Date().toISOString(),
    fantasyTeam,
    roster,
    optimized,
  };

  chrome.runtime.sendMessage(
    { type: 'FANTASY_EDGE_SYNC_ROSTER', payload },
    (response) => {
      if (chrome.runtime.lastError) {
        console.warn('Fantasy Edge sync failed', chrome.runtime.lastError.message);
        return;
      }

      if (response?.ok) {
        console.info(`Fantasy Edge synced ${roster.length} players.`);
      } else {
        console.warn('Fantasy Edge sync not stored yet', response);
      }
    },
  );
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

  console.group('Recommended Lineup');
  console.table(
    optimized.lineup.map((slot) => ({
      Slot: slot.slot,
      Player: slot.player.name,
      Position: slot.player.position,
      Team: slot.player.nflTeam,
      Projection: slot.player.projection,
      Score: slot.player.adjustedProjection ?? slot.player.projection ?? slot.player.averagePoints ?? 0,
    })),
  );
  console.groupEnd();

  console.group('Recommended Changes');
  console.table(
    optimized.changes.map((change) => ({
      Start: change.add.name,
      Bench: change.remove?.name ?? 'Open slot',
      Gain: change.projectedGain.toFixed(2),
    })),
  );
  console.groupEnd();

  (window as any).fantasyEdge = {
    roster,
    optimized,
    summary: {
      currentProjectedPoints,
      optimizedProjectedPoints,
      projectedGain,
    },
  };

  void syncRoster(roster, optimized);
} catch (error) {
  console.error('Fantasy Edge Error', error);
}
