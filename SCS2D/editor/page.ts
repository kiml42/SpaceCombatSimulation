import {
  degreesToRadians,
  math,
  parseBlueprint,
  placementAt,
  radiansToDegrees,
  samePlacement,
  Snapshot,
  type Blueprint,
  type ModulePath,
  type ModuleSpec,
  type Placement,
} from '../sim/index.js';
import { draw } from '../render/canvas2d.js';
import { frame, type Camera } from '../render/camera.js';
import { EditorDocument } from './document.js';
import {
  addModule,
  duplicatePlacement,
  moduleAt,
  movePlacement,
  positionHandle,
  removeCopy,
  snap,
  unlinkable,
  unlinkPlacement,
  updatePlacement,
} from './edit.js';
import { emptyBlueprint, Library, toFileText } from './library.js';
import { Demonstration } from './demonstrate.js';
import { drawOverlay } from './overlay.js';
import { previewSnapshot } from './preview.js';
import { designStats, envelopes, moduleReadout, type Envelopes } from './stats.js';

/**
 * The blueprint editor's page: the canvas, the panels and the pointer.
 *
 * Its own page and its own bundle, because its inputs and outputs are both
 * blueprints — it needs to know nothing about a battle in progress, so there
 * is no shared clock, no snapshot stream and no worker between them.
 *
 * The boundary that claim has is exact and worth stating, because stating it
 * loosely invites the failure it exists to prevent: **the editor is
 * independent of the running simulation and tightly coupled to the
 * simulation's laws.** Every mass, thrust, gun figure and firing arc on this
 * page comes out of `compileDraft`, and the ship is drawn by the battle's own
 * renderer. If this file ever works one of them out for itself, the editor and
 * the battle disagree about the same ship — which is the worst thing this tool
 * can do, since its entire value is that the picture and the numbers are true.
 */

const { max } = math;

/** Grid the drag snaps to, metres, and the modifier that escapes it. */
const SNAP_METRES = 0.5;
/** Rotation snap for the angle box, degrees. */
const ANGLE_SNAP_DEGREES = 15;

/** What a freshly added module of each kind starts as, metres. */
const DEFAULTS: Record<ModuleSpec['kind'], Omit<ModuleSpec, 'x' | 'y'>> = {
  structure: { kind: 'structure', length: 8, width: 5 },
  thruster: { kind: 'thruster', angle: 0, length: 3, width: 3 },
  turret: { kind: 'turret', angle: 0, length: 4, width: 3, barrels: 1 },
};

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`missing element #${id}`);
  return found as T;
}

/** A module's own value for a field, with the default the parser would have applied. */
function moduleField(spec: ModuleSpec, key: 'angle' | 'reinforcement' | 'barrels'): number {
  if (key === 'angle') return radiansToDegrees(spec.angle ?? 0);
  if (key === 'reinforcement') return spec.reinforcement ?? 1;
  return spec.barrels ?? 1;
}

export function startEditor(): void {
  const canvas = el<HTMLCanvasElement>('view');
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('no 2d context');

  const library = new Library(window.localStorage);
  const doc = new EditorDocument(library.load('Corvette') ?? emptyBlueprint('New ship'));
  const camera: Camera = { x: 0, y: 0, scale: 8 };
  const snapshot = new Snapshot();
  const demonstration = new Demonstration();
  let fitPending = true;
  /** Wall time of the last animated frame, or 0 when nothing is animating. */
  let lastFrame = 0;
  let frameRequested = false;
  // Measured when the layout changes, not when the view moves. The holding
  // curve costs thousands of allocations; panning must not pay for them.
  let envelope: Envelopes | null = null;

  // ---- the controls -------------------------------------------------------

  const shipList = el<HTMLSelectElement>('ship');
  const shipName = el<HTMLInputElement>('shipName');
  const shipNotes = el<HTMLTextAreaElement>('shipNotes');
  const properties = el<HTMLElement>('properties');
  const linked = el<HTMLElement>('linked');
  const statsPanel = el<HTMLElement>('stats');
  const problemsPanel = el<HTMLElement>('problems');
  const hint = el<HTMLElement>('hint');
  const undoButton = el<HTMLButtonElement>('undo');
  const redoButton = el<HTMLButtonElement>('redo');
  const deleteShipButton = el<HTMLButtonElement>('deleteShip');
  const moduleStats = el<HTMLElement>('moduleStats');
  const duplicateButton = el<HTMLButtonElement>('propDuplicate');
  const unlinkButton = el<HTMLButtonElement>('propUnlink');
  const saveButton = el<HTMLButtonElement>('saveShip');
  const exportButton = el<HTMLButtonElement>('exportShip');

  const propInputs: Record<string, HTMLInputElement | HTMLTextAreaElement> = {
    x: el<HTMLInputElement>('propX'),
    y: el<HTMLInputElement>('propY'),
    angle: el<HTMLInputElement>('propAngle'),
    length: el<HTMLInputElement>('propLength'),
    width: el<HTMLInputElement>('propWidth'),
    reinforcement: el<HTMLInputElement>('propReinforcement'),
    barrels: el<HTMLInputElement>('propBarrels'),
    notes: el<HTMLTextAreaElement>('propNotes'),
  };

  // ---- redraw and repaint -------------------------------------------------

  const resize = (): void => {
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = max(1, Math.round(rect.width * ratio));
    canvas.height = max(1, Math.round(rect.height * ratio));
  };

  const render = (): void => {
    const view = doc.view;
    if (view.design !== null) {
      previewSnapshot(view.design, snapshot);
      if (fitPending) {
        frame(camera, snapshot, canvas.width, canvas.height, 0, 1);
        fitPending = false;
      }
    } else {
      snapshot.shipCount = 0;
    }
    if (view.design !== null) demonstration.writeInto(snapshot);
    draw(ctx, snapshot, camera, canvas.width, canvas.height);
    drawOverlay(
      ctx,
      { design: view.design, modules: view.modules, selected: doc.selectedModules(), envelope },
      camera,
      canvas.width,
      canvas.height,
    );
  };

  /**
   * A number at `places` decimals, widened until it shows at least two
   * significant figures.
   *
   * Without the floor, a small gun's shell reads as "0 kg" — a figure that is
   * not merely imprecise but wrong, since it says the round has no mass. The
   * decimals are a floor rather than a fixed count so a heavy shell still
   * reads 89.8 rather than being rounded to 90.
   */
  /**
   * Animate for as long as there is something to animate.
   *
   * Frames are asked for only while an engine is spooling or a round is in the
   * air, so a still picture costs nothing. There is no fixed step and nothing
   * to reproduce: this is a picture of a module, not a state of the world.
   */
  const animate = (now: number): void => {
    frameRequested = false;
    const design = doc.view.design;
    if (design === null) {
      lastFrame = 0;
      return;
    }
    const dt = lastFrame === 0 ? 0 : Math.min((now - lastFrame) / 1000, 0.1);
    lastFrame = now;
    demonstration.step(design, doc.selectedModules(), dt);
    render();
    if (demonstration.running) requestFrame();
    else lastFrame = 0;
  };

  function requestFrame(): void {
    if (frameRequested) return;
    frameRequested = true;
    window.requestAnimationFrame(animate);
  }

  const numbers = (value: number, places = 1, significant = 2): string => {
    let decimals = places;
    if (value !== 0 && Number.isFinite(value)) {
      const magnitude = Math.floor(Math.log10(Math.abs(value)));
      decimals = Math.max(places, Math.min(20, significant - 1 - magnitude));
    }
    return value.toLocaleString('en-GB', { maximumFractionDigits: decimals });
  };

  const renderStats = (): void => {
    const design = doc.view.design;
    if (design === null || envelope === null) {
      statsPanel.innerHTML = `<p class="none">${doc.view.underivable ?? 'Nothing to measure yet.'}</p>`;
      return;
    }
    const s = designStats(design, envelope);
    const rows = [
      ['Dry mass', `${numbers(s.mass / 1000, 2)} t`],
      ['Inertia', `${numbers(s.inertia / 1000, 0)} t·m²`],
      ['Modules', `${s.moduleCount} (${s.thrusterCount} thrusters)`],
      ['Radius', `${numbers(s.radius)} m`],
      ['Accel fore / aft', `${numbers(s.accelFore, 2)} / ${numbers(s.accelAft, 2)} m/s²`],
      ['Accel port / stbd', `${numbers(s.accelPort, 2)} / ${numbers(s.accelStarboard, 2)} m/s²`],
      [
        'Turn left / right',
        `${numbers(radiansToDegrees(s.turnLeft), 2)} / ${numbers(radiansToDegrees(s.turnRight), 2)} °/s²`,
      ],
      ['Authority', s.fullAuthority ? 'full' : 'incomplete — cannot hold a heading'],
      // What a layout pays for its thrust not being balanced about its centre
      // of mass: the acceleration it gives up to avoid spinning. The envelope
      // shows which directions it is paid in.
      [
        'Heading cost',
        s.headingCost < 0.005 ? 'none — thrust is balanced' : `up to ${numbers(s.headingCost * 100)}%`,
      ],
    ];
    // No turret rows: a gun's figures belong to the gun, and selecting it
    // shows them. Repeating them here made the ship's own totals hard to find
    // on a ship with several mounts, and said nothing the module panel does
    // not say better.
    rows.push(['Turrets', `${s.turrets.length}`]);
    statsPanel.innerHTML =
      `<table>${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>`;
  };

  const renderProblems = (): void => {
    const problems = doc.view.problems;
    if (problems.length === 0) {
      problemsPanel.innerHTML = '<p class="ok">No problems — this layout would fly.</p>';
      return;
    }
    problemsPanel.innerHTML =
      `<p class="warn">${problems.length} problem${problems.length > 1 ? 's' : ''}</p><ul>` +
      problems.map((p) => `<li>${escapeHtml(p)}</li>`).join('') +
      '</ul>';
  };

  /** Where the selected copy's position is written, and in what frame. */
  const selectedPosition = (): ReturnType<typeof positionHandle> | null => {
    const origin = doc.selectedOrigin();
    return origin === null ? null : positionHandle(doc.blueprint, origin);
  };

  const renderProperties = (): void => {
    const placement = doc.selectedPlacement;
    const copies = doc.selectedModules().length;
    if (placement === null || isModuleSpec(placement) === false) {
      properties.hidden = true;
      shownSelection = null;
      return;
    }
    properties.hidden = false;
    const spec = placement as ModuleSpec;
    const handle = selectedPosition();
    const positioned = handle === null ? null : placementAt(doc.blueprint, handle.origin.path);
    // Whether the panel is still describing the module it was describing last
    // time. Compared by placement rather than by identity, because a path
    // object is rebuilt on every edit even when the selection has not moved.
    const path = doc.selection;
    const sameModule =
      shownSelection !== null && path !== null && samePlacement(shownSelection, path);
    shownSelection = path;
    el<HTMLElement>('propKind').textContent = spec.kind;
    for (const [key, input] of Object.entries(propInputs)) {
      // Never overwrite the box being typed into: a refresh triggered by the
      // keystroke would otherwise reformat the number under the cursor. That
      // holds only while the panel is describing the *same* module — moving to
      // another one has to rewrite every box, focused or not, or the panel
      // goes on showing the values of the module that was left behind.
      if (sameModule && document.activeElement === input) continue;
      if (key === 'notes') input.value = spec.notes ?? '';
      else if (key === 'x' || key === 'y') {
        // The position shown is the one that puts *this copy* here, which for a
        // shared part is its instance's rather than the module's own — the
        // module sits at its assembly's origin, and showing that would report
        // every copy as being at (0, 0).
        const at = positioned;
        input.value = String(at === null ? 0 : key === 'x' ? at.x : at.y);
      }
      else if (key === 'length' || key === 'width') input.value = String(spec[key]);
      else input.value = String(moduleField(spec, key as 'angle' | 'reinforcement' | 'barrels'));
    }
    el<HTMLElement>('barrelsRow').hidden = spec.kind !== 'turret';

    const origin = doc.selectedOrigin();
    const shared = origin === null ? 0 : unlinkable(doc.blueprint, origin);
    unlinkButton.disabled = shared < 2;
    unlinkButton.title =
      shared < 2
        ? 'Only a shared part can be unlinked'
        : `Give each of the ${shared} copies its own module, so they stop changing together`;

    linked.hidden = copies < 2;
    linked.textContent =
      copies < 2
        ? ''
        : `Shared: drawn ${copies} times. Size, facing and notes change every copy; ` +
          `position moves this one.`;

    renderModuleStats(spec, doc.selectedModules()[0] ?? -1);
  };

  const renderModuleStats = (spec: ModuleSpec, index: number): void => {
    // Given the whole layout, so a turret's arc can be worked out from what is
    // around it — the one figure on this panel that is not a property of the
    // module alone.
    const readout = moduleReadout(spec, doc.view.modules, index);
    const rows = readout.rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('');
    const gun =
      readout.gun === null
        ? ''
        : `<tr><th>Gun</th><td>${numbers(readout.gun.calibre * 1000, 0)} mm` +
          `${readout.gun.barrels > 1 ? ` ×${readout.gun.barrels}` : ''}, ` +
          `${numbers(readout.gun.roundsPerMinute)} rpm, ${numbers(readout.gun.muzzleSpeed, 0)} m/s, ` +
          `${numbers(readout.gun.roundMass, 1)} kg shell</td></tr>` +
          `<tr><th>Arc</th><td>${numbers(readout.gun.arcRight, 0)}°R–` +
          `${numbers(readout.gun.arcLeft, 0)}°L, trains at ` +
          `${numbers(readout.gun.traverseRate)} °/s</td></tr>`;
    moduleStats.innerHTML = `<table>${rows}${gun}</table>`;
  };

  const renderLibrary = (): void => {
    const entries = library.list();
    const selected = doc.blueprint.name;
    shipList.innerHTML = entries
      .map(
        (entry) =>
          `<option value="${escapeHtml(entry.name)}"${entry.name === selected ? ' selected' : ''}>` +
          `${escapeHtml(entry.name)}${entry.saved ? ' •' : ''}</option>`,
      )
      .join('');
    if (!entries.some((entry) => entry.name === selected)) {
      shipList.insertAdjacentHTML(
        'afterbegin',
        `<option value="${escapeHtml(selected)}" selected>${escapeHtml(selected)} (unsaved)</option>`,
      );
    }
    deleteShipButton.disabled = !library.savedNames().includes(selected);
  };

  const refresh = (): void => {
    const design = doc.view.design;
    envelope = design === null ? null : envelopes(design);
    if (document.activeElement !== shipName) shipName.value = doc.blueprint.name;
    if (document.activeElement !== shipNotes) shipNotes.value = doc.blueprint.notes ?? '';
    undoButton.disabled = !doc.canUndo;
    redoButton.disabled = !doc.canRedo;
    // A layout is allowed to be invalid while it is being worked on — you often
    // have to drag one module through another to get it past — but it may not
    // *leave* in that state. Saving and exporting both write a blueprint file,
    // and a file is read back by a parser that will refuse it, so writing one
    // would be handing the player something that cannot be opened again.
    const blocked = doc.view.problems.length > 0;
    saveButton.disabled = blocked;
    exportButton.disabled = blocked;
    const why = blocked ? 'Fix the problems below first — a file with them cannot be read back.' : '';
    saveButton.title = why;
    exportButton.title = why;
    renderLibrary();
    renderProperties();
    renderStats();
    renderProblems();
    render();
    // A newly selected engine or gun has something to show, and a deselected
    // one has a plume to wind down, so either way a change of selection is a
    // reason to start asking for frames again.
    requestFrame();
  };

  // ---- editing ------------------------------------------------------------

  /**
   * Whether the change being made continues the last one.
   *
   * A drag is one action to the player and several hundred blueprints to the
   * editor, and so is holding an arrow key in a number box. The first change
   * of a gesture takes an undo step; the rest amend it.
   */
  let gesture = false;

  /** Which placement the properties panel is currently showing. */
  let shownSelection: ModulePath | null = null;

  const change = (next: Blueprint | null, continues = false): void => {
    if (next === null) return;
    if (continues && gesture) doc.amend(next);
    else doc.apply(next);
    gesture = continues;
    refresh();
  };

  const editSelected = (patch: Partial<ModuleSpec>, continues: boolean): void => {
    const path = doc.selection;
    if (path === null) return;
    change(
      updatePlacement(doc.blueprint, path, (placement) => ({ ...placement, ...patch }) as Placement),
      continues,
    );
  };

  for (const [key, input] of Object.entries(propInputs)) {
    input.addEventListener('focus', () => {
      gesture = false;
    });
    input.addEventListener('input', () => {
      if (key === 'notes') {
        const text = input.value.trim();
        const path = doc.selection;
        if (path === null) return;
        change(
          updatePlacement(doc.blueprint, path, (placement) => {
            const next = { ...placement };
            if (text === '') delete next.notes;
            else next.notes = text;
            return next;
          }),
          true,
        );
        return;
      }
      const value = Number(input.value);
      if (!Number.isFinite(value)) return;
      if (key === 'x' || key === 'y') {
        // Position is written wherever this copy's position lives, which is
        // its instance when the module is a shared part.
        const handle = selectedPosition();
        if (handle === null) return;
        change(
          updatePlacement(doc.blueprint, handle.origin.path, (p) => ({ ...p, [key]: value })),
          true,
        );
        return;
      }
      if (key === 'angle') editSelected({ angle: degreesToRadians(value) }, true);
      else editSelected({ [key]: value } as Partial<ModuleSpec>, true);
    });
  }

  const deleteSelected = (): void => {
    const origin = doc.selectedOrigin();
    if (origin === null) return;
    change(removeCopy(doc.blueprint, origin));
  };
  el<HTMLButtonElement>('propDelete').addEventListener('click', deleteSelected);

  duplicateButton.addEventListener('click', () => {
    const origin = doc.selectedOrigin();
    if (origin === null) return;
    const duplicated = duplicatePlacement(doc.blueprint, origin);
    if (duplicated === null) return;
    doc.apply(duplicated.blueprint);
    // Select the copy that was just made rather than the one it was made from:
    // it is the one the player is about to put somewhere, and it is last,
    // because a new placement is appended.
    doc.select(duplicated.path);
    const drawn = doc.selectedModules();
    if (drawn.length > 0) doc.selectModule(drawn[drawn.length - 1]!);
    gesture = false;
    refresh();
  });

  unlinkButton.addEventListener('click', () => {
    const origin = doc.selectedOrigin();
    if (origin === null) return;
    change(unlinkPlacement(doc.blueprint, origin));
  });

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-add]')) {
    button.addEventListener('click', () => {
      const kind = button.dataset['add'] as ModuleSpec['kind'];
      // At the layout's own origin, not at the middle of the view. A ship is
      // drawn about its origin — the authored ones are, and the frame the
      // player types coordinates in is that one — so starting every module
      // wherever the camera happened to be left builds a ship quietly off
      // centre, and the first module of a new ship decides where the rest go.
      const spec: ModuleSpec = { ...DEFAULTS[kind], x: 0, y: 0 };
      const added = addModule(doc.blueprint, spec);
      doc.apply(added.blueprint);
      doc.select(added.path);
      gesture = false;
      refresh();
    });
  }

  shipName.addEventListener('input', () => {
    const name = shipName.value.trim();
    if (name === '') return;
    change({ ...doc.blueprint, name }, true);
  });
  shipName.addEventListener('focus', () => {
    gesture = false;
  });
  shipNotes.addEventListener('focus', () => {
    gesture = false;
  });
  shipNotes.addEventListener('input', () => {
    const text = shipNotes.value.trim();
    const next = { ...doc.blueprint };
    if (text === '') delete next.notes;
    else next.notes = text;
    change(next, true);
  });

  undoButton.addEventListener('click', () => {
    doc.undo();
    gesture = false;
    refresh();
  });
  redoButton.addEventListener('click', () => {
    doc.redo();
    gesture = false;
    refresh();
  });

  // ---- the library --------------------------------------------------------

  const open = (name: string): void => {
    const blueprint = library.load(name);
    if (blueprint === null) return;
    doc.replace(blueprint);
    demonstration.reset();
    fitPending = true;
    gesture = false;
    refresh();
  };

  shipList.addEventListener('change', () => open(shipList.value));
  el<HTMLButtonElement>('newShip').addEventListener('click', () => {
    doc.replace(emptyBlueprint(unusedName(library.list().map((e) => e.name))));
    fitPending = true;
    gesture = false;
    refresh();
  });
  saveButton.addEventListener('click', () => {
    library.save(doc.blueprint);
    refresh();
  });
  deleteShipButton.addEventListener('click', () => {
    const name = doc.blueprint.name;
    if (!window.confirm(`Delete the saved copy of ${name}?`)) return;
    library.remove(name);
    refresh();
  });
  exportButton.addEventListener('click', () => {
    const blob = new Blob([toFileText(doc.blueprint)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${doc.blueprint.name.replace(/[^\w.-]+/g, '-').toLowerCase()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  });
  const importInput = el<HTMLInputElement>('importShip');
  el<HTMLButtonElement>('importTrigger').addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', () => {
    const file = importInput.files?.[0];
    if (file === undefined) return;
    void file.text().then((text) => {
      let blueprint: Blueprint;
      try {
        blueprint = parseBlueprint(JSON.parse(text));
      } catch (error) {
        window.alert(`Could not read that file.\n\n${error instanceof Error ? error.message : error}`);
        return;
      }
      // Names are identity, and a collision is exactly what importing a
      // friend's updated ship looks like. Auto-renaming would quietly make a
      // fourth copy of it, and replacing would destroy an afternoon's work on
      // a name match — which "Corvette" guarantees. So ask.
      if (library.savedNames().includes(blueprint.name)) {
        const answer = window.prompt(
          `You already have a saved ship called ${blueprint.name}. ` +
            `Give this one a different name, or keep the name to replace yours.`,
          blueprint.name,
        );
        if (answer === null) return;
        blueprint = { ...blueprint, name: answer.trim() || blueprint.name };
      }
      doc.replace(blueprint);
      fitPending = true;
      gesture = false;
      refresh();
    });
    importInput.value = '';
  });

  // ---- the pointer --------------------------------------------------------

  const worldAt = (event: PointerEvent | WheelEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    const ratio = canvas.width / rect.width;
    const px = (event.clientX - rect.left) * ratio - canvas.width / 2;
    const py = (event.clientY - rect.top) * ratio - canvas.height / 2;
    return { x: camera.x + px / camera.scale, y: camera.y - py / camera.scale };
  };

  type Drag =
    | { kind: 'pan'; x: number; y: number }
    | { kind: 'module'; from: Blueprint; startX: number; startY: number; moved: boolean };
  let drag: Drag | null = null;

  canvas.addEventListener('pointerdown', (event) => {
    // A canvas is not focusable, so clicking it does not move focus off a
    // properties box on its own. Leaving focus there would keep that box out
    // of every refresh, and would swallow Delete, Escape and F, which are all
    // held back while something is being typed into.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    const world = worldAt(event);
    const hit = moduleAt(doc.view.modules, world.x, world.y);
    canvas.setPointerCapture(event.pointerId);
    if (hit < 0 || event.button === 1 || event.shiftKey) {
      doc.select(null);
      drag = { kind: 'pan', x: event.clientX, y: event.clientY };
      refresh();
      return;
    }
    doc.selectModule(hit);
    gesture = false;
    drag = { kind: 'module', from: doc.blueprint, startX: world.x, startY: world.y, moved: false };
    refresh();
  });

  canvas.addEventListener('pointermove', (event) => {
    if (drag === null) return;
    if (drag.kind === 'pan') {
      const ratio = canvas.width / canvas.getBoundingClientRect().width;
      camera.x -= ((event.clientX - drag.x) * ratio) / camera.scale;
      camera.y += ((event.clientY - drag.y) * ratio) / camera.scale;
      drag = { kind: 'pan', x: event.clientX, y: event.clientY };
      render();
      return;
    }
    const handle = selectedPosition();
    if (handle === null) return;
    const world = worldAt(event);
    // The *displacement* snaps, not the position. A layout drawn on half-metre
    // offsets — which the authored ships are, since modules abut exactly —
    // would be dragged onto whole metres by an absolute grid and every abutting
    // face would part company. Snapping the movement keeps whatever offsets a
    // ship was designed with, and Alt escapes it entirely.
    const step = event.altKey ? 0 : SNAP_METRES;
    const dx = snap(world.x - drag.startX, step);
    const dy = snap(world.y - drag.startY, step);
    if (dx === 0 && dy === 0 && !drag.moved) return;
    const next = movePlacement(drag.from, handle.origin, dx, dy);
    if (next === null) return;
    if (drag.moved) doc.amend(next);
    else doc.apply(next);
    drag = { ...drag, moved: true };
    refresh();
  });

  const endDrag = (): void => {
    drag = null;
    gesture = false;
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
      gesture = false;
      refresh();
      return;
    }
    if (typing) return;
    if (event.key === 'f' || event.key === 'F') {
      fitPending = true;
      refresh();
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      if (doc.selection === null) return;
      event.preventDefault();
      deleteSelected();
    } else if (event.key === 'Escape') {
      doc.select(null);
      refresh();
    }
  });

  window.addEventListener('resize', () => {
    resize();
    render();
  });

  hint.textContent =
    `Click a module to select it, drag to move. Movement snaps to ${SNAP_METRES} m — hold Alt to escape it. ` +
    `Angles are typed in degrees; ${ANGLE_SNAP_DEGREES}° steps are the arrows on the box. ` +
    'Shift-drag or drag empty space to pan, scroll to zoom, F to fit, Delete to remove, Ctrl+Z to undo.';

  resize();
  refresh();
}

/** A name not already in the library, so a new ship does not shadow a saved one. */
function unusedName(taken: readonly string[]): string {
  if (!taken.includes('New ship')) return 'New ship';
  for (let i = 2; ; i++) {
    const name = `New ship ${i}`;
    if (!taken.includes(name)) return name;
  }
}

function isModuleSpec(placement: Placement): boolean {
  return !('use' in placement);
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}
