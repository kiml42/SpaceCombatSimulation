import { styled } from "@linaria/react";
import { useSyncExternalStore, type ReactNode } from "react";
import { useStorage } from "~/features/storage/StorageContext";
import { FOLDED_KEY } from "./evolutionSetup";

const Details = styled.details`
    summary {
        cursor: pointer;
        list-style: none;
    }

    summary::-webkit-details-marker {
        display: none;
    }

    summary::before {
        display: inline-block;
        width: 0.9rem;
        color: var(--colour-faint);
        content: "▸";
    }

    &[open] > summary::before {
        content: "▾";
    }

    h2 {
        display: inline-block;
        margin: 1.1rem 0 0.4rem;
        color: #7f93aa;
        font-size: var(--font-size-small);
        font-weight: 400;
        letter-spacing: 0.08em;
        text-transform: uppercase;
    }
`;

const folded = (raw: string | null): Set<string> => {
    try {
        return new Set(JSON.parse(raw ?? "[]") as string[]);
    } catch {
        // Unreadable is as good as nothing folded.
        return new Set();
    }
};

export interface FoldProps {
    /** What its folding is kept under. */
    readonly k: string;
    readonly title: ReactNode;
    /** Whether it starts open, before it has been folded or unfolded. */
    readonly open?: boolean;
    readonly children: ReactNode;
}

/** A card of the page that folds away, and stays as it was left between visits. */
export function Fold({ k, title, open = true, children }: FoldProps) {
    const storage = useStorage();
    const raw = useSyncExternalStore(storage.subscribe, () => storage.getItem(FOLDED_KEY));
    const shut = folded(raw).has(k);
    // Unfolded is kept as the absence of a key, so a card that starts folded is kept open as `!key`.
    const isOpen = open ? !shut : folded(raw).has(`!${k}`);
    return (
        <Details
            data-key={k}
            open={isOpen}
            onToggle={(event) => {
                const now = event.currentTarget.open;
                if (now === isOpen) return;
                const next = folded(storage.getItem(FOLDED_KEY));
                const key = open ? k : `!${k}`;
                if (now === open) next.delete(key);
                else next.add(key);
                try {
                    storage.setItem(FOLDED_KEY, JSON.stringify([...next]));
                } catch {
                    // Costs the folding, not the run.
                }
            }}
        >
            <summary>
                <h2>{title}</h2>
            </summary>
            {children}
        </Details>
    );
}
