import { styled } from "@linaria/react";
import { fighterBarred, type ShipModuleKind } from "~/sim/index";
import { Button } from "~/ui/buttons/Button";
import { MODULE_GROUPS, sentence } from "./shipFields";

const Group = styled.div`
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    align-items: center;
    margin-bottom: 0.4rem;

    h3 {
        flex: 0 0 100%;
        margin: 0.2rem 0 0;
        color: var(--colour-muted);
        font-size: var(--font-size-small);
        font-weight: 400;
    }
`;

/** The core alone, across the panel: a ship has to have one, so it is the first thing to know about. */
const Core = styled.div`
    margin-bottom: 0.4rem;

    > button {
        width: 100%;
    }
`;

/** Shut beneath what is selected, its heading the way to open it. */
const Fold = styled.details`
    > summary {
        cursor: pointer;
        list-style: none;
    }

    > summary::-webkit-details-marker {
        display: none;
    }

    > summary h2::before {
        content: "▸ ";
    }

    &[open] > summary h2::before {
        content: "▾ ";
    }
`;

export interface AddModuleProps {
    /** The assembly a new module goes into, if one is selected. */
    readonly into: string | null;
    /** A fighter has no turrets. */
    readonly fighter: boolean;
    readonly onAdd: (kind: ShipModuleKind) => void;
    /** The kind to add next, shown as the thing to do: a blank ship's core. */
    readonly suggest?: ShipModuleKind | null;
    /** Folded under its heading, as below a selected module's settings, with whether it is open. */
    readonly folded?: { readonly open: boolean; readonly onToggle: (open: boolean) => void };
}

/** A button for each kind of module, by what it is for. */
export function AddModule({ into, fighter, onAdd, suggest = null, folded }: AddModuleProps) {
    const heading = <h2 id="addHeading">{into === null ? "Add a module" : `Add a module to ${into}`}</h2>;
    const buttons = (
        <>
            <Core>
                <Button
                    data-add="core"
                    title="The ship's control compartment: every ship needs one"
                    variant={suggest === "core" ? "primary" : "plain"}
                    onClick={() => onAdd("core")}
                >
                    Core
                </Button>
            </Core>
            {MODULE_GROUPS.map((group) => (
                <Group key={group.title}>
                    <h3>{group.title}</h3>
                    {group.kinds.map(({ kind, label, title }) => (
                        <Button
                            key={kind}
                            data-add={kind}
                            title={fighter && fighterBarred(kind) !== null ? `${sentence(fighterBarred(kind)!)}.` : title}
                            variant={kind === suggest ? "primary" : "plain"}
                            disabled={fighter && fighterBarred(kind) !== null}
                            onClick={() => onAdd(kind)}
                        >
                            {label}
                        </Button>
                    ))}
                </Group>
            ))}
        </>
    );
    if (folded === undefined)
        return (
            <section>
                {heading}
                {buttons}
            </section>
        );
    return (
        <Fold id="addFolded" open={folded.open} onToggle={(event) => folded.onToggle(event.currentTarget.open)}>
            <summary>{heading}</summary>
            {buttons}
        </Fold>
    );
}
