import type { EditorDocument } from "~/editor/document";
import { HelpDialog } from "~/features/help/Help";
import type { TourStep } from "~/features/help/Tour";
import { isWeaponMount, type ShipModuleKind } from "~/sim/index";

/** Where it is kept that the player has seen what the ship editor is, so it opens by itself only once. */
export const SHIP_HELP_KEY = "scs2d.help.ship";
export const SHIP_HELP_LABEL = "Designing a ship";

export interface ShipHelpProps {
    readonly open: boolean;
    readonly onClose: () => void;
    readonly onTutorial: () => void;
}

/** What the editor is, in brief, and the way into the tutorial that builds a first ship. */
export function ShipHelp({ open, onClose, onTutorial }: ShipHelpProps) {
    return (
        <HelpDialog
            id="shipHelp"
            title={SHIP_HELP_LABEL}
            open={open}
            onClose={onClose}
            tutorial={{ label: "Start the tutorial", onStart: onTutorial }}
        >
            <ol>
                <li>
                    <strong>A ship is built from modules.</strong> Add them from the left, and drag them into place on the drawing. Select
                    one to change its settings.
                </li>
                <li>
                    <strong>The right shows the design as a whole:</strong> its overall stats, and any problems that stop it from working.
                </li>
                <li>
                    <strong>Save it, or Test in Simulator</strong> to see it in action.
                </li>
            </ol>
            <p>The tutorial builds a first ship with you, one step at a time. You can start it again from ? whenever you like.</p>
        </HelpDialog>
    );
}

/** The tutorial's steps, each done when the design shows it: a first ship from a blank one. */
export function shipTutorial(doc: EditorDocument, inFleet = false): TourStep[] {
    const modules = doc.view.modules;
    const design = doc.view.design;
    const core = modules.find((spec) => spec.kind === "core");
    const engines = modules.filter((spec) => spec.kind === "engine");
    const clear = doc.view.problems.length === 0;
    const flies = design !== null && clear && design.engineLayout.hasFullAuthority();
    return [
        {
            id: "core",
            title: "Add a core",
            body: <p>The core is the ship&apos;s brain: everything it controls has to be within its reach.</p>,
            targets: ['[data-add="core"]'],
            beside: "#selectionPanel",
            goal: { label: "It has a core", done: core !== undefined },
        },
        {
            id: "engine",
            title: "Add an engine",
            body: <p>An engine pushes the ship the way its flame points away from.</p>,
            targets: ['[data-add="engine"]', "#addFolded > summary"],
            beside: "#selectionPanel",
            goal: { label: "It has an engine", done: engines.length > 0 },
        },
        {
            id: "aft",
            title: "Drag the engine behind the core",
            body: (
                <p>
                    Drag it on the drawing until it sits behind the core, touching it. The thrust diagram in the corner shows which way the
                    ship can push.
                </p>
            ),
            // Out of the way of the drawing it is about.
            beside: "#selectionPanel",
            // Behind it, and fitting: overlapping or adrift is a problem.
            goal: {
                label: "An engine is behind the core, and nothing is wrong",
                done: core !== undefined && engines.some((engine) => engine.x < core.x) && clear,
            },
        },
        {
            id: "fly",
            title: "Make it able to fly",
            body: (
                <p>
                    A ship has to push every way and turn both ways. Add more engines, and turn them by their knobs, until Problems says
                    nothing stops it.
                </p>
            ),
            targets: ["#problems"],
            goal: { label: "Nothing stops it flying", done: flies },
        },
        {
            id: "weapon",
            title: "Add a weapon",
            body: <p>A turret is a good start. Arcs, on the drawing, shows where each gun can point and where it will fire.</p>,
            targets: ['[data-add="turret"]', "#addFolded > summary"],
            beside: "#selectionPanel",
            // Placed where it fits, too: a weapon dropped on the hull is a problem.
            goal: { label: "It has a weapon, and nothing is wrong", done: modules.some((spec) => isWeaponMount(spec.kind)) && clear },
        },
        inFleet
            ? {
                  id: "back",
                  title: "Take it back to the fleet",
                  body: (
                      <p>
                          <strong>Back to fleet</strong> puts it in your fleet, where you can place more ships of it.
                      </p>
                  ),
                  targets: ["#backToFleet"],
              }
            : {
                  id: "save",
                  title: "Save it, or try it",
                  body: (
                      <p>
                          <strong>Save</strong> keeps it in your library under My ships. <strong>Test in Simulator</strong> shows it
                          fighting what it fought last time or, the first time, a stock ship of about its mass.
                      </p>
                  ),
                  targets: ["#saveShip"],
              },
    ];
}

/** The module a tutorial step asks for, to be picked out in Add a module. */
export function tutorialSuggests(step: TourStep | undefined): ShipModuleKind | null {
    switch (step?.id) {
        case "core":
            return "core";
        case "engine":
        case "fly":
            return "engine";
        case "weapon":
            return "turret";
        default:
            return null;
    }
}
