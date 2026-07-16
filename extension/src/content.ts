import { parseRoster } from './roster-parser';
import { optimizeLineup } from '../../shared/optimizer/lineup-optimizer';

console.clear();

console.log(
  '%cFantasy Edge',
  'font-size:18px;font-weight:bold;color:#2563eb;'
);

try {
  const roster = parseRoster();

  const optimized = optimizeLineup(roster);

  console.group('Fantasy Edge Summary');

  console.log(
    'Current Projection:',
    optimized.currentProjectedPoints.toFixed(2)
  );

  console.log(
    'Optimized Projection:',
    optimized.optimizedProjectedPoints.toFixed(2)
  );

  console.log(
    'Potential Gain:',
    optimized.projectedGain.toFixed(2)
  );

  console.groupEnd();

  console.group('Recommended Lineup');

  console.table(
    optimized.lineup.map(slot => ({
      Slot: slot.slot,
      Player: slot.player.name,
      Position: slot.player.position,
      Team: slot.player.nflTeam,
      Projection: slot.player.projection,
      Score:
        slot.player.adjustedProjection ??
        slot.player.projection
    }))
  );

  console.groupEnd();

  console.group('Recommended Changes');

  console.table(
    optimized.changes.map(change => ({
      Start: change.recommended.name,
      Bench: change.current.name,
      Gain: change.projectedGain.toFixed(2)
    }))
  );

  console.groupEnd();

  // Expose for debugging
  (window as any).fantasyEdge = {
    roster,
    optimized
  };

} catch (error) {
  console.error('Fantasy Edge Error', error);
}