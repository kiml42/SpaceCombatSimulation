import { HelpDialog } from "~/features/help/Help";

/** Where it is kept that the player has seen how to build a fleet, so it opens by itself only once. */
export const FLEET_HELP_KEY = "scs2d.help.fleet";
export const FLEET_HELP_LABEL = "Building your fleet";

export interface FleetHelpProps {
    readonly open: boolean;
    readonly onClose: () => void;
    /** In a skirmish, which has an area to keep within, a budget, and a round to go back to. */
    readonly skirmish: boolean;
}

/** Only what a first fleet needs: the rest of the editor can be found as it is wanted. */
export function FleetHelp({ open, onClose, skirmish }: FleetHelpProps) {
    return (
        <HelpDialog id="fleetHelp" title={FLEET_HELP_LABEL} open={open} onClose={onClose}>
            <ol>
                <li>
                    <strong>Click Add new ship</strong>, which takes you to the ship editor to design it. You can also add one you already
                    have, with Add saved ship or Add from file.
                </li>
                <li>
                    <strong>Arrange them{skirmish ? " inside the dashed circle" : ""}.</strong> Drag a ship to move it, or drag its knob to
                    turn it.
                </li>
                {skirmish && (
                    <li>
                        <strong>Stay within budget.</strong> The Budget panel shows each limit, and turns red when you are over.
                    </li>
                )}
            </ol>
            <p>{skirmish ? "When it is ready, go Back to Skirmish to fight." : "When it is ready, Test in Simulator to see it fight."}</p>
        </HelpDialog>
    );
}
