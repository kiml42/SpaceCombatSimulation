import { describe, expect, it } from 'vitest';
import { checksumWorld } from '../sim/checksum.js';
import { duel } from '../scenarios/duel.js';
import { Rewind } from '../scenarios/rewind.js';

const stepped = (steps: number): number => {
  const battle = duel();
  for (let i = 0; i < steps; i++) battle.step();
  return checksumWorld(battle.world);
};

describe('rewind', () => {
  it('winds back to the same state as a battle fought only that far, and on again', () => {
    const rewind = new Rewind(duel());
    rewind.seek(300);
    expect(rewind.seek(120)).toBe(true);
    expect(rewind.at).toBe(120);
    expect(rewind.reached).toBe(300);
    expect(checksumWorld(rewind.battle.world)).toBe(stepped(120));
    expect(rewind.seek(250)).toBe(true);
    expect(checksumWorld(rewind.battle.world)).toBe(stepped(250));
  });

  it('winds back as exactly once its checkpoints have thinned', () => {
    const rewind = new Rewind(duel());
    rewind.seek(4000);
    expect(rewind.seek(1234)).toBe(true);
    expect(checksumWorld(rewind.battle.world)).toBe(stepped(1234));
  }, 60_000);

  it('winds back exactly when a clock spaces its checkpoints unevenly', () => {
    const rewind = new Rewind(duel(), () => performance.now());
    rewind.seek(900);
    for (const to of [777, 31, 650, 899]) {
      rewind.seek(to);
      expect(checksumWorld(rewind.battle.world)).toBe(stepped(to));
    }
  }, 60_000);

  it('snaps to a checkpoint or the furthest step reached', () => {
    const rewind = new Rewind(duel());
    rewind.seek(100);
    expect(rewind.snap(40)).toBe(30);
    expect(rewind.snap(50)).toBe(60);
    expect(rewind.snap(97)).toBe(100);
  });

  it('keeps the recent past dense and the distant past sparse', () => {
    const rewind = new Rewind(duel());
    rewind.seek(6000);
    const kept = rewind.kept;
    const gap = (back: number): number => {
      const i = kept.findIndex((step) => step >= 6000 - back);
      return kept[i]! - kept[i - 1]!;
    };
    expect(gap(120)).toBe(30);
    expect(gap(3000)).toBeGreaterThanOrEqual(120);
    expect(gap(3000)).toBeLessThanOrEqual(300);
    expect(kept[0]).toBe(0);
    expect(kept.length).toBeLessThan(60);
  }, 60_000);

  it('goes forward without rebuilding, and back to the furthest step reached', () => {
    const rewind = new Rewind(duel());
    rewind.seek(50);
    const battle = rewind.battle;
    expect(rewind.seek(80)).toBe(false);
    expect(rewind.battle).toBe(battle);
    rewind.seek(10);
    rewind.seek(rewind.reached);
    expect(checksumWorld(rewind.battle.world)).toBe(stepped(80));
  });
});
