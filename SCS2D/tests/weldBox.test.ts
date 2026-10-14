import { describe, expect, it } from 'vitest';
import { compileBlueprint, isHullMount, moduleCentre, onWeldablePart, weldBox, type DesignModule } from '../sim/index.js';
import { DINKY, GUNSHIP } from '../scenarios/blueprints.js';

/**
 * A slow ragged contact welds only on the part of a module a layout could be
 * attached by: not an engine's bell or a hull mount's barrel.
 */

const POSE = { x: 40, y: -15, angle: 0.7 };

/** A point `along` metres down the module's own axis from its centre, in the world. */
function pointOn(module: DesignModule, along: number): { x: number; y: number } {
  const c = Math.cos(POSE.angle);
  const s = Math.sin(POSE.angle);
  const own = POSE.angle + module.angle;
  return {
    x: POSE.x + module.x * c - module.y * s + along * Math.cos(own),
    y: POSE.y + module.x * s + module.y * c + along * Math.sin(own),
  };
}

function weldable(module: DesignModule, along: number): boolean {
  const p = pointOn(module, along);
  return onWeldablePart(module, POSE.x, POSE.y, POSE.angle, p.x, p.y);
}

describe('where a ragged contact may weld', () => {
  const modules = [...compileBlueprint(DINKY).modules, ...compileBlueprint(GUNSHIP).modules];
  const mounted = modules.filter((m) => m.spec.kind === 'engine' || isHullMount(m.spec.kind));

  it('has engines and hull mounts to test', () => {
    expect(mounted.some((m) => m.spec.kind === 'engine')).toBe(true);
    expect(mounted.some((m) => isHullMount(m.spec.kind))).toBe(true);
  });

  it('welds the block of an engine or hull mount, and not its bell or barrel', () => {
    for (const module of mounted) {
      const half = module.spec.length / 2 - 0.01;
      // Which end the block is at, from where weldBox puts its middle.
      const whole = moduleCentre(module.spec);
      const part = moduleCentre(weldBox(module.spec));
      const toBlock = (part.x - whole.x) * Math.cos(module.angle) + (part.y - whole.y) * Math.sin(module.angle);
      expect(toBlock, module.spec.kind).not.toBe(0);
      const sign = Math.sign(toBlock);
      expect(weldable(module, sign * half), `${module.spec.kind} block end`).toBe(true);
      expect(weldable(module, -sign * half), `${module.spec.kind} outer end`).toBe(false);
    }
  });

  it('welds anything else anywhere', () => {
    for (const module of modules.filter((m) => !mounted.includes(m))) {
      expect(weldable(module, module.spec.length / 2)).toBe(true);
      expect(weldable(module, -module.spec.length / 2)).toBe(true);
    }
  });
});
