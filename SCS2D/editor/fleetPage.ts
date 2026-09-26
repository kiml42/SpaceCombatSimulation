import {
  degreesToRadians,
  isGroupUse,
  math,
  parseFleet,
  radiansToDegrees,
  serialiseFleet,
  Snapshot,
  type Blueprint,
  type Fleet,
} from '../sim/index.js';
import { draw } from '../render/canvas2d.js';
import { frame, snapStep, type Camera } from '../render/camera.js';
import { snap } from './edit.js';
import {
  addShip,
  deleteEntries,
  duplicateEntries,
  emptyFleet,
  moveEntries,
  refreshDesign,
  repeatEntry,
  updateEntry,
} from './fleetEdit.js';
import { centreOf, FleetDocument } from './fleetDocument.js';
import { drawFleetOverlay, knobFor } from './fleetOverlay.js';
import { fleetSnapshot } from './fleetPreview.js';
import { HANDLE_GRAB_PX } from './handles.js';
import { FLEET_FILES, Library, nextName, unusedName, type LibraryEntry } from './library.js';

/**
 * The fleet editor page: ships from the library placed, turned and laid out
 * in rows, saved to browser storage and exported as fleet files. Everything
 * it knows about a fleet comes from `FleetDocument`; this is the DOM.
 */

const { atan2, max, sqrt } = math;

const ANGLE_SNAP_DEGREES = 15;
/** Where a stock entry shadowed by a saved one is told apart, as the ship editor does. */
const STOCK = 'stock:';

export function startFleetEditor(): void {
  const canvas = el<HTMLCanvasElement>('view');
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('no 2d context');

  const ships = new Library(window.localStorage);
  const fleets = new Library(window.localStorage, FLEET_FILES);

  /** The library copy of a design, or null if it is unreadable or absent. */
  const lookup = (name: string): Blueprint | null => {
    try {
      return ships.load(name);
    } catch {
      return null;
    }
  };
  const read = (name: string, stock: boolean): Fleet | null => {
    try {
      return stock ? fleets.loadStock(name) : fleets.load(name);
    } catch (error) {
      window.alert(`Could not read the saved ${name}.\n\n${error instanceof Error ? error.message : error}`);
      return null;
    }
  };

  const first = fleets.list()[0];
  const doc = new FleetDocument(
    (first !== undefined ? read(first.name, first.stock) : null) ?? emptyFleet('New fleet'),
    lookup,
  );
  const camera: Camera = { x: 0, y: 0, scale: 1 };
  const snapshot = new Snapshot();
  let fitPending = true;

  const fleetList = el<HTMLSelectElement>('fleet');
  const fleetName = el<HTMLInputElement>('fleetName');
  const fleetNotes = el<HTMLTextAreaElement>('fleetNotes');
  const addDesign = el<HTMLSelectElement>('addDesign');
  const selection = el<HTMLElement>('selection');
  const selectionTitle = el<HTMLElement>('selectionTitle');
  const single = el<HTMLElement>('single');
  const entryX = el<HTMLInputElement>('entryX');
  const entryY = el<HTMLInputElement>('entryY');
  const entryAngle = el<HTMLInputElement>('entryAngle');
  const mirrorRow = el<HTMLElement>('mirrorRow');
  const entryMirror = el<HTMLInputElement>('entryMirror');
  const repeatCount = el<HTMLInputElement>('repeatCount');
  const repeatX = el<HTMLInputElement>('repeatX');
  const repeatY = el<HTMLInputElement>('repeatY');
  const repeatAngle = el<HTMLInputElement>('repeatAngle');
  const repeatButton = el<HTMLButtonElement>('repeatEntry');
  const statsPanel = el<HTMLElement>('stats');
  const problemsPanel = el<HTMLElement>('problems');
  const undoButton = el<HTMLButtonElement>('undo');
  const redoButton = el<HTMLButtonElement>('redo');
  const deleteFleetButton = el<HTMLButtonElement>('deleteFleet');

  const resize = (): void => {
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = max(1, Math.round(rect.width * ratio));
    canvas.height = max(1, Math.round(rect.height * ratio));
  };

  const selectedEntries = () =>
    doc.selection.map((i) => {
      const entry = doc.fleet.ships[i]!;
      return { x: entry.x, y: entry.y, angle: entry.angle ?? 0, reach: doc.reachOf(i), ships: doc.shipsOf(i) };
    });

  const currentKnob = (): { x: number; y: number } | null => {
    if (doc.selection.length !== 1) return null;
    const entry = selectedEntries()[0]!;
    return knobFor(entry.x, entry.y, entry.angle, entry.reach, camera.scale);
  };

  const render = (): void => {
    fleetSnapshot(doc.view, snapshot);
    if (fitPending) {
      frame(camera, snapshot, canvas.width, canvas.height, 1);
      fitPending = false;
    }
    draw(ctx, snapshot, camera, canvas.width, canvas.height);
    drawFleetOverlay(
      ctx,
      {
        hulls: doc.view.hulls,
        circles: doc.view.ships.map((ship, i) => {
          const design = doc.view.designs[i];
          return design == null ? null : { ...centreOf(ship, design), radius: design.radius };
        }),
        faulty: doc.view.faulty,
        selected: selectedEntries(),
        knob: currentKnob(),
      },
      camera,
      canvas.height,
    );
  };

  const optionValue = (entry: LibraryEntry): string =>
    entry.stock && entry.saved ? STOCK + entry.name : entry.name;
  const options = (entries: readonly LibraryEntry[], selected: string | null): string =>
    entries
      .map((entry) => {
        const chosen = entry.name === selected && !(entry.stock && entry.saved);
        const label = entry.stock ? (entry.saved ? ' (stock)' : '') : ' •';
        return (
          `<option value="${escapeHtml(optionValue(entry))}"${chosen ? ' selected' : ''}>` +
          `${escapeHtml(entry.name)}${label}</option>`
        );
      })
      .join('');

  const renderLibraries = (): void => {
    const entries = fleets.list();
    const name = doc.fleet.name;
    fleetList.innerHTML = options(entries, name);
    if (!entries.some((entry) => entry.name === name)) {
      fleetList.insertAdjacentHTML(
        'afterbegin',
        `<option value="${escapeHtml(name)}" selected>${escapeHtml(name)} (unsaved)</option>`,
      );
    }
    deleteFleetButton.disabled = !fleets.savedNames().includes(name);
    const keep = addDesign.value;
    addDesign.innerHTML = options(ships.list(), null);
    if (keep !== '') addDesign.value = keep;
  };

  const kg = (mass: number): string =>
    mass >= 1000 ? `${(mass / 1000).toLocaleString('en-GB', { maximumFractionDigits: 1 })} t` : `${Math.round(mass)} kg`;

  const renderStats = (): void => {
    const view = doc.view;
    const rows = [
      `<tr><th>ships</th><td>${view.ships.length}</td></tr>`,
      `<tr><th>dry mass</th><td>${kg(view.mass)}</td></tr>`,
      ...view.lines.map(
        (line) => `<tr><th>${escapeHtml(line.name)}</th><td>${line.count} × ${kg(line.mass)}</td></tr>`,
      ),
    ];
    statsPanel.innerHTML = `<table>${rows.join('')}</table>`;
  };

  const renderProblems = (): void => {
    const view = doc.view;
    if (view.problems.length === 0) {
      problemsPanel.innerHTML = '<p class="ok">None.</p>';
      return;
    }
    problemsPanel.innerHTML =
      `<ul>${view.problems.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>` +
      view.stale
        .map(
          (name) =>
            `<div class="buttons"><button data-refresh="${escapeHtml(name)}" ` +
            `title="Replace this fleet's copy with the library's">Update ${escapeHtml(name)}</button></div>`,
        )
        .join('');
    for (const button of problemsPanel.querySelectorAll<HTMLButtonElement>('button[data-refresh]')) {
      button.addEventListener('click', () => {
        const blueprint = lookup(button.dataset['refresh']!);
        if (blueprint === null) return;
        doc.apply(refreshDesign(doc.fleet, blueprint));
        refresh();
      });
    }
  };

  const renderSelection = (): void => {
    const picked = doc.selection;
    selection.hidden = picked.length === 0;
    if (picked.length === 0) return;
    const entry = doc.fleet.ships[picked[0]!]!;
    single.hidden = picked.length !== 1;
    repeatButton.hidden = picked.length !== 1;
    selectionTitle.textContent =
      picked.length > 1
        ? `${picked.length} selected`
        : isGroupUse(entry)
          ? `Group: ${entry.group}`
          : `Ship: ${entry.design}`;
    mirrorRow.hidden = !isGroupUse(entry);
    const typing = document.activeElement;
    if (typing !== entryX) entryX.value = String(round(entry.x));
    if (typing !== entryY) entryY.value = String(round(entry.y));
    if (typing !== entryAngle) entryAngle.value = String(round(radiansToDegrees(entry.angle ?? 0)));
    entryMirror.checked = isGroupUse(entry) && entry.mirror === true;
    const step = String(snapStep(camera.scale));
    entryX.step = step;
    entryY.step = step;
  };

  const refresh = (): void => {
    if (document.activeElement !== fleetName) fleetName.value = doc.fleet.name;
    if (document.activeElement !== fleetNotes) fleetNotes.value = doc.fleet.notes ?? '';
    undoButton.disabled = !doc.canUndo;
    redoButton.disabled = !doc.canRedo;
    renderLibraries();
    renderStats();
    renderProblems();
    renderSelection();
    render();
  };

  // ---- the panel ----------------------------------------------------------

  el<HTMLButtonElement>('addShip').addEventListener('click', () => {
    const value = addDesign.value;
    const stock = value.startsWith(STOCK);
    const name = stock ? value.slice(STOCK.length) : value;
    let blueprint: Blueprint | null;
    try {
      blueprint = stock ? ships.loadStock(name) : ships.load(name);
    } catch (error) {
      window.alert(`Could not read the saved ${name}.\n\n${error instanceof Error ? error.message : error}`);
      return;
    }
    if (blueprint === null) return;
    // In the middle of the view, on the grid.
    const step = snapStep(camera.scale);
    doc.apply(addShip(doc.fleet, blueprint, snap(camera.x, step), snap(camera.y, step)));
    doc.select([doc.fleet.ships.length - 1]);
    refresh();
  });

  const editSelected = (change: Parameters<typeof updateEntry>[2]): void => {
    const index = doc.selection[0];
    if (index === undefined || doc.selection.length !== 1) return;
    doc.apply(updateEntry(doc.fleet, index, change));
    refresh();
  };
  const numberOf = (input: HTMLInputElement): number | null => {
    const value = Number(input.value);
    return input.value.trim() === '' || !Number.isFinite(value) ? null : value;
  };
  entryX.addEventListener('change', () => {
    const x = numberOf(entryX);
    if (x !== null) editSelected((e) => ({ ...e, x }));
  });
  entryY.addEventListener('change', () => {
    const y = numberOf(entryY);
    if (y !== null) editSelected((e) => ({ ...e, y }));
  });
  entryAngle.addEventListener('change', () => {
    const degrees = numberOf(entryAngle);
    if (degrees !== null) editSelected((e) => ({ ...e, angle: degreesToRadians(degrees) }));
  });
  entryMirror.addEventListener('change', () => {
    editSelected((e) => {
      if (!isGroupUse(e)) return e;
      const next = { ...e };
      if (entryMirror.checked) next.mirror = true;
      else delete next.mirror;
      return next;
    });
  });

  repeatButton.addEventListener('click', () => {
    const index = doc.selection[0];
    const count = numberOf(repeatCount);
    if (index === undefined || count === null || count < 2) return;
    const before = doc.fleet.ships.length;
    doc.apply(
      repeatEntry(doc.fleet, index, Math.round(count), {
        x: numberOf(repeatX) ?? 0,
        y: numberOf(repeatY) ?? 0,
        angle: degreesToRadians(numberOf(repeatAngle) ?? 0),
      }),
    );
    doc.select([index, ...range(before, doc.fleet.ships.length)]);
    refresh();
  });

  el<HTMLButtonElement>('duplicateEntry').addEventListener('click', () => {
    const before = doc.fleet.ships.length;
    const offset = snapStep(camera.scale) * 20;
    doc.apply(duplicateEntries(doc.fleet, doc.selection, 0, -offset));
    doc.select(range(before, doc.fleet.ships.length));
    refresh();
  });

  const deleteSelected = (): void => {
    if (doc.selection.length === 0) return;
    doc.apply(deleteEntries(doc.fleet, doc.selection));
    doc.select([]);
    refresh();
  };
  el<HTMLButtonElement>('deleteEntry').addEventListener('click', deleteSelected);

  fleetName.addEventListener('change', () => {
    const name = fleetName.value.trim();
    if (name === '' || name === doc.fleet.name) return;
    doc.apply({ ...doc.fleet, name });
    refresh();
  });
  fleetNotes.addEventListener('change', () => {
    const next = { ...doc.fleet };
    const text = fleetNotes.value;
    if (text === '') delete next.notes;
    else next.notes = text;
    doc.apply(next);
    refresh();
  });

  undoButton.addEventListener('click', () => {
    doc.undo();
    refresh();
  });
  redoButton.addEventListener('click', () => {
    doc.redo();
    refresh();
  });

  // ---- the library --------------------------------------------------------

  const taken = (): string[] => fleets.list().map((entry) => entry.name);
  const open = (fleet: Fleet): void => {
    doc.replace(fleet);
    fitPending = true;
    refresh();
  };
  fleetList.addEventListener('change', () => {
    const value = fleetList.value;
    const stock = value.startsWith(STOCK);
    const fleet = read(stock ? value.slice(STOCK.length) : value, stock);
    if (fleet !== null) open(fleet);
  });
  el<HTMLButtonElement>('newFleet').addEventListener('click', () => {
    open(emptyFleet(unusedName('New fleet', taken())));
  });
  el<HTMLButtonElement>('duplicateFleet').addEventListener('click', () => {
    doc.replace({ ...doc.fleet, name: unusedName(nextName(doc.fleet.name), taken()) });
    refresh();
  });
  el<HTMLButtonElement>('saveFleet').addEventListener('click', () => {
    fleets.save(doc.fleet);
    refresh();
  });
  deleteFleetButton.addEventListener('click', () => {
    const name = doc.fleet.name;
    if (!window.confirm(`Delete the saved copy of ${name}?`)) return;
    fleets.remove(name);
    doc.apply(emptyFleet(unusedName('New fleet', taken())));
    refresh();
  });
  el<HTMLButtonElement>('exportFleet').addEventListener('click', () => {
    const text = `${JSON.stringify(serialiseFleet(doc.fleet), null, 2)}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${doc.fleet.name.replace(/[^\w.-]+/g, '-').toLowerCase()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  });
  const importInput = el<HTMLInputElement>('importFleet');
  el<HTMLButtonElement>('importTrigger').addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', () => {
    const file = importInput.files?.[0];
    if (file === undefined) return;
    void file.text().then((text) => {
      let fleet: Fleet;
      try {
        fleet = parseFleet(JSON.parse(text));
      } catch (error) {
        window.alert(`Could not read that file.\n\n${error instanceof Error ? error.message : error}`);
        return;
      }
      if (fleets.savedNames().includes(fleet.name)) {
        const answer = window.prompt(
          `You already have a saved fleet called ${fleet.name}. ` +
            `Give this one a different name, or keep the name to replace yours.`,
          fleet.name,
        );
        if (answer === null) return;
        fleet = { ...fleet, name: answer.trim() || fleet.name };
      }
      open(fleet);
    });
    importInput.value = '';
  });

  // ---- the pointer --------------------------------------------------------

  const worldAt = (event: PointerEvent | WheelEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    const px = ((event.clientX - rect.left) * canvas.width) / rect.width - canvas.width / 2;
    const py = ((event.clientY - rect.top) * canvas.height) / rect.height - canvas.height / 2;
    return { x: camera.x + px / camera.scale, y: camera.y - py / camera.scale };
  };

  type Drag =
    | { kind: 'pan'; x: number; y: number; deselect: boolean }
    | { kind: 'move'; from: Fleet; startX: number; startY: number; moved: boolean }
    | { kind: 'rotate'; from: Fleet; moved: boolean };
  let drag: Drag | null = null;

  canvas.addEventListener('pointerdown', (event) => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    canvas.setPointerCapture(event.pointerId);
    const world = worldAt(event);
    const knob = currentKnob();
    if (knob !== null && event.button === 0) {
      const dx = world.x - knob.x;
      const dy = world.y - knob.y;
      if (sqrt(dx * dx + dy * dy) <= HANDLE_GRAB_PX / camera.scale) {
        drag = { kind: 'rotate', from: doc.fleet, moved: false };
        return;
      }
    }
    const hit = event.button === 1 ? -1 : doc.entryAt(world.x, world.y, HANDLE_GRAB_PX / camera.scale);
    if (hit >= 0 && event.shiftKey) {
      doc.toggle(hit);
      refresh();
      return;
    }
    if (hit < 0 || event.button === 1 || event.shiftKey) {
      drag = { kind: 'pan', x: event.clientX, y: event.clientY, deselect: hit < 0 && event.button === 0 };
      return;
    }
    if (!doc.selection.includes(hit)) doc.select([hit]);
    drag = { kind: 'move', from: doc.fleet, startX: world.x, startY: world.y, moved: false };
    refresh();
  });

  canvas.addEventListener('pointermove', (event) => {
    if (drag === null) return;
    if (drag.kind === 'pan') {
      if (event.clientX === drag.x && event.clientY === drag.y) return;
      const ratio = canvas.width / canvas.getBoundingClientRect().width;
      camera.x -= ((event.clientX - drag.x) * ratio) / camera.scale;
      camera.y += ((event.clientY - drag.y) * ratio) / camera.scale;
      drag = { kind: 'pan', x: event.clientX, y: event.clientY, deselect: false };
      render();
      return;
    }
    const world = worldAt(event);
    let next: Fleet;
    if (drag.kind === 'move') {
      // The displacement snaps, not the position, so a formation keeps its offsets.
      const step = event.altKey ? 0 : snapStep(camera.scale);
      const dx = snap(world.x - drag.startX, step);
      const dy = snap(world.y - drag.startY, step);
      if (dx === 0 && dy === 0 && !drag.moved) return;
      next = moveEntries(drag.from, doc.selection, dx, dy);
    } else {
      const index = doc.selection[0]!;
      const entry = drag.from.ships[index]!;
      let degrees = radiansToDegrees(atan2(world.y - entry.y, world.x - entry.x));
      if (!event.altKey) degrees = Math.round(degrees / ANGLE_SNAP_DEGREES) * ANGLE_SNAP_DEGREES;
      const angle = degreesToRadians(degrees);
      next = updateEntry(drag.from, index, (e) => ({ ...e, angle: angle === 0 ? 0 : angle }));
    }
    if (drag.moved) doc.amend(next);
    else doc.apply(next);
    drag = { ...drag, moved: true };
    refresh();
  });

  const endDrag = (): void => {
    if (drag !== null && drag.kind === 'pan' && drag.deselect) {
      doc.select([]);
      refresh();
    }
    drag = null;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const before = worldAt(event);
      camera.scale *= Math.exp(-event.deltaY * 0.0015);
      const after = worldAt(event);
      camera.x += before.x - after.x;
      camera.y += before.y - after.y;
      renderSelection();
      render();
    },
    { passive: false },
  );

  window.addEventListener('keydown', (event) => {
    const typing =
      document.activeElement instanceof HTMLInputElement ||
      document.activeElement instanceof HTMLTextAreaElement;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) doc.redo();
      else doc.undo();
      refresh();
      return;
    }
    if (typing) return;
    if (event.key === 'f' || event.key === 'F') {
      fitPending = true;
      render();
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      deleteSelected();
    } else if (event.key === 'Escape') {
      doc.select([]);
      refresh();
    }
  });

  // The ship library may have changed in another tab; check the copies again.
  window.addEventListener('focus', () => {
    doc.refresh();
    refresh();
  });

  // The canvas, not the window: the header rewrapping resizes it too.
  new ResizeObserver(() => {
    resize();
    render();
  }).observe(canvas);

  el<HTMLElement>('hint').textContent =
    'Add ships from the library; click to select, Shift-click for several, drag to move, drag the knob to turn. ' +
    `Moves snap to a tenth of the grid and facings to ${ANGLE_SNAP_DEGREES}° — hold Alt to escape. ` +
    'Drag empty space to pan, scroll to zoom, F to fit, Delete to remove, Ctrl+Z to undo.';

  resize();
  refresh();
}

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`missing element #${id}`);
  return found as T;
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i < to; i++) out.push(i);
  return out;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}
