/**
 * What a screen's keys and mouse do, as rows of the table `KeyHelp` shows
 * behind a button in its footer.
 */

/** One row of the table: what to press, and what it does. */
export interface KeyRow {
    readonly keys: string;
    readonly does: string;
}

/** What the Battle and Skirmish routes add, where a battle can be wound back and given orders. */
export const ORDER_KEYS: readonly KeyRow[] = [
    { keys: ", (comma)", does: "Step back once, paused" },
    { keys: "Shift-click, Shift-drag", does: "Pick more ships of the same side, or take one back" },
    { keys: "Double-click a ship", does: "Pick every ship of its design on its side" },
    { keys: "A", does: "Pick the picked ship's whole side" },
    {
        keys: "Right-click a ship",
        does: "Order the picked ships to attack it, if an enemy, or defend it, if a friend, at the hold and speed on the order bar; Ctrl to add to their orders",
    },
    { keys: "Right-click an asteroid", does: "Order the picked ships with claws to mine it; Ctrl to add to their orders" },
    { keys: "K, D, R, H", does: "Attack, defend, ram or dock with the next ship clicked; Ctrl to add to their orders" },
    { keys: "G, U", does: "Scavenge from, or deliver to, the next ship clicked; an asteroid is scavenged too" },
    { keys: "W", does: "Flee the next enemy clicked, or hide behind the next friend or wreck, until told otherwise" },
    {
        keys: "Enter",
        does: "Dock, scavenge or deliver without a target, wherever their doctrine would go; or flee every enemy",
    },
    { keys: "S", does: "Stop: clear the picked ships' orders, back to doctrine" },
    { keys: "P", does: "Open or close their doctrine; with one ship, click a mount to tell it alone" },
];

/** The keys and mouse every battle view answers to, from `battleView`. */
export const BATTLE_KEYS: readonly KeyRow[] = [
    { keys: "Space", does: "Pause, or play" },
    { keys: ". (full stop)", does: "Step once, paused" },
    { keys: "F", does: "Frame everything again, or the picked ship and its target" },
    { keys: "Ctrl+A", does: "Cycle the arcs drawn: none, where each gun can point, where it will fire (amber when on target)" },
    { keys: "C", does: "Colour rounds and beams by the side that fired them, or draw them as light" },
    { keys: "T", does: "Hide or show each side's ships down the edges" },
    { keys: "Escape", does: "Let the picked ship go" },
    { keys: "Drag", does: "Pan" },
    { keys: "Scroll or pinch", does: "Zoom" },
    {
        keys: "Click or tap a ship",
        does: "Pick it out: its target marked with the range to it, only its arcs drawn, and it or its target shown close up in a window when off screen or too small",
    },
    { keys: "Click a window or tile", does: "Pick its ship and frame it" },
];
