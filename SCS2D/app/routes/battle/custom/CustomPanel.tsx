import { styled } from "@linaria/react";
import { useRef, useState } from "react";
import { mapFields } from "~/host/mapFields";
import { battleFragment } from "~/scenarios/battleLink";
import type { Logged } from "~/scenarios/commands";
import { parseBattleSetup, serialiseBattleSetup, type BattleSetup, type CustomBattle } from "~/scenarios/customBattle";
import type { MapKey } from "~/sim/index";
import { NumberField } from "~/ui/fields/NumberField";
import { fieldsOf, setupOf, slotsOf, type SetupFields, type Slot } from "./customSetup";
import { FleetSlots } from "./FleetSlots";
import { Sides } from "./Sides";
import { Button } from "~/ui/buttons/Button";

const Panel = styled.aside`
    width: 22rem;
    max-width: 45vw;
    overflow-y: auto;
    padding: 0.6rem 0.9rem;
    border-left: 1px solid var(--colour-border);

    h2 {
        margin: 1rem 0 0.4rem;
        color: var(--colour-heading);
        font-size: var(--font-size-small);
        font-weight: 600;
        text-transform: uppercase;
    }

    h2:first-child {
        margin-top: 0;
    }
`;

const Buttons = styled.div`
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.6rem;
`;

const Problem = styled.p`
    margin: 0.4rem 0;
    color: var(--colour-warning);
    white-space: pre-line;
`;

const DRAWN = "How far either side each battle drawn from this setup may be, by its seed. Zero holds it.";

const MAP_ROWS = mapFields("");

export interface CustomPanelProps {
    readonly slots: readonly Slot[];
    readonly fields: SetupFields;
    readonly onChange: (slots: readonly Slot[], fields: SetupFields) => void;
    readonly onFight: () => void;
    /** The battle being fought from this setup, for the sides table, or null. */
    readonly current: () => CustomBattle | null;
    /** The orders given in it so far, for a link to carry. */
    readonly orders: () => readonly Logged[];
}

/** A custom battle's setup — which fleets, how far apart, how fast, what among — and how each side is doing. */
export function CustomPanel({ slots, fields, onChange, onFight, current, orders }: CustomPanelProps) {
    const [problem, setProblem] = useState<string | null>(null);
    const [linked, setLinked] = useState(false);
    const battleFile = useRef<HTMLInputElement>(null);

    const field = (key: Exclude<keyof SetupFields, "map">) => (value: string) => onChange(slots, { ...fields, [key]: value });
    const mapField = (key: MapKey) => (value: string) => onChange(slots, { ...fields, map: { ...fields.map, [key]: value } });
    const adopt = (setup: BattleSetup, from: string): void => onChange(slotsOf(setup, from), fieldsOf(setup));

    const exportSetup = (): void => {
        const text = `${JSON.stringify(serialiseBattleSetup(setupOf(slots, fields)), null, 2)}\n`;
        const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = "custom.battle.json";
        link.click();
        URL.revokeObjectURL(url);
    };

    // The whole battle in the address, for whoever it is sent to.
    const copyLink = async (): Promise<void> => {
        const fragment = await battleFragment(setupOf(slots, fields), orders());
        const href = new URL(`index.html#/battle?battle=${fragment.slice("#battle=".length)}`, window.location.href).href;
        try {
            await navigator.clipboard.writeText(href);
            setLinked(true);
            window.setTimeout(() => setLinked(false), 1500);
        } catch {
            // No clipboard, as on a page opened from a file: shown to be copied by hand.
            window.prompt("A link to this battle:", href);
        }
    };

    return (
        <Panel id="custom" aria-label="Custom battle">
            <h2>Fleets</h2>
            <FleetSlots slots={slots} onChange={(next) => onChange(next, fields)} onProblem={setProblem} />
            {problem !== null && <Problem role="alert">{problem}</Problem>}

            <h2>Setup</h2>
            <NumberField
                id="battleRange"
                label="range m"
                title="Across the ring the fleets start on"
                value={fields.range}
                onChange={field("range")}
                step={100}
                min={1}
                spread={{ id: "battleRangeSpread", value: fields.rangeSpread, onChange: field("rangeSpread"), title: DRAWN }}
            />
            <NumberField
                id="battleClosing"
                label="closing m/s"
                title="Each fleet's own speed towards the centre"
                value={fields.closing}
                onChange={field("closing")}
                step={5}
                min={null}
                spread={{ id: "battleClosingSpread", value: fields.closingSpread, onChange: field("closingSpread"), title: DRAWN }}
            />
            <NumberField
                id="battleCrossing"
                label="crossing m/s"
                title="Each fleet's own speed to its left"
                value={fields.crossing}
                onChange={field("crossing")}
                step={5}
                min={null}
                spread={{ id: "battleCrossingSpread", value: fields.crossingSpread, onChange: field("crossingSpread"), title: DRAWN }}
            />
            <NumberField
                id="battleRotation"
                label="rotation °"
                title="How far each fleet is turned from facing the centre, anticlockwise"
                value={fields.rotation}
                onChange={field("rotation")}
                step={15}
                min={null}
                spread={{ id: "battleRotationSpread", value: fields.rotationSpread, onChange: field("rotationSpread"), title: DRAWN }}
            />
            <NumberField
                id="battleSeed"
                label="seed"
                title="Which of the battles this setup describes"
                value={fields.seed}
                onChange={field("seed")}
                step={1}
                min={null}
            />

            <h2>Asteroids</h2>
            {MAP_ROWS.filter((row) => row.spreadOf === undefined).map((row) => {
                const key = row.name as MapKey;
                const spread = MAP_ROWS.find((other) => other.spreadOf === row.name);
                return (
                    <NumberField
                        key={key}
                        label={row.label}
                        title={row.title}
                        value={fields.map[key]}
                        onChange={mapField(key)}
                        step={row.step}
                        {...(row.max === undefined ? {} : { max: row.max })}
                        {...(spread === undefined
                            ? {}
                            : {
                                  spread: {
                                      value: fields.map[spread.name as MapKey],
                                      onChange: mapField(spread.name as MapKey),
                                      title: spread.title,
                                  },
                              })}
                    />
                );
            })}

            <Buttons>
                <Button
                    id="fight"
                    variant="primary"
                    disabled={slots.length < 1}
                    title={slots.length < 1 ? "Choose a fleet first" : "Start the battle"}
                    onClick={onFight}
                >
                    Fight
                </Button>
                <Button id="exportBattle" title="Save this setup as a battle file" onClick={exportSetup}>
                    Export
                </Button>
                <Button id="importBattle" title="Load a battle file" onClick={() => battleFile.current?.click()}>
                    Import
                </Button>
                <Button id="linkBattle" title="Copy a link that opens this battle, seed and all" onClick={() => void copyLink()}>
                    {linked ? "Copied" : "Link"}
                </Button>
            </Buttons>
            <input
                ref={battleFile}
                id="battleFile"
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file === undefined) return;
                    void file.text().then((text) => {
                        try {
                            adopt(parseBattleSetup(JSON.parse(text)), "file");
                            setProblem(null);
                        } catch (error) {
                            setProblem(`Could not read ${file.name}: ${error instanceof Error ? error.message : String(error)}`);
                        }
                    });
                }}
            />

            <h2>Sides</h2>
            <Sides current={current} />
        </Panel>
    );
}
