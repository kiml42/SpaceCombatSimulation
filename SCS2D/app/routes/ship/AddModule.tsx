import { styled } from "@linaria/react";
import type { ShipModuleKind } from "~/sim/index";
import { Button } from "~/ui/buttons/Button";

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

const GROUPS: readonly { title: string; kinds: readonly { kind: ShipModuleKind; label: string; title?: string }[] }[] = [
    {
        title: "Structural",
        kinds: [
            { kind: "structure", label: "Structure" },
            { kind: "tank", label: "Tank" },
            { kind: "hold", label: "Hold", title: "A box of metal that the guns on its piece of hull load their rounds from" },
        ],
    },
    {
        title: "Power",
        kinds: [
            {
                kind: "generator",
                label: "Generator",
                title: "A plant that makes power for as long as it works, filling the batteries on its piece of hull",
            },
            {
                kind: "battery",
                label: "Battery",
                title: "A store of charge, filled by generators and drawn on by beams. Holds more the bigger it is, and passes power faster the more edge it has",
            },
            {
                kind: "robotBay",
                label: "Robot bay",
                title: "Berths for robots that crawl the hull mending damage, carrying out metal and charge from this piece of hull and coming back for more. Berths more the bigger it is",
            },
        ],
    },
    { title: "Propulsion", kinds: [{ kind: "engine", label: "Engine" }] },
    {
        title: "Weapons",
        kinds: [
            { kind: "turret", label: "Turret" },
            { kind: "beamTurret", label: "Beam turret" },
            { kind: "hullGun", label: "Hull gun" },
            {
                kind: "railGun",
                label: "Rail gun",
                title: "A hull gun whose rails throw solid shot twice as fast, on power rather than fuel. It does not train: the hull aims it",
            },
            { kind: "hullBeam", label: "Hull beam" },
            {
                kind: "plasmaLance",
                label: "Plasma lance",
                title: "Two prongs that throw a pulse of fuel, white hot, a short way and hard. Wider hits harder on more fuel; longer reaches further on more power. It kicks back as it fires",
            },
        ],
    },
    {
        title: "Docking",
        kinds: [
            { kind: "claw", label: "Claw", title: "Jaws and a pump on the bow, to drink from wrecks and disarmed enemies" },
            { kind: "pad", label: "Pad", title: "A deck a friendly fighter lands on, to be filled from this ship's tanks" },
            {
                kind: "port",
                label: "Port",
                title: "A coupling on the hull's side, to dock face to face with a friend's port and share fuel",
            },
            {
                kind: "slipway",
                label: "Slipway",
                title: "A shipyard in the hull, building the ship it names bow first out of its face, from this ship's metal and charge",
            },
        ],
    },
];

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
            {GROUPS.map((group) => (
                <Group key={group.title}>
                    <h3>{group.title}</h3>
                    {group.kinds.map(({ kind, label, title }) => (
                        <Button
                            key={kind}
                            data-add={kind}
                            title={title}
                            variant={kind === suggest ? "primary" : "plain"}
                            disabled={fighter && (kind === "turret" || kind === "beamTurret")}
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
