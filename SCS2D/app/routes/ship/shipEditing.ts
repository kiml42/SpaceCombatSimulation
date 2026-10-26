import type { EditorDocument } from "~/editor/document";
import type { Blueprint } from "~/sim/index";

/** What a panel of the ship editor edits through. */
export interface ShipEditing {
    readonly doc: EditorDocument;
    /**
     * Apply an edit, or nothing for null. One that `continues` amends the edit
     * before it while the same gesture goes on — holding an arrow key, typing a
     * number — so the whole gesture is one undo step.
     */
    change(next: Blueprint | null, continues?: boolean): void;
    /** After the document was changed or selected in some other way: show it. */
    refresh(): void;
    /** The gesture is over; the next edit is an undo step of its own. */
    endGesture(): void;
    /** The grid a drag snaps to, metres, which a box's arrows step by. */
    snapMetres(): number;
}
