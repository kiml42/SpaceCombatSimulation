import { styled } from "@linaria/react";
import type { ReactNode } from "react";
import { enemyLimits, playerLimits, type Skirmish } from "~/scenarios/skirmish";
import { fleetBill, fleetDraftHulls, fleetReach, math, type Fleet } from "~/sim/index";
import type { Limits } from "~/skirmish/cards";
import { CardHand, ResourceWord } from "./Cards";

const Table = styled.table`
    width: 100%;
    border-collapse: collapse;

    /* The sides share what the labels leave equally, whatever their figures. */
    table-layout: fixed;

    col.labels {
        width: 3.2rem;
    }

    &.alone col.labels {
        width: 4.6rem;
    }

    th,
    td {
        padding: 0.1rem 0 0.1rem 0.6rem;
        vertical-align: baseline;
    }

    thead th {
        color: var(--colour-muted);
        font-weight: 400;
        text-align: right;
    }

    /* Small: read the first few times, then known by place. */
    tbody th {
        padding-left: 0;
        color: var(--colour-muted);
        font-size: 0.8em;
        font-weight: 400;
        text-align: left;
    }

    td {
        color: var(--colour-heading);
        text-align: right;
    }

    /* A line may break between what is used and its limit, never inside either. */
    td span,
    td small {
        white-space: nowrap;
    }

    td small {
        color: var(--colour-muted);
        font-size: inherit;
    }

    tr.over td.player {
        color: var(--colour-danger);
    }

    tr.names td {
        padding-bottom: 0.3rem;
        overflow-wrap: anywhere;
    }

    /* A side's cards wrap within its own column, from its right edge like the figures above. */
    tr.cards th,
    tr.cards td {
        padding-top: 0.3rem;
        vertical-align: top;
    }

    /* The label's smaller text, dropped to sit level with "none" or a card's top. */
    tr.cards th {
        padding-top: calc(0.3rem + 0.15em);
    }

    tr.cards [role="group"] {
        justify-content: flex-end;
        margin: 0;
    }

    tr.cards p {
        margin: 0;
    }
`;

/** What a fleet uses of each limit, or null for one that cannot be priced. */
interface Used {
    readonly metal: number;
    readonly fuel: number;
    readonly build: number;
    readonly ships: number;
    readonly spread: number;
}

/** Work in progress priced as it stands, so the figures move as it is built; null only for a fleet that cannot be laid out. */
function usedBy(fleet: Fleet): Used | null {
    try {
        const hulls = fleetDraftHulls(fleet);
        return { ...fleetBill(hulls), ships: hulls.length, spread: fleetReach(hulls) };
    } catch {
        return null;
    }
}

type Show = (n: number) => string;

/** Figures in `size`s of `unit`: whole ones, or to a tenth, or two places below one so a small figure is not shown as 0. */
function inUnit(size: number, unit: string, whole = size === 1): Show {
    return (n) => {
        const v = n / size;
        if (whole) return `${math.round(v)} ${unit}`;
        return `${v.toLocaleString("en-GB", { maximumFractionDigits: v !== 0 && math.abs(v) < 1 ? 2 : 1 })} ${unit}`;
    };
}

/** One unit for a row, picked by its largest figure, so the two sides and their limits read alike. */
const mass = (largest: number): Show => (largest >= 1000 ? inUnit(1000, "t") : inUnit(1, "kg"));
const time = (largest: number): Show => (largest < 90 ? inUnit(1, "s") : largest < 5400 ? inUnit(60, "min", true) : inUnit(3600, "h"));

const ROWS = [
    { key: "metal", unit: mass },
    { key: "fuel", unit: mass },
    { key: "build", unit: time },
    { key: "ships", unit: (): Show => (n) => String(n) },
    { key: "spread", unit: (): Show => inUnit(1, "m") },
    { key: "robots", unit: (): Show => (n) => String(n) },
] as const;

/** A side's limit on a row; build time as the work its robots get through in it, which is what a fleet's build is. */
function limitOf(limits: Limits, key: (typeof ROWS)[number]["key"]): number {
    const robots = limits.robots ?? 1;
    if (key === "robots") return robots;
    if (key === "build") return limits.budget.build * robots;
    return key === "ships" ? limits.maxShips : key === "spread" ? limits.radius : limits.budget[key];
}

/** Both sides' limits, and what each fleet uses of them: the player's own, moved by their cards, and the enemy's. */
export interface BudgetTableProps {
    readonly skirmish: Skirmish;
    readonly id?: string;
    /** The enemy's column beside the player's, where comparing the two helps. */
    readonly enemy?: boolean;
    /** Each side's name, in a row above its figures. */
    readonly names?: { readonly player: ReactNode; readonly enemy: ReactNode };
    /** Each side's upgrade cards, in a row below its figures. */
    readonly cards?: { readonly player: readonly string[]; readonly enemy: readonly string[] };
}

export function BudgetTable({ skirmish, id, enemy = true, names, cards }: BudgetTableProps) {
    const player = { side: "player", used: usedBy(skirmish.player), limits: playerLimits(skirmish) } as const;
    const sides = enemy ? [player, { side: "enemy", used: usedBy(skirmish.enemy), limits: enemyLimits(skirmish) } as const] : [player];
    return (
        <Table id={id} className={enemy ? undefined : "alone"}>
            <colgroup>
                <col className="labels" />
                <col />
                {enemy && <col />}
            </colgroup>
            <thead>
                <tr>
                    <td />
                    <th scope="col">You</th>
                    {enemy && <th scope="col">Enemy</th>}
                </tr>
            </thead>
            <tbody>
                {names !== undefined && (
                    <tr className="names">
                        <th scope="row">fleet</th>
                        <td id="playerName">{names.player}</td>
                        {enemy && <td id="enemyName">{names.enemy}</td>}
                    </tr>
                )}
                {ROWS.map(({ key, unit }) => {
                    // How many robots build it is a limit only, nothing a fleet uses.
                    const usedOf = (used: Used | null): number | null => (key === "robots" || used === null ? null : used[key]);
                    const show = unit(math.max(...sides.flatMap(({ used, limits }) => [usedOf(used) ?? 0, limitOf(limits, key)])));
                    const mine = usedOf(player.used);
                    const over = mine !== null && mine > limitOf(player.limits, key) + 1e-9;
                    return (
                        <tr key={key} className={over ? "over" : undefined} data-over={over || undefined}>
                            <th scope="row">
                                {key === "metal" || key === "fuel" || key === "build" ? <ResourceWord resource={key} long={!enemy} /> : key}
                            </th>
                            {sides.map(({ side, used, limits }) => (
                                <td key={side} className={side}>
                                    {key === "robots" ? (
                                        <span>{show(limitOf(limits, key))}</span>
                                    ) : (
                                        <>
                                            <span>{used === null ? "—" : show(usedOf(used)!)}</span>{" "}
                                            <small>{`/ ${show(limitOf(limits, key))}`}</small>
                                        </>
                                    )}
                                </td>
                            ))}
                        </tr>
                    );
                })}
                {cards !== undefined && (
                    <tr className="cards">
                        <th scope="row">cards</th>
                        <td>
                            <CardHand id="playerCards" ids={cards.player} empty="none" />
                        </td>
                        {enemy && (
                            <td>
                                <CardHand id="enemyCards" ids={cards.enemy} empty="none" />
                            </td>
                        )}
                    </tr>
                )}
            </tbody>
        </Table>
    );
}
