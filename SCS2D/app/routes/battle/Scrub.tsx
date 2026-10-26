import { styled } from "@linaria/react";
import { useEffect, useRef, useState } from "react";
import { useSampled } from "~/features/battle/useSampled";
import type { BattleView } from "~/host/battleView";

const Range = styled.input`
    flex: 1 1 8rem;
    min-width: 6rem;
    max-width: 24rem;
`;

/** Winds the battle back or on. Held, it pauses the battle, and the thumb stays where it is dragged. */
export function Scrub({ view }: { readonly view: BattleView | null }) {
    const reached = useSampled(() => view?.reached ?? 0);
    const at = useSampled(() => view?.at ?? 0);
    const [dragged, setDragged] = useState<number | null>(null);
    const resume = useRef(false);
    const dragging = dragged !== null;

    // Let go anywhere, not only over the bar.
    useEffect(() => {
        if (!dragging) return;
        const release = (): void => {
            setDragged(null);
            if (resume.current) view?.setRunning(true);
        };
        window.addEventListener("pointerup", release);
        return () => window.removeEventListener("pointerup", release);
    }, [dragging, view]);

    return (
        <Range
            type="range"
            aria-label="Wind the battle back or on"
            min={0}
            max={reached}
            value={dragged ?? at}
            onPointerDown={() => {
                resume.current = view?.running ?? false;
                view?.setRunning(false);
                setDragged(at);
            }}
            onChange={(event) => {
                const step = Number(event.target.value);
                if (dragging) setDragged(step);
                view?.seek(step);
            }}
        />
    );
}
