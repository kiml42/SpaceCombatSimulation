import { spawn } from "node:child_process";

/**
 * Both builds on every save: the pages `build.ts` bundles, and the React app
 * from Vite's dev server, which serves those pages beside it. Served from one
 * origin, they share storage, as the files opened from disk do not on Firefox.
 */
const children = [
    spawn("tsx", ["scripts/build.ts", "--watch"], { stdio: "inherit", shell: true }),
    spawn("vite", [], { stdio: "inherit", shell: true }),
];

for (const child of children) {
    child.on("exit", (code) => {
        for (const other of children) other.kill();
        process.exitCode = code ?? 1;
    });
}
