import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { BLUEPRINT_DIR, syncFleetsAndLog } from "./syncFleets.js";

/**
 * Vite's dev server for the app, with the stock fleets kept in step with the
 * blueprints they embed: synced on start, and again whenever a blueprint is
 * saved. Editors fire several events a save, hence the debounce.
 */
await syncFleetsAndLog();
let syncTimer: ReturnType<typeof setTimeout> | undefined;
watch(BLUEPRINT_DIR, () => {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => void syncFleetsAndLog(), 100);
});

const vite = spawn("vite", [], { stdio: "inherit", shell: true });
vite.on("exit", (code) => process.exit(code ?? 1));
