import { describe, expect, it } from 'vitest';
import { byContent } from '../sim/byContent.js';

describe('an answer remembered by content', () => {
  it('works out each answer once for equal data, apart for different data, and forgets the least recently asked', () => {
    let asked = 0;
    const sum = byContent(2, (list: number[]) => {
      asked++;
      return list.reduce((a, b) => a + b, 0);
    });
    expect(sum([1, 2])).toBe(3);
    expect(sum([1, 2])).toBe(3);
    expect(asked).toBe(1);
    expect(sum([0])).toBe(0);
    expect(sum([-0])).toBe(0);
    expect(asked).toBe(3);
    // Kept two: [1, 2] was asked least recently, so it is worked out again.
    expect(sum([1, 2])).toBe(3);
    expect(asked).toBe(4);
    expect(sum([-0])).toBe(0);
    expect(asked).toBe(4);
  });

  it('remembers an answer of null', () => {
    let asked = 0;
    const none = byContent(4, (_: { a: number }) => {
      asked++;
      return null;
    });
    none({ a: 1 });
    none({ a: 1 });
    expect(asked).toBe(1);
  });
});
