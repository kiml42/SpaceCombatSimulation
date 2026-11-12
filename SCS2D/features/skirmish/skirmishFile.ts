import type { History } from "~/scenarios/history";
import { serialiseSkirmish, skirmishFileName, type Skirmish, type SkirmishSettings } from "~/scenarios/skirmish";

/** Save a skirmish to a file the Skirmish page's import reads back. */
export function downloadSkirmish(setup: SkirmishSettings, skirmish: Skirmish | null, history: History): void {
    const file = {
        about:
            "A skirmish exported from the Skirmish page: the settings on the setup screen, the skirmish under way " +
            "(round, budget, both fleets and the settings it started with) if there is one, and the history of every " +
            "match played, its fleets kept by id.",
        setup,
        skirmish: skirmish === null ? null : serialiseSkirmish(skirmish),
        history,
    };
    download(skirmishFileName(skirmish), `${JSON.stringify(file, null, 2)}\n`);
}

/** Hand the player a JSON file to save. */
export function download(name: string, text: string): void {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
}

/** What a skirmish is called where one is offered: its name, or a stand-in. */
export function skirmishTitle(skirmish: Skirmish): string {
    return skirmish.name ?? "Unnamed skirmish";
}

/** Where a skirmish has got to, in a line. */
export function skirmishStatus(skirmish: Skirmish): string {
    const round = `Round ${skirmish.round}`;
    if (skirmish.ways !== undefined) return `${round} won · pick where to fight next`;
    if (skirmish.won !== undefined) return `${round} won · the enemy is adapting`;
    return `${round}${skirmish.tries > 0 ? ` · try ${skirmish.tries + 1}` : ""} · against ${skirmish.enemy.name}`;
}
