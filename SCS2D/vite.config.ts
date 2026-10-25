import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import wyw from "@wyw-in-js/vite";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const root = fileURLToPath(new URL(".", import.meta.url));

/**
 * The React app, built to `dist/app.html` as one file with nothing external, so
 * it opens from disk: browsers will not load a module script from `file://`.
 * The pages `scripts/build.ts` bundles are written to the same folder, and the
 * dev server serves them beside the app, so over `localhost` they all share
 * its storage.
 */
export default defineConfig(({ command }) => ({
    root: "app",
    publicDir: command === "serve" ? "../dist" : false,
    resolve: { alias: { "~": root } },
    plugins: [react(), wyw({ include: ["**/*.{ts,tsx}"] }), viteSingleFile()],
    build: {
        outDir: "../dist",
        emptyOutDir: false,
        rolldownOptions: { input: fileURLToPath(new URL("app/app.html", import.meta.url)) },
    },
    // `root` is app/, but the app imports from across the project, and Storybook and Vitest serve their own files from it.
    server: { open: "/app.html", fs: { allow: [root] } },
}));
