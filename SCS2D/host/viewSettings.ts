import type { Arcs } from '../render/canvas2d.js';

/**
 * How a page shows a battle, kept between visits: which arcs are drawn (`A`),
 * whether shots are in their side's colours (`C`), and the speed.
 *
 * Per page, since their defaults differ. Kept in the browser only, and read
 * and written inside a try, since storage can be missing or refused: a page
 * that cannot remember simply starts from its defaults.
 */
export interface ViewSettings {
  arcs: Arcs;
  teamShots: boolean;
  speed: number;
}

const ARCS: readonly Arcs[] = ['none', 'firing', 'trigger'];

export function loadView(page: string, defaults: ViewSettings): ViewSettings {
  try {
    const raw = window.localStorage.getItem(key(page));
    if (raw === null) return { ...defaults };
    const kept = JSON.parse(raw) as Partial<Record<keyof ViewSettings, unknown>>;
    return {
      arcs: ARCS.includes(kept.arcs as Arcs) ? (kept.arcs as Arcs) : defaults.arcs,
      teamShots: typeof kept.teamShots === 'boolean' ? kept.teamShots : defaults.teamShots,
      speed: typeof kept.speed === 'number' && kept.speed > 0 ? kept.speed : defaults.speed,
    };
  } catch {
    return { ...defaults };
  }
}

export function saveView(page: string, settings: ViewSettings): void {
  try {
    window.localStorage.setItem(key(page), JSON.stringify(settings));
  } catch {
    // Not remembered, which costs a visit its settings and nothing else.
  }
}

/**
 * A speed list showing the kept speed, if it is one of its own, and saving
 * whatever is picked. Returns the speed it shows.
 */
export function keepSpeed(select: HTMLSelectElement, page: string, settings: ViewSettings): number {
  const wanted = String(settings.speed);
  if ([...select.options].some((option) => option.value === wanted)) select.value = wanted;
  select.addEventListener('change', () => {
    settings.speed = Number(select.value);
    saveView(page, settings);
  });
  return Number(select.value);
}

function key(page: string): string {
  return `scs2d.view.${page}`;
}
