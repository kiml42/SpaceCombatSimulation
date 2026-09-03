import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Enforces the simulation's purity by scanning its source.
 *
 * `sim/tsconfig.json` already makes DOM and Node types unavailable in there,
 * which stops most violations at compile time. This catches the rest — chiefly
 * `Math.sin` and friends, which type-check perfectly well and quietly destroy
 * reproducibility (DESIGN.md non-negotiables 1 and 3).
 *
 * If one of these fails, the import or the call is the problem. Do not relax
 * the rule to make it pass.
 */

const simDir = fileURLToPath(new URL('../sim', import.meta.url));

/** The one file allowed to touch `Math`, because its job is to replace it. */
const MATH_MODULE = 'math.ts';

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Strip comments so that documentation discussing a forbidden API does not
 * trip the scan. Crude — it does not understand strings containing comment
 * markers — which is fine for our own source, and a false positive would be
 * obvious.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const files = sourceFiles(simDir).map((path) => ({
  path,
  name: relative(simDir, path).replace(/\\/g, '/'),
  code: stripComments(readFileSync(path, 'utf8')),
}));

describe('simulation purity', () => {
  it('finds the simulation sources', () => {
    expect(files.length).toBeGreaterThan(4);
    expect(files.map((f) => f.name)).toContain(MATH_MODULE);
  });

  it('does not reference Math outside the maths module', () => {
    const offenders = files
      .filter((f) => f.name !== MATH_MODULE && /\bMath\s*\./.test(f.code))
      .map((f) => {
        const hits = f.code.match(/\bMath\s*\.\w+/g) ?? [];
        return `${f.name}: ${[...new Set(hits)].join(', ')}`;
      });
    // Import the safe wrappers from ./math.js instead. The implementation-
    // defined functions (sin, cos, atan2, pow, exp, log, hypot) have no safe
    // wrapper because they are reimplemented there.
    expect(offenders).toEqual([]);
  });

  it('does not use the implementation-defined Math functions anywhere', () => {
    // Belt and braces: even math.ts must not call these, since reimplementing
    // them is the entire reason it exists.
    const banned = /\bMath\s*\.\s*(sin|cos|tan|asin|acos|atan|atan2|exp|log|log2|log10|pow|hypot|cbrt|sinh|cosh|tanh|random)\b/;
    const offenders = files.filter((f) => banned.test(f.code)).map((f) => f.name);
    expect(offenders).toEqual([]);
  });

  it('does not reach for the host environment', () => {
    const banned: [RegExp, string][] = [
      [/\bwindow\b/, 'window'],
      [/\bdocument\b/, 'document'],
      [/\bconsole\b/, 'console'],
      [/\bprocess\b/, 'process'],
      [/\bglobalThis\b/, 'globalThis'],
      [/\bsetTimeout\b/, 'setTimeout'],
      [/\bsetInterval\b/, 'setInterval'],
      [/\brequestAnimationFrame\b/, 'requestAnimationFrame'],
      [/\bperformance\s*\./, 'performance'],
      [/\bDate\s*\./, 'Date'],
      [/\bnew\s+Date\b/, 'new Date'],
      [/\blocalStorage\b/, 'localStorage'],
      [/\bfetch\s*\(/, 'fetch'],
      [/\bpostMessage\b/, 'postMessage'],
      [/\bself\b/, 'self'],
    ];
    const offenders: string[] = [];
    for (const f of files) {
      for (const [pattern, label] of banned) {
        if (pattern.test(f.code)) offenders.push(`${f.name}: ${label}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('imports nothing from outside sim/', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const imports = f.code.match(/from\s+['"]([^'"]+)['"]/g) ?? [];
      for (const raw of imports) {
        const spec = raw.replace(/^from\s+['"]/, '').replace(/['"]$/, '');
        // Relative paths must not escape sim/, and there are no package
        // dependencies: the simulation stands alone.
        if (spec.startsWith('../')) offenders.push(`${f.name}: ${spec}`);
        else if (!spec.startsWith('./')) offenders.push(`${f.name}: ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('uses extensioned relative imports so the ESM resolves unbundled', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const imports = f.code.match(/from\s+['"](\.[^'"]+)['"]/g) ?? [];
      for (const raw of imports) {
        const spec = raw.replace(/^from\s+['"]/, '').replace(/['"]$/, '');
        if (!spec.endsWith('.js')) offenders.push(`${f.name}: ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
