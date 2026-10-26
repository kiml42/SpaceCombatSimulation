import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import wyw from "@wyw-in-js/vite";
import { defineConfig, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const root = fileURLToPath(new URL(".", import.meta.url));

/** The pages `scripts/build.ts` bundles into `dist/`, until each has moved into the app. */
const OLD_PAGES = ["/evolution.html", "/skirmish.html"];

/**
 * The React app, built to `dist/index.html` as one file with nothing external,
 * so it opens from disk: browsers will not load a module script from `file://`.
 * The pages `scripts/build.ts` bundles are written to the same folder, and the
 * dev server serves them beside the app, so over `localhost` they all share
 * its storage. Only those pages: `dist/` also holds the app as last built, which
 * must not stand in for the one being served.
 */
function oldPages(): Plugin {
    return {
        name: "old-pages",
        configureServer(server) {
            server.middlewares.use((request, response, next) => {
                const path = request.url?.split(/[?#]/)[0] ?? "";
                if (!OLD_PAGES.includes(path)) return next();
                response.setHeader("Content-Type", "text/html");
                response.end(readFileSync(fileURLToPath(new URL(`dist${path}`, import.meta.url))));
            });
        },
    };
}

export default defineConfig({
    root: "app",
    publicDir: false,
    resolve: { alias: { "~": root } },
    plugins: [react(), wyw({ include: ["**/*.{ts,tsx}"] }), viteSingleFile(), oldPages()],
    build: {
        outDir: "../dist",
        emptyOutDir: false,
        rolldownOptions: { input: fileURLToPath(new URL("app/index.html", import.meta.url)) },
    },
    // `root` is app/, but the app imports from across the project, and Storybook and Vitest serve their own files from it.
    server: { open: "/", fs: { allow: [root] } },
});
