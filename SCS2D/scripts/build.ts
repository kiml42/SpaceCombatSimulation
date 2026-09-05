import { build, context, type BuildOptions, type OutputFile } from 'esbuild';
import { watch as watchDir } from 'node:fs';
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
 * `--watch` rebuilds on save, so tinkering costs a browser refresh rather than
 * a command. That is the whole of it: no dev server, no live reload, no asset
 * pipeline. The line this file must not cross is drawn in DESIGN.md §9, and it
 * is aimed at tooling that has to be understood before the game can be worked
 * on. Rebuilding the same bundle when a file changes does not qualify;
 * anything that needs configuring, or that puts a process between the author
 * and the output, does.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const shell = join(root, 'host', 'index.html');
const out = join(root, 'dist', 'index.html');

const options: BuildOptions = {
  entryPoints: [join(root, 'host', 'entry.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: true,
  write: false,
  legalComments: 'none',
};

/** Wrap the bundle in the page shell and write it out. */
async function emit(files: readonly OutputFile[] | undefined): Promise<void> {
  const js = files?.[0]?.text;
  if (js === undefined) throw new Error('esbuild produced no output');

  const html = await readFile(shell, 'utf8');
  const page = html.replace('</body>', `  <script>${js}</script>\n  </body>`);

  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, page, 'utf8');

  const kb = (page.length / 1024).toFixed(1);
  const stamp = new Date().toLocaleTimeString('en-GB');
  console.log(`${stamp}  dist/index.html  ${kb} kB  (one file, nothing external)`);
}

if (process.argv.includes('--watch')) {
  const ctx = await context({
    ...options,
    plugins: [
      {
        name: 'emit-html',
        setup(builder) {
          builder.onEnd(async (result) => {
            // esbuild reports its own errors and keeps watching, so a failed
            // build leaves the last good page in place rather than deleting it.
            if (result.errors.length === 0) await emit(result.outputFiles);
          });
        },
      },
    ],
  });
  await ctx.watch();

  // esbuild watches what it bundles, which is the TypeScript. The page shell is
  // not an input to the bundle, so it needs watching separately or edits to the
  // markup appear to do nothing.
  watchDir(dirname(shell), (_event, file) => {
    if (file === 'index.html') void ctx.rebuild();
  });

  console.log('watching — edit and save, then refresh the page. Ctrl+C to stop.');
} else {
  const result = await build(options);
  await emit(result.outputFiles);
}
