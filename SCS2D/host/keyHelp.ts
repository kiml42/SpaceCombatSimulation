/**
 * A page's keys and mouse, behind a button in its footer: a table of what to
 * press and what it does, opened over the page, rather than a paragraph that
 * outgrows the footer as each control is added. `?` opens it too.
 */

/** One row of the table: what to press, and what it does. */
export interface KeyRow {
    readonly keys: string;
    readonly does: string;
}

const STYLE = `
  dialog.keyHelp {
    background: #101722;
    color: #c8d3e0;
    border: 1px solid #2a3647;
    border-radius: 6px;
    padding: 0.9rem 1.1rem;
    max-width: min(42rem, 92vw);
    max-height: 85vh;
    overflow: auto;
    font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  dialog.keyHelp::backdrop { background: rgba(0, 0, 0, 0.55); }
  dialog.keyHelp h2 { font-size: 13px; margin: 0 0 0.6rem; color: #e6edf5; }
  dialog.keyHelp table { border-collapse: collapse; width: 100%; }
  dialog.keyHelp td { padding: 0.2rem 0; vertical-align: top; border-top: 1px solid #1c2533; }
  dialog.keyHelp td:first-child { white-space: nowrap; padding-right: 1.2rem; color: #e6edf5; }
  dialog.keyHelp p { margin: 0.7rem 0 0; color: #8193a8; }
  dialog.keyHelp .close { float: right; }
`;

/**
 * Put a button in `footer`, in place of whatever it held, that opens `rows`
 * as a table with `notes` under it. Returns the button.
 */
export function keyHelp(footer: HTMLElement, rows: readonly KeyRow[], notes: readonly string[] = []): HTMLButtonElement {
    if (document.getElementById("keyHelpStyle") === null) {
        const style = document.createElement("style");
        style.id = "keyHelpStyle";
        style.textContent = STYLE;
        document.head.append(style);
    }

    const dialog = document.createElement("dialog");
    dialog.className = "keyHelp";
    dialog.id = "keyHelp";
    const close = document.createElement("button");
    close.className = "close";
    close.textContent = "Close";
    close.addEventListener("click", () => dialog.close());
    const title = document.createElement("h2");
    title.textContent = "Keys and mouse";
    const table = document.createElement("table");
    for (const row of rows) {
        const tr = table.insertRow();
        tr.insertCell().textContent = row.keys;
        tr.insertCell().textContent = row.does;
    }
    dialog.append(close, title, table);
    for (const note of notes) {
        const p = document.createElement("p");
        p.textContent = note;
        dialog.append(p);
    }
    // A click on the backdrop lands on the dialog itself, outside its box.
    dialog.addEventListener("click", (event) => {
        if (event.target === dialog) dialog.close();
    });
    // Keys pressed while it is open are for it, not the page under it; Escape still closes it.
    dialog.addEventListener("keydown", (event) => event.stopPropagation());
    document.body.append(dialog);

    const button = document.createElement("button");
    button.id = "keysButton";
    button.textContent = "Keys";
    button.title = "What each key and mouse action does (?)";
    button.addEventListener("click", () => dialog.showModal());
    footer.replaceChildren(button);

    window.addEventListener("keydown", (event) => {
        if (event.key !== "?" || dialog.open) return;
        const active = document.activeElement;
        if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement) return;
        dialog.showModal();
    });
    return button;
}

/** What the scenarios page adds, where a battle can be wound back and given orders. */
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

/** The keys and mouse every battle view answers to, from `battleView` and the evolution page alike. */
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
