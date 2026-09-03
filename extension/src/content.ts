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

async function syncRoster(roster: ReturnType<typeof parseRoster>, optimized: ReturnType<typeof optimizeLineup>) {
  if (!roster.length) return;

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

  console.group('Fantasy Edge Summary');
  console.log('Current Projection:', optimized.currentProjectedPoints.toFixed(2));
  console.log('Optimized Projection:', optimized.optimizedProjectedPoints.toFixed(2));
  console.log('Potential Gain:', optimized.projectedGain.toFixed(2));
  console.groupEnd();

  console.group('Recommended Lineup');
  console.table(
    optimized.lineup.map((slot) => ({
      Slot: slot.slot,
      Player: slot.player.name,
      Position: slot.player.position,
      Team: slot.player.nflTeam,
      Projection: slot.player.projection,
      Score: slot.player.adjustedProjection ?? slot.player.projection,
    })),
  );
  console.groupEnd();

  console.group('Recommended Changes');
  console.table(
    optimized.changes.map((change) => ({
      Start: change.recommended.name,
      Bench: change.current.name,
      Gain: change.projectedGain.toFixed(2),
    })),
  );
  console.groupEnd();

  (window as any).fantasyEdge = { roster, optimized };
  void syncRoster(roster, optimized);
} catch (error) {
  console.error('Fantasy Edge Error', error);
}
