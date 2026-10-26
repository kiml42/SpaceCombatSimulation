import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import wyw from "@wyw-in-js/vite";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const root = fileURLToPath(new URL(".", import.meta.url));

/**
 * The app, built to `dist/index.html` as one file with nothing external, so it
 * opens from disk: browsers will not load a module script from `file://`.
 */
export default defineConfig({
    root: "app",
    publicDir: false,
    resolve: { alias: { "~": root } },
    plugins: [react(), wyw({ include: ["**/*.{ts,tsx}"] }), viteSingleFile()],
    build: {
        outDir: "../dist",
        emptyOutDir: false,
        rolldownOptions: { input: fileURLToPath(new URL("app/index.html", import.meta.url)) },
    },
    // `root` is app/, but the app imports from across the project, and Storybook and Vitest serve their own files from it.
    server: { open: "/", fs: { allow: [root] } },
});
