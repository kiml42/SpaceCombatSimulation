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

const GROUPS: readonly { title: string; kinds: readonly { kind: ShipModuleKind; label: string; title?: string }[] }[] = [
    {
        title: "Structural",
        kinds: [
            { kind: "core", label: "Core" },
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
            { kind: "hullBeam", label: "Hull beam" },
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
}

/** A button for each kind of module, by what it is for. */
export function AddModule({ into, fighter, onAdd }: AddModuleProps) {
    return (
        <section>
            <h2 id="addHeading">{into === null ? "Add a module" : `Add a module to ${into}`}</h2>
            {GROUPS.map((group) => (
                <Group key={group.title}>
                    <h3>{group.title}</h3>
                    {group.kinds.map(({ kind, label, title }) => (
                        <Button
                            key={kind}
                            data-add={kind}
                            title={title}
                            disabled={fighter && (kind === "turret" || kind === "beamTurret")}
                            onClick={() => onAdd(kind)}
                        >
                            {label}
                        </Button>
                    ))}
                </Group>
            ))}
        </section>
    );
}
