import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Bundle the viewer into one self-contained HTML file in `dist/`.
 *
 * Everything is inlined — no separate script, no imports at runtime — because
 * the two places this gets looked at both want a single file: a static host
 * with nothing to configure, and a preview page whose content policy blocks
 * external scripts outright.
 *
 * This is a build for *looking at*, not a production pipeline. It has no dev
 * server, no watch mode and no asset handling, and should not grow them: the
 * anti-recommendation in DESIGN.md §9 is aimed squarely at this file.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const bundled = await build({
  entryPoints: [join(root, 'host', 'entry.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: true,
  write: false,
  legalComments: 'none',
});

const js = bundled.outputFiles[0]?.text;
if (js === undefined) throw new Error('esbuild produced no output');

const html = await readFile(join(root, 'host', 'index.html'), 'utf8');
const out = html.replace('</body>', `  <script>${js}</script>\n  </body>`);

await mkdir(join(root, 'dist'), { recursive: true });
await writeFile(join(root, 'dist', 'index.html'), out, 'utf8');

const kb = (out.length / 1024).toFixed(1);
console.log(`dist/index.html  ${kb} kB  (one file, nothing external)`);
