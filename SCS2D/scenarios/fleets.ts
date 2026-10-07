import { parseFleet, type Fleet } from '../sim/index.js';
import lineOfBattleFile from './fleets/line-of-battle.json' with { type: 'json' };
import rebelFleetFile from './fleets/rebel-fleet.json' with { type: 'json' };
import imperialFleetFile from './fleets/imperial-fleet.json' with { type: 'json' };

/** The stock fleets, parsed as a player's file would be. */
export const LINE_OF_BATTLE: Fleet = parseFleet(lineOfBattleFile);
export const REBEL_FLEET: Fleet = parseFleet(rebelFleetFile);
export const IMPERIAL_FLEET: Fleet = parseFleet(imperialFleetFile);

export const FLEETS: Readonly<Record<string, Fleet>> = {
  [LINE_OF_BATTLE.name]: LINE_OF_BATTLE,
  [REBEL_FLEET.name]: REBEL_FLEET,
  [IMPERIAL_FLEET.name]: IMPERIAL_FLEET,
};
