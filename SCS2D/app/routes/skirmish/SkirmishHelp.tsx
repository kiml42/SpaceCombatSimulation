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

/** Where it is kept that the player has been told what each turn of a skirmish means, so each opens by itself only once. */
export const SKIRMISH_LOSS_HELP_KEY = "scs2d.help.skirmishLoss";
export const SKIRMISH_WIN_HELP_KEY = "scs2d.help.skirmishWin";
export const SKIRMISH_CARD_HELP_KEY = "scs2d.help.skirmishCard";
export const SKIRMISH_ROUND_HELP_KEY = "scs2d.help.skirmishRound";

/** How a round is fought, the first time one is shown. */
export function SkirmishRoundHelp({ open, onClose }: SkirmishHelpProps) {
    return (
        <HelpDialog id="skirmishRoundHelp" title="Fighting a round" open={open} onClose={onClose}>
            <p>Your fleet against the enemy's. The panel shows what each costs against the budget.</p>
            <ul>
                <li>
                    <strong>Fight</strong> starts the battle. Your ships fight by their doctrine on their own.
                </li>
                <li>
                    You can also give orders: click one of your ships to pick it, then right-click an enemy to attack it. The menu (◀ Menu,
                    or Escape) lists every key.
                </li>
                <li>
                    You win once the enemy has nothing left to fight with, or goes too long without firing. Running out of time is a draw,
                    and a draw counts as a loss.
                </li>
                <li>
                    <strong>Edit fleet</strong> changes your ships and their designs, within the budget.
                </li>
            </ul>
        </HelpDialog>
    );
}

/** What losing a round means, the first time. */
export function SkirmishLossHelp({ open, onClose }: SkirmishHelpProps) {
    return (
        <HelpDialog id="skirmishLossHelp" title="Round lost" open={open} onClose={onClose}>
            <p>A round is fought until you win it, as many times as it takes. A draw counts as a loss.</p>
            <ul>
                <li>
                    <strong>Edit fleet</strong> to change your ships, their designs or their orders, then fight again;{" "}
                    <strong>Restart</strong> fights it again as it is.
                </li>
                <li>
                    Each <em>different</em> fleet that loses the round counts towards an <strong>upgrade card</strong>. Losing again with
                    the same fleet does not.
                </li>
                <li>Every battle is kept in the History, to watch again.</li>
            </ul>
        </HelpDialog>
    );
}

/** What winning a round sets off, the first time. */
export function SkirmishWinHelp({ open, onClose }: SkirmishHelpProps) {
    return (
        <HelpDialog id="skirmishWinHelp" title="Round won" open={open} onClose={onClose}>
            <p>Now the enemy adapts: it evolves fleets until one beats yours, and that is the next round.</p>
            <ul>
                <li>
                    You may first <strong>pick where to fight next</strong>: each place changes the battle the next round is fought in.
                </li>
                <li>
                    The History shows it evolving. <strong>Watch the best so far</strong> to see its best yet fight your fleet. If it
                    stalls, it draws upgrade cards of its own.
                </li>
                <li>
                    Once it has an answer, <strong>Next round</strong> starts it. Your fleet carries over, for you to change to beat the
                    answer.
                </li>
            </ul>
        </HelpDialog>
    );
}

/** What an upgrade card is, the first time a hand is dealt. */
export function SkirmishCardHelp({ open, onClose }: SkirmishHelpProps) {
    return (
        <HelpDialog id="skirmishCardHelp" title="Upgrade cards" open={open} onClose={onClose}>
            <p>A card changes the limits your fleet is built to, for the rest of the skirmish.</p>
            <ul>
                <li>Most raise one: more metal, fuel or build time, another ship, or room to deploy wider. Some trade one for another.</li>
                <li>Each card you pick adds to those before it.</li>
                <li>
                    <strong>Continue watching</strong> puts the choice off to see the battle out. The hand waits, and you pick before you
                    fight again.
                </li>
            </ul>
        </HelpDialog>
    );
}
