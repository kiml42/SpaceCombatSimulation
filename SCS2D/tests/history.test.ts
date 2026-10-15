import { describe, expect, it } from 'vitest';
import { serialiseFleet, shipFleet } from '../sim/index.js';
import { CORVETTE, GUNSHIP } from '../scenarios/blueprints.js';
import {
  chains,
  dropOldest,
  EMPTY_HISTORY,
  fleetId,
  fleetOf,
  parseHistory,
  record,
  type History,
  type Played,
} from '../scenarios/history.js';

const gunship = shipFleet(GUNSHIP);
const corvette = shipFleet(CORVETTE);
const bigger = { ...gunship, name: 'Gunship II', ships: [...gunship.ships, { ...gunship.ships[0]!, x: 200 }] };

const play = (history: History, kind: Played['kind'], winner: number, player = gunship, enemy = corvette, generation?: number): History =>
  record(history, { kind, round: 1, seed: 7, winner, player, enemy, ...(generation === undefined ? {} : { generation }) });

describe('the skirmish history', () => {
  it('keeps a fleet used twice once', () => {
    let history = play(EMPTY_HISTORY, 'try', 1);
    history = play(history, 'try', 1);
    expect(Object.keys(history.fleets)).toHaveLength(2);
    expect(history.rows[0]!.player).toBe(history.rows[1]!.player);
    expect(fleetId(serialiseFleet(gunship))).toBe(history.rows[0]!.player);
  });

  it("numbers the player's fleet by its changes and the enemy's by its answers", () => {
    let history = play(EMPTY_HISTORY, 'try', 1);
    history = play(history, 'try', 1);
    history = play(history, 'try', 0, bigger);
    history = play(history, 'search', 0, bigger, corvette, 1);
    history = play(history, 'answer', 1, bigger, gunship);
    history = play(history, 'try', 1, bigger, gunship);
    expect(history.rows.map((row) => [row.kind, row.playerVersion, row.enemyVersion])).toEqual([
      ['try', 1, 1],
      ['try', 1, 1],
      ['try', 2, 1],
      ['search', 2, 2],
      ['answer', 2, 2],
      ['try', 2, 2],
    ]);
  });

  it("runs matches the same side lost into chains, a draw being the player's loss", () => {
    let history = play(EMPTY_HISTORY, 'try', 1);
    history = play(history, 'try', -1);
    history = play(history, 'try', 0);
    history = play(history, 'search', 0);
    history = play(history, 'answer', 1);
    expect(chains(history.rows)).toEqual([
      { loser: 0, start: 0, end: 2 },
      { loser: 1, start: 2, end: 4 },
      { loser: 0, start: 4, end: 5 },
    ]);
  });

  it("makes room by letting go of the oldest chain's fleets, never the last", () => {
    let history = play(EMPTY_HISTORY, 'try', 1, bigger, corvette);
    history = play(history, 'try', 0, gunship, corvette);
    history = play(history, 'answer', 1, gunship, bigger);
    const smaller = dropOldest(history)!;
    expect(smaller.rows[0]!.player).toBeNull();
    expect(smaller.rows[0]!.playerName).toBe('Gunship II');
    // The corvette is still used by a later row, and kept.
    expect(fleetOf(smaller, smaller.rows[1]!.enemy)?.name).toBe(corvette.name);
    expect(Object.keys(smaller.fleets)).toHaveLength(3);
    const smallest = dropOldest(smaller)!;
    expect(smallest.rows[1]!.enemy).toBeNull();
    expect(dropOldest(smallest)).toBeNull();
    expect(fleetOf(smallest, smallest.rows[2]!.enemy)?.name).toBe('Gunship II');
  });

  it('reads back what it wrote, and nothing from what it cannot read', () => {
    const history = play(EMPTY_HISTORY, 'try', 1);
    expect(parseHistory(JSON.parse(JSON.stringify(history)))).toEqual(history);
    expect(parseHistory('nonsense')).toEqual(EMPTY_HISTORY);
  });
});
