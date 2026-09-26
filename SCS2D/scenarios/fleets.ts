import { parseFleet, type Fleet } from '../sim/index.js';
import lineOfBattleFile from './fleets/line-of-battle.json' with { type: 'json' };

/** The stock fleets, parsed as a player's file would be. */
export const LINE_OF_BATTLE: Fleet = parseFleet(lineOfBattleFile);

export const FLEETS: Readonly<Record<string, Fleet>> = {
  [LINE_OF_BATTLE.name]: LINE_OF_BATTLE,
};
