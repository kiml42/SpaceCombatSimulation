import { HelpDialog } from "~/features/help/Help";

/** Where it is kept that the player has seen how a skirmish works, so it opens by itself only once. */
export const SKIRMISH_HELP_KEY = "scs2d.help.skirmish";
export const SKIRMISH_HELP_LABEL = "How a skirmish works";

export interface SkirmishHelpProps {
    readonly open: boolean;
    readonly onClose: () => void;
}

/** What a skirmish is and how to start one: the rest is explained as it comes up in play. */
export function SkirmishHelp({ open, onClose }: SkirmishHelpProps) {
    return (
        <HelpDialog id="skirmishHelp" title={SKIRMISH_HELP_LABEL} open={open} onClose={onClose}>
            <p>An arms race against an enemy that adapts: every time you beat it, it evolves to counter your fleet.</p>
            <ol>
                <li>
                    <strong>Pick an enemy and a battlefield.</strong> What the enemy costs to build is your budget.
                </li>
                <li>
                    <strong>Start, and build a fleet</strong> within that budget to beat it.
                </li>
            </ol>
            <p>You will pick up the rest as you play.</p>
        </HelpDialog>
    );
}
