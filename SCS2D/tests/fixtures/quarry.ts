import { compileBlueprint } from '../../sim/index.js';

/**
 * An unarmed enemy core, for a fighter to have a target and so leave its pad
 * once it has nothing more to take on. Put it abeam, so one leaving for it
 * does not cross the path of one coming in.
 */
export const QUARRY = compileBlueprint({ name: 'Quarry', modules: [{ kind: 'core', x: 0, y: 0, length: 6, width: 6 }] });

/** A `sortieRange` that sends a fighter for a target however far off. */
export const ANY_RANGE = 1000;
