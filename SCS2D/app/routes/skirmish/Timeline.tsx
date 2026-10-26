import { styled } from "@linaria/react";
import { useEffect, useEffectEvent, useRef } from "react";
import { timeline, type Timeline as Engine, type TimelineActions } from "~/host/timeline";
import type { History } from "~/scenarios/history";

// The markup is the timeline's own, drawn by `host/timeline.ts`: these are its classes.
const Box = styled.div`
    flex: 1 1 0;
    min-height: 0;
    overflow-y: auto;

    .muted {
        color: var(--colour-muted);
    }

    .pictures {
        display: flex;
        flex-wrap: wrap;
        gap: 0.2rem;
        align-items: center;
    }

    .row-buttons {
        display: flex;
        gap: 0.3rem;
    }

    .match {
        margin: 0.4rem 0;
        padding: 0.4rem;
        border: 1px solid var(--colour-border);
        border-radius: 4px;
    }

    .match.player-won {
        border-left: 3px solid var(--colour-ok);
    }

    .match.enemy-won {
        border-left: 3px solid var(--colour-danger);
    }

    .match.leading {
        border-left: 3px dashed var(--colour-muted);
    }

    .match-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 0.2rem;
        color: var(--colour-muted);
    }

    .match-head button,
    .row-buttons button {
        padding: 0.05rem 0.5rem;
        font-size: 12px;
    }

    .combatant {
        display: grid;
        grid-template-columns: 5.6rem 1fr;
        gap: 0.1rem 0.4rem;
        align-items: center;
        margin: 0.3rem 0;
    }

    .combatant .pictures,
    .combatant .row-buttons,
    .combatant > .muted {
        grid-column: 2;
    }

    .who {
        display: flex;
        flex-wrap: wrap;
        gap: 0.3rem;
        align-items: center;
    }

    .swatch {
        flex: none;
        width: 0.8rem;
        height: 0.8rem;
        border-radius: 2px;
    }

    .stamp {
        grid-row: span 3;
        align-self: start;
        padding: 0.1rem 0.2rem;
        border: 2px solid currentcolor;
        border-radius: 3px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-align: center;
        transform: rotate(-6deg);
    }

    .stamp.won {
        color: var(--colour-ok);
    }

    .stamp.beaten {
        color: var(--colour-danger);
    }

    .stamp.drew {
        color: var(--colour-warning);
    }

    .pictures canvas {
        border-radius: 2px;
        background: var(--colour-background);
    }

    .kind {
        position: relative;
        display: inline-block;
    }

    .kind .count {
        position: absolute;
        right: 2px;
        bottom: 0;
        color: var(--colour-heading);
        font-size: 11px;
    }

    details.chain {
        margin: 0.4rem 0;
    }

    details.chain summary {
        padding: 0.2rem 0.4rem;
        border-radius: 3px;
        background: var(--colour-surface);
        cursor: pointer;
    }

    details.chain summary.player-lost {
        color: var(--colour-danger);
    }

    details.chain summary.enemy-lost {
        color: var(--colour-ok);
    }
`;

export interface TimelineProps extends TimelineActions {
    readonly history: History;
    /** The history with the enemy leading a generation still being fought at its head, or null. */
    readonly leading: History | null;
}

/** Every match of the skirmish, newest first: a box React mounts and leaves to `host/timeline.ts`. */
export function Timeline({ history, leading, watch, save, exportFleet }: TimelineProps) {
    const box = useRef<HTMLDivElement>(null);
    const engine = useRef<Engine | null>(null);
    const onWatch = useEffectEvent(watch);
    const onSave = useEffectEvent(save);
    const onExport = useEffectEvent(exportFleet);

    useEffect(() => {
        const into = box.current!;
        engine.current = timeline(into, { watch: onWatch, save: onSave, exportFleet: onExport });
        return () => {
            engine.current = null;
            into.replaceChildren();
        };
    }, []);
    useEffect(() => engine.current?.show(leading ?? history, leading !== null), [history, leading]);

    return <Box ref={box} id="timeline" />;
}
