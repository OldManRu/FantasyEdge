import { parseRoster } from './roster-parser';
import { optimizeLineup } from '../../shared/optimizer/lineup-optimizer';

console.clear();

console.log(
  '%cFantasy Edge',
  'font-size:18px;font-weight:bold;color:#2563eb;'
);

try {
  const roster = parseRoster();

  console.log('Roster');
  console.table(
    roster.map(player => ({
      Group: player.rosterGroup,
      Slot: player.lineupSlot,
      Name: player.name,
      Pos: player.position,
      Team: player.nflTeam,
      Proj: player.projection
    }))
  );

  console.log('Calling optimizer...');

  const optimized = optimizeLineup(roster);

  console.log('Optimizer complete.');

  console.table(
    optimized.lineup.map(slot => ({
      Slot: slot.slot,
      Player: slot.player.name,
      Projection: slot.player.projection
    }))
  );

  console.table(
    optimized.changes.map(change => ({
      Slot: change.slot,
      Start: change.add.name,
      Bench: change.remove?.name,
      Gain: change.projectedGain
    }))
  );

  (window as any).fantasyEdge = {
    roster,
    optimized
  };

  console.log('FantasyEdge object attached to window.');
} catch (err) {
  console.error('Fantasy Edge crashed:', err);
}