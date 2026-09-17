// PARKED — a one-off tool, kept because the question recurs. See notes/README.md.
//
// "Did this change move any ship?" answered exactly rather than by eye: it
// compiles all the authored blueprints on two checkouts and compares every
// derived figure with `Object.is`, so a difference in the last bit is a
// difference. It is what showed the thruster-origin change to be bit-identical
// across nine ships, where the golden checksums only say that the battles came
// out the same.
//
// To use it: `git worktree add /tmp/before <ref>`, point the two import pairs
// below at this checkout and that one, then `npx tsx notes/compare-designs.mts`.
// The paths are absolute because the two trees are the point — it cannot be
// written with relative imports.

import { compileBlueprint as compileNew } from '/home/user/SpaceCombatSimulation/SCS2D/sim/blueprint.js';
import { BLUEPRINTS as NEW } from '/home/user/SpaceCombatSimulation/SCS2D/scenarios/blueprints.js';
import { compileBlueprint as compileOld } from '/tmp/claude-0/before/SCS2D/sim/blueprint.js';
import { BLUEPRINTS as OLD } from '/tmp/claude-0/before/SCS2D/scenarios/blueprints.js';

let worst = 0;
let identical = true;
for (const name of Object.keys(NEW) as (keyof typeof NEW)[]) {
  const a = compileOld(OLD[name]!);
  const b = compileNew(NEW[name]!);
  const diff = (x: number, y: number): void => {
    if (!Object.is(x, y)) identical = false;
    worst = Math.max(worst, Math.abs(x - y));
  };
  diff(a.mass, b.mass);
  diff(a.inertia, b.inertia);
  diff(a.radius, b.radius);
  diff(a.centreOfMassX, b.centreOfMassX);
  diff(a.centreOfMassY, b.centreOfMassY);
  for (let i = 0; i < a.modules.length; i++) {
    diff(a.modules[i]!.x, b.modules[i]!.x);
    diff(a.modules[i]!.y, b.modules[i]!.y);
    diff(a.modules[i]!.angle, b.modules[i]!.angle);
  }
  for (let i = 0; i < a.thrusters.length; i++) {
    diff(a.thrusters[i]!.x, b.thrusters[i]!.x);
    diff(a.thrusters[i]!.y, b.thrusters[i]!.y);
    diff(a.thrusters[i]!.maxThrust, b.thrusters[i]!.maxThrust);
  }
  for (let i = 0; i < a.turrets.length; i++) {
    diff(a.turrets[i]!.mount.leftArc, b.turrets[i]!.mount.leftArc);
    diff(a.turrets[i]!.mount.rightArc, b.turrets[i]!.mount.rightArc);
  }
  console.log(name.padEnd(22), a.modules.length, 'modules', identical ? 'identical so far' : 'DIFFERS');
}
console.log(identical ? 'every compiled figure is bit-identical' : `largest difference ${worst}`);
