import { build, context, type BuildOptions, type OutputFile } from 'esbuild';
import { watch as watchDir } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Bundle each page into one self-contained HTML file in `dist/`.
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

/**
 * The pages, each its own bundle.
 *
 * The editor is a separate page rather than a panel on the battle view
 * because its inputs and outputs are both blueprints: it needs to know
 * nothing about a battle in progress, so there is no shared clock and no
 * snapshot stream to route between them. Two bundles is the cost, and it is
 * the smaller half of the trade.
 */
const PAGES = [
  { entry: 'entry.ts', shell: 'index.html', out: 'index.html' },
  { entry: 'editorEntry.ts', shell: 'editor.html', out: 'editor.html' },
] as const;

type Page = (typeof PAGES)[number];

function optionsFor(page: Page): BuildOptions {
  return {
    entryPoints: [join(root, 'host', page.entry)],
    bundle: true,
    format: 'iife',
    target: 'es2022',
    minify: true,
    write: false,
    legalComments: 'none',
  };
}

/** Wrap a bundle in its page shell and write it out. */
async function emit(page: Page, files: readonly OutputFile[] | undefined): Promise<void> {
  const js = files?.[0]?.text;
  if (js === undefined) throw new Error('esbuild produced no output');

  // A script tag cannot contain `</script>`, and the bundle is going inside
  // one. Nothing puts that string in there today; a string literal one day
  // would, and the browser's complaint would be about HTML rather than about
  // the code that caused it.
  if (js.includes('</script')) {
    throw new Error('the bundle contains `</script`, which would close the tag it is inlined into');
  }

  const html = await readFile(join(root, 'host', page.shell), 'utf8');
  // The replacement is a *function*, and it has to be. Given a string,
  // `replace` reads `$&`, `$\``, `$'` and `$1` in it as instructions rather
  // than as text — so a bundle containing `$&` anywhere gets the matched
  // `</body>` spliced into the middle of its own source. That is not
  // hypothetical: minified code is full of `$` identifiers, so `x > $ && y`
  // becomes `x>$&&y`, and whether it happens at all depends on which name the
  // minifier hands out this build. A function replacement is given no such
  // interpretation.
  const document = html.replace('</body>', () => `  <script>${js}</script>\n  </body>`);

  const out = join(root, 'dist', page.out);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, document, 'utf8');

  const kb = (document.length / 1024).toFixed(1);
  const stamp = new Date().toLocaleTimeString('en-GB');
  console.log(`${stamp}  dist/${page.out}  ${kb} kB  (one file, nothing external)`);
}

if (process.argv.includes('--watch')) {
  const contexts = await Promise.all(
    PAGES.map(async (page) =>
      context({
        ...optionsFor(page),
        plugins: [
          {
            name: 'emit-html',
            setup(builder) {
              builder.onEnd(async (result) => {
                // esbuild reports its own errors and keeps watching, so a failed
                // build leaves the last good page in place rather than deleting it.
                if (result.errors.length === 0) await emit(page, result.outputFiles);
              });
            },
          },
        ],
      }),
    ),
  );
  await Promise.all(contexts.map((ctx) => ctx.watch()));

  // esbuild watches what it bundles, which is the TypeScript. The page shells
  // are not inputs to any bundle, so they need watching separately or edits to
  // the markup appear to do nothing. A shell is rebuilt through its own page's
  // context, so editing one page's markup does not rewrite the other.
  watchDir(join(root, 'host'), (_event, file) => {
    PAGES.forEach((page, i) => {
      if (file === page.shell) void contexts[i]!.rebuild();
    });
  });

  console.log('watching — edit and save, then refresh the page. Ctrl+C to stop.');
} else {
  for (const page of PAGES) {
    const result = await build(optionsFor(page));
    await emit(page, result.outputFiles);
  }
}
