import {
  degreesToRadians,
  isGroupUse,
  math,
  MAX_FLEET_REPEAT,
  parseBlueprint,
  parseFleet,
  radiansToDegrees,
  serialiseFleet,
  Snapshot,
  type Blueprint,
  type Fleet,
  type FleetEntry,
  type FleetStep,
} from '../sim/index.js';
import { draw } from '../render/canvas2d.js';
import { frame, snapStep, type Camera } from '../render/camera.js';
import { snap } from './edit.js';
import {
  addShip,
  deleteEntries,
  duplicateEntries,
  emptyFleet,
  entryAt,
  moveEntries,
  samePath,
  type EntryPath,
  refreshDesign,
  updateEntry,
} from './fleetEdit.js';
import { battleHref } from './handoff.js';
import { centreOf, FleetDocument, toFrame, toFrameAngle, type EntryFrame } from './fleetDocument.js';
import { drawFleetOverlay, knobFor, type FleetOverlayView } from './fleetOverlay.js';
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
  const stepRow = el<HTMLElement>('stepRow');
  const stepAngleRow = el<HTMLElement>('stepAngleRow');
  const stepX = el<HTMLInputElement>('stepX');
  const stepY = el<HTMLInputElement>('stepY');
  const stepAngle = el<HTMLInputElement>('stepAngle');
  const upLevel = el<HTMLButtonElement>('upLevel');
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

  const currentKnob = (): { x: number; y: number; fromX: number; fromY: number } | null => {
    if (doc.selection.length !== 1) return null;
    const path = doc.selection[0]!;
    const at = doc.frameOf(path);
    if (at === null) return null;
    return { ...knobFor(at.x, at.y, at.angle, doc.reachOf(path), camera.scale), fromX: at.x, fromY: at.y };
  };

  /** What the overlay outlines: selected ships, selected groups' boxes, and the group stepped into. */
  const selectionMarks = (): Pick<FleetOverlayView, 'ships' | 'boxes'> => {
    const ships: FleetOverlayView['ships'][number][] = [];
    const boxes: FleetOverlayView['boxes'][number][] = [];
    const contexts: EntryPath[] = [];
    doc.selection.forEach((path, n) => {
      const entry = entryAt(doc.fleet, path);
      if (entry === null) return;
      for (const copy of doc.copiesOf(path)) {
        if (isGroupUse(entry)) boxes.push({ ships: copy.ships, angle: copy.angle, style: copy.primary ? 'primary' : 'linked' });
        else ships.push({ ships: copy.ships, primary: copy.primary && n === 0 });
      }
      const parent = path.slice(0, -1);
      if (parent.length > 0 && !contexts.some((each) => samePath(each, parent))) contexts.push(parent);
    });
    for (const parent of contexts) {
      if (doc.selection.some((path) => samePath(path, parent))) continue;
      for (const copy of doc.copiesOf(parent)) boxes.push({ ships: copy.ships, angle: copy.angle, style: 'context' });
    }
    return { ships, boxes };
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
        ...selectionMarks(),
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
    // The player's own ships first: they are the ones most often wanted.
    const all = ships.list();
    const saved = all.filter((entry) => !entry.stock);
    addDesign.innerHTML =
      (saved.length > 0 ? `<optgroup label="Saved">${options(saved, null)}</optgroup>` : '') +
      `<optgroup label="Stock">${options(all.filter((entry) => entry.stock), null)}</optgroup>`;
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
    const path = picked[0]!;
    const entry = entryAt(doc.fleet, path);
    if (entry === null) return;
    single.hidden = picked.length !== 1;
    upLevel.hidden = picked.length !== 1 || path.length < 2;
    const inside = path.length > 1 ? entryAt(doc.fleet, path.slice(0, -1)) : null;
    selectionTitle.textContent =
      picked.length > 1
        ? `${picked.length} selected`
        : (isGroupUse(entry) ? `Group: ${entry.group}` : `Ship: ${entry.design}`) +
          (inside !== null && isGroupUse(inside) ? ` in ${inside.group}` : '');
    mirrorRow.hidden = !isGroupUse(entry);
    const repeated = (entry.repeat ?? 1) > 1;
    stepRow.hidden = !repeated;
    stepAngleRow.hidden = !repeated;
    const typing = document.activeElement;
    const show = (input: HTMLInputElement, value: number): void => {
      if (typing !== input) input.value = String(round(value));
    };
    show(entryX, entry.x);
    show(entryY, entry.y);
    show(entryAngle, radiansToDegrees(entry.angle ?? 0));
    show(repeatCount, entry.repeat ?? 1);
    show(stepX, entry.step?.x ?? 0);
    show(stepY, entry.step?.y ?? 0);
    show(stepAngle, radiansToDegrees(entry.step?.angle ?? 0));
    entryMirror.checked = isGroupUse(entry) && entry.mirror === true;
    const step = String(snapStep(camera.scale));
    for (const input of [entryX, entryY, stepX, stepY]) input.step = step;
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

  const place = (blueprint: Blueprint): void => {
    // In the middle of the view, on the grid.
    const step = snapStep(camera.scale);
    doc.apply(addShip(doc.fleet, blueprint, snap(camera.x, step), snap(camera.y, step)));
    doc.select([[doc.fleet.ships.length - 1]]);
    refresh();
  };
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
    if (blueprint !== null) place(blueprint);
  });
  const addShipFile = el<HTMLInputElement>('addShipFile');
  el<HTMLButtonElement>('addFromFile').addEventListener('click', () => addShipFile.click());
  addShipFile.addEventListener('change', () => {
    const file = addShipFile.files?.[0];
    if (file === undefined) return;
    void file.text().then((text) => {
      try {
        place(parseBlueprint(JSON.parse(text)));
      } catch (error) {
        window.alert(`Could not read that file.\n\n${error instanceof Error ? error.message : error}`);
      }
    });
    addShipFile.value = '';
  });

  /**
   * Typing in a box is one edit, not one per keystroke: the first change is
   * an undo step and the rest amend it, until the box loses focus.
   */
  let gesture = false;
  const editSelected = (change: (entry: FleetEntry) => FleetEntry): void => {
    const path = doc.selection[0];
    if (path === undefined || doc.selection.length !== 1) return;
    const next = updateEntry(doc.fleet, path, change);
    if (gesture) doc.amend(next);
    else doc.apply(next);
    gesture = true;
    refresh();
  };
  const numberOf = (input: HTMLInputElement): number | null => {
    const value = Number(input.value);
    return input.value.trim() === '' || !Number.isFinite(value) ? null : value;
  };
  const live = (input: HTMLInputElement, change: (value: number, entry: FleetEntry) => FleetEntry): void => {
    input.addEventListener('focus', () => {
      gesture = false;
    });
    input.addEventListener('input', () => {
      const value = numberOf(input);
      if (value !== null) editSelected((e) => change(value, e));
    });
    input.addEventListener('change', () => {
      gesture = false;
      refresh();
    });
  };
  live(entryX, (x, e) => ({ ...e, x }));
  live(entryY, (y, e) => ({ ...e, y }));
  live(entryAngle, (degrees, e) => ({ ...e, angle: degreesToRadians(degrees) }));
  live(repeatCount, (count, e) => {
    const next = { ...e };
    const copies = Math.max(1, Math.min(MAX_FLEET_REPEAT, Math.round(count)));
    if (copies === 1) delete next.repeat;
    else {
      next.repeat = copies;
      // A row with no step stacks every copy on the first; start it a ship's width apart.
      if (next.step === undefined) next.step = { x: 0, y: defaultStep(e) };
    }
    return next;
  });
  const withStep = (e: FleetEntry, change: (step: FleetStep) => FleetStep): FleetEntry => ({
    ...e,
    step: change({ ...(e.step ?? { x: 0, y: 0 }) }),
  });
  live(stepX, (x, e) => withStep(e, (step) => ({ ...step, x })));
  live(stepY, (y, e) => withStep(e, (step) => ({ ...step, y })));
  live(stepAngle, (degrees, e) =>
    withStep(e, (step) => {
      if (degrees === 0) delete step.angle;
      else step.angle = degreesToRadians(degrees);
      return step;
    }),
  );
  entryMirror.addEventListener('change', () => {
    gesture = false;
    editSelected((e) => {
      if (!isGroupUse(e)) return e;
      const next = { ...e };
      if (entryMirror.checked) next.mirror = true;
      else delete next.mirror;
      return next;
    });
    gesture = false;
  });

  /** A starting step for a new row: the width of what is being repeated, plus a margin. */
  const defaultStep = (_entry: FleetEntry): number => {
    const path = doc.selection[0];
    const reach = path === undefined ? 0 : doc.reachOf(path);
    return Math.max(snapStep(camera.scale), Math.ceil(reach * 2.5));
  };

  upLevel.addEventListener('click', () => {
    const path = doc.selection[0];
    if (path === undefined || path.length < 2) return;
    doc.select([path.slice(0, -1)]);
    refresh();
  });

  el<HTMLButtonElement>('duplicateEntry').addEventListener('click', () => {
    const offset = snapStep(camera.scale) * 20;
    const result = duplicateEntries(doc.fleet, doc.selection, 0, -offset);
    doc.apply(result.fleet);
    doc.select(result.paths);
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
    | {
        kind: 'move';
        from: Fleet;
        startX: number;
        startY: number;
        moved: boolean;
        /** The ship pressed on, and whether releasing without a drag steps in a level. */
        hit: number;
        drill: boolean;
        /** Each selected entry's frame, held so the drag measures against where it began. */
        frames: (EntryFrame | null)[];
      }
    | { kind: 'rotate'; from: Fleet; moved: boolean; frame: EntryFrame };
  let drag: Drag | null = null;

  canvas.addEventListener('pointerdown', (event) => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    canvas.setPointerCapture(event.pointerId);
    const world = worldAt(event);
    const knob = currentKnob();
    const knobFrame = doc.selection.length === 1 ? doc.frameOf(doc.selection[0]!) : null;
    if (knob !== null && knobFrame !== null && event.button === 0) {
      if (sqrt((world.x - knob.x) ** 2 + (world.y - knob.y) ** 2) <= HANDLE_GRAB_PX / camera.scale) {
        drag = { kind: 'rotate', from: doc.fleet, moved: false, frame: knobFrame };
        return;
      }
    }
    const hit = event.button === 1 ? -1 : doc.shipAt(world.x, world.y, HANDLE_GRAB_PX / camera.scale);
    if (hit >= 0 && event.shiftKey) {
      const path = doc.resolveClick(hit);
      if (path !== null) doc.toggle(path, hit);
      refresh();
      return;
    }
    if (hit < 0 || event.button === 1 || event.shiftKey) {
      drag = { kind: 'pan', x: event.clientX, y: event.clientY, deselect: hit < 0 && event.button === 0 };
      return;
    }
    // Pressing on what is already selected leaves it alone, so a group drags as
    // a group; a click that does not become a drag steps in a level on release.
    const drill = doc.covers(hit);
    if (!drill) {
      const path = doc.resolveClick(hit);
      doc.select(path === null ? [] : [path], hit);
    }
    drag = {
      kind: 'move',
      from: doc.fleet,
      startX: world.x,
      startY: world.y,
      moved: false,
      hit,
      drill,
      frames: doc.selection.map((path) => doc.frameOf(path)),
    };
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
      const frames = drag.frames;
      next = moveEntries(
        drag.from,
        doc.selection.flatMap((path, i) => {
          const frame = frames[i];
          return frame == null ? [] : [{ path, ...toFrame(frame, dx, dy) }];
        }),
      );
    } else {
      const path = doc.selection[0]!;
      const frame = drag.frame;
      let degrees = radiansToDegrees(atan2(world.y - frame.y, world.x - frame.x));
      if (!event.altKey) degrees = Math.round(degrees / ANGLE_SNAP_DEGREES) * ANGLE_SNAP_DEGREES;
      const angle = foldAngle(toFrameAngle(frame, degreesToRadians(degrees)));
      next = updateEntry(drag.from, path, (e) => ({ ...e, angle }));
    }
    if (drag.moved) doc.amend(next);
    else doc.apply(next);
    drag = { ...drag, moved: true };
    refresh();
  });

  const endDrag = (): void => {
    if (drag !== null && drag.kind === 'move' && drag.drill && !drag.moved) {
      const path = doc.resolveClick(drag.hit);
      doc.select(path === null ? [] : [path], drag.hit);
      refresh();
    }
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

  // The fleet as it stands, saved or not, goes with the link.
  el<HTMLAnchorElement>('battleLink').addEventListener('click', (event) => {
    (event.currentTarget as HTMLAnchorElement).href = battleHref(doc.fleet);
  });

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

function foldAngle(a: number): number {
  let r = math.normalizeAngle(a);
  if (r <= -math.PI) r += math.TAU;
  else if (r > math.PI) r -= math.TAU;
  return r === 0 ? 0 : r;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}
