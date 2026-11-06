import { styled } from "@linaria/react";
import { kg } from "~/editor/budget";
import { buildTime } from "~/editor/stats";
import { billOfFleet, enemyLimits, fleetFault, playerLimits, type Skirmish } from "~/scenarios/skirmish";
import { fleetHulls, fleetReach, math, type Fleet } from "~/sim/index";
import type { Limits } from "~/skirmish/cards";
import { ResourceWord } from "./Cards";

const Table = styled.table`
    width: 100%;
    border-collapse: collapse;

    th,
    td {
        padding: 0.1rem 0 0.1rem 0.6rem;
        vertical-align: top;
    }

    thead th {
        color: var(--colour-muted);
        font-weight: 400;
        text-align: right;
    }

    tbody th {
        padding-left: 0;
        color: var(--colour-muted);
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
`;

/** What a fleet uses of each limit, or null for one that cannot be priced. */
interface Used {
    readonly metal: number;
    readonly fuel: number;
    readonly build: number;
    readonly ships: number;
    readonly spread: number;
}

function usedBy(fleet: Fleet): Used | null {
    if (fleetFault(fleet) !== null) return null;
    const bill = billOfFleet(fleet);
    const hulls = fleetHulls(fleet);
    return { ...bill, ships: hulls.length, spread: fleetReach(hulls) };
}

const ROWS = [
    { key: "metal", show: kg },
    { key: "fuel", show: kg },
    { key: "build", show: buildTime },
    { key: "ships", show: (n: number) => String(n) },
    { key: "spread", show: (m: number) => `${math.round(m)} m` },
] as const;

function limitOf(limits: Limits, key: (typeof ROWS)[number]["key"]): number {
    return key === "ships" ? limits.maxShips : key === "spread" ? limits.radius : limits.budget[key];
}

/** Both sides' limits, and what each fleet uses of them: the player's own, moved by their cards, and the enemy's. */
export function BudgetTable({ skirmish, id }: { readonly skirmish: Skirmish; readonly id?: string }) {
    const sides = [
        { side: "player", used: usedBy(skirmish.player), limits: playerLimits(skirmish) },
        { side: "enemy", used: usedBy(skirmish.enemy), limits: enemyLimits(skirmish) },
    ] as const;
    return (
        <Table id={id}>
            <thead>
                <tr>
                    <td />
                    <th scope="col">You</th>
                    <th scope="col">Enemy</th>
                </tr>
            </thead>
            <tbody>
                {ROWS.map(({ key, show }) => {
                    const player = sides[0];
                    const over = player.used !== null && player.used[key] > limitOf(player.limits, key) + 1e-9;
                    return (
                        <tr key={key} className={over ? "over" : undefined} data-over={over || undefined}>
                            <th scope="row">
                                {key === "metal" || key === "fuel" || key === "build" ? <ResourceWord resource={key} /> : key}
                            </th>
                            {sides.map(({ side, used, limits }) => (
                                <td key={side} className={side}>
                                    <span>{used === null ? "—" : show(used[key])}</span> <small>{`/ ${show(limitOf(limits, key))}`}</small>
                                </td>
                            ))}
                        </tr>
                    );
                })}
            </tbody>
        </Table>
    );
}
