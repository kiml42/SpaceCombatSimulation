import {
  DEFAULT_BURST_SPEED,
  DEFAULT_FRAGMENTS,
  DEFAULT_FUSE,
  firesShells,
  DEFAULT_NOZZLE_SHARE,
  degreesToRadians,
  isInstance,
  isHullMount,
  isWeaponMount,
  readsThick,
  readsFuse,
  canThicken,
  fighterProblem,
  isThick,
  mountTraverse,
  MAX_REPEAT,
  MODULE_KINDS,
  math,
  parseBlueprint,
  placementAt,
  radiansToDegrees,
  refitModule,
  samePlacement,
  Snapshot,
  type AssemblyInstance,
  type Blueprint,
  type ModuleKind,
  type ModuleOrigin,
  type ModulePath,
  type ModuleSpec,
  type ShipDesign,
  type Placement,
} from '../sim/index.js';
import { ARCS_KEY, draw, nextArcs, type Arcs } from '../render/canvas2d.js';
import { easeScale, fitScale, frame, snapStep, type Camera } from '../render/camera.js';
import { EditorDocument } from './document.js';
import {
  addModule,
  addModuleTo,
  addToAssembly,
  addToAssemblyProblem,
  dissolveInstance,
  duplicateInstance,
  duplicatePlacement,
  countInstances,
  createAssembly,
  createAssemblyProblem,
  instanceHandle,
  instancePose,
  type InstancePose,
  instanceOf,
  moduleAt,
  resizePlacement,
  renameAssembly,
  renameProblem,
  setMirror,
  setRepetition,
  extentAlong,
  movePlacement,
  toPlacementAngle,
  positionHandle,
  removeCopy,
  removeInstance,
  snap,
  takeOutCount,
  takeOutOfAssembly,
  updatePlacement,
} from './edit.js';
import {
  emptyBlueprint,
  Library,
  nextName,
  toFileText,
  unusedName,
  type LibraryEntry,
} from './library.js';
import { battleHref, shipFleet } from './handoff.js';
import { Demonstration } from './demonstrate.js';
import { drawOverlay } from './overlay.js';
import {
  assemblyKnob,
  facingTo,
  shareTo,
  handleAt,
  handlesFor,
  resizedTo,
  seamBetween,
  seamTo,
  type Handle,
  type Seam,
} from './handles.js';
import {
  kindName,
  mountDefault,
  mountSummary,
  shipDefault,
  shipSummary,
  withMountField,
  withShipField,
  MOUNT_ROWS,
  SHIP_APPROACH_ROWS,
  SHIP_TARGETING_ROWS,
  type DoctrineRow,
} from './doctrine.js';
import { previewSnapshot } from './preview.js';
import { designStats, envelopes, assemblyMass, moduleReadout, type Envelopes } from './stats.js';

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

/** How much of the way a refit to another ship closes on its scale each frame. */
const FIT_EASE = 0.15;

/**
 * Rotation snap, degrees.
 *
 * Fixed where the position grid is not, because a right angle is a right angle
 * on any size of ship: an angle has no scale for the zoom to tell us about.
 */
const ANGLE_SNAP_DEGREES = 15;

/** What a freshly added module of each kind starts as, metres. */
const DEFAULTS: Record<ModuleSpec['kind'], Omit<ModuleSpec, 'x' | 'y'>> = {
  structure: { kind: 'structure', length: 8, width: 5 },
  core: { kind: 'core', length: 3, width: 3 },
  // Facing aft along its bell, so it pushes the ship forward.
  engine: { kind: 'engine', angle: math.PI, length: 3, width: 3 },
  turret: { kind: 'turret', angle: 0, length: 4, width: 3, barrels: 1 },
  beamTurret: { kind: 'beamTurret', angle: 0, length: 4, width: 3, barrels: 1 },
  // Longer than they are wide: a hull mount's length is mostly barrel, and one
  // drawn square would train through an angle worth nothing.
  hullGun: { kind: 'hullGun', angle: 0, length: 8, width: 4, barrels: 1 },
  hullBeam: { kind: 'hullBeam', angle: 0, length: 6, width: 4, barrels: 1 },
};

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`missing element #${id}`);
  return found as T;
}

type ModuleNumberField = 'angle' | 'reinforcement' | 'barrels' | 'nozzle' | 'traverse' | 'fuse' | 'fragments' | 'burstSpeed';

/** A module's own value for a field, with the default the parser would have applied. */
function moduleField(spec: ModuleSpec, key: ModuleNumberField): number {
  if (key === 'angle') return radiansToDegrees(spec.angle ?? 0);
  if (key === 'reinforcement') return spec.reinforcement ?? 1;
  if (key === 'nozzle') return spec.nozzle ?? DEFAULT_NOZZLE_SHARE;
  // What the mount would do if the layout said nothing, so the box shows the
  // arc it actually has rather than a blank.
  if (key === 'traverse') return radiansToDegrees(mountTraverse(spec));
  if (key === 'fuse') return spec.fuse ?? DEFAULT_FUSE;
  if (key === 'fragments') return spec.fragments ?? DEFAULT_FRAGMENTS;
  if (key === 'burstSpeed') return spec.burstSpeed ?? DEFAULT_BURST_SPEED;
  return spec.barrels ?? 1;
}

export function startEditor(): void {
  const canvas = el<HTMLCanvasElement>('view');
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('no 2d context');

  const library = new Library(window.localStorage);
  /**
   * Open a saved ship, or say so and hand back nothing.
   *
   * A layout that breaks the design rules is not this: it opens like any
   * other and the problems panel names what is wrong, which is the only way
   * such a ship can be put right. This is for a file that cannot be *read* —
   * storage holding what an older format wrote, or what someone typed into a
   * console — and the editor must not be left unusable by one.
   */
  const read = (name: string): Blueprint | null => {
    try {
      return library.load(name);
    } catch (error) {
      window.alert(
        `Could not read the saved ${name}.\n\n${error instanceof Error ? error.message : error}`,
      );
      return null;
    }
  };
  const doc = new EditorDocument(read('Corvette') ?? emptyBlueprint('New ship'));
  const camera: Camera = { x: 0, y: 0, scale: 8 };
  /**
   * The grid an edit snaps to, metres: a tenth of the grid on screen, so it
   * always suits the ship being looked at rather than the ship the constant
   * was picked for. Alt passes 0 instead, which is no snapping at all.
   */
  const snapMetres = (): number => snapStep(camera.scale);
  const snapshot = new Snapshot();
  const demonstration = new Demonstration();
  let fitPending = true;
  // The editor is where a mount's arcs are being decided, so it shows them all.
  let arcs: Arcs = 'trigger';
  /**
   * Refit to a different ship by easing the scale from the one before, so
   * switching between two ships shows which is bigger. The first fit, and F,
   * snap.
   */
  let easeFit = false;
  /** Wall time of the last animated frame, or 0 when nothing is animating. */
  let lastFrame = 0;
  let frameRequested = false;
  // Measured when the layout changes, not when the view moves. The holding
  // curve costs thousands of allocations; panning must not pay for them.
  let envelope: Envelopes | null = null;

  // ---- the controls -------------------------------------------------------

  const shipList = el<HTMLSelectElement>('ship');
  const shipName = el<HTMLInputElement>('shipName');
  const shipFighter = el<HTMLInputElement>('shipFighter');
  const shipFighterLabel = el<HTMLElement>('shipFighterLabel');
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
  const takeOutButton = el<HTMLButtonElement>('propTakeOut');
  const assemblyTakeOut = el<HTMLButtonElement>('assemblyTakeOut');
  const selectAssemblyButton = el<HTMLButtonElement>('propSelectAssembly');
  const assemblySelection = el<HTMLElement>('assemblySelection');
  const assemblyCount = el<HTMLElement>('assemblyCount');
  const assemblyButton = el<HTMLButtonElement>('propAssembly');
  const addToAssemblyButton = el<HTMLButtonElement>('propAddToAssembly');
  const assemblyPanel = el<HTMLElement>('assemblyPanel');
  const assemblyOf = el<HTMLElement>('assemblyOf');
  const assemblyName = el<HTMLInputElement>('assemblyName');
  const assemblyStats = el<HTMLElement>('assemblyStats');
  const assemblyX = el<HTMLInputElement>('assemblyX');
  const assemblyY = el<HTMLInputElement>('assemblyY');
  const assemblyAngle = el<HTMLInputElement>('assemblyAngle');
  const assemblyMirror = el<HTMLInputElement>('assemblyMirror');
  const assemblyRepeat = el<HTMLInputElement>('assemblyRepeat');
  const assemblyStepRow = el<HTMLElement>('assemblyStepRow');
  const assemblyStepAngleRow = el<HTMLElement>('assemblyStepAngleRow');
  const assemblyStepX = el<HTMLInputElement>('assemblyStepX');
  const assemblyStepY = el<HTMLInputElement>('assemblyStepY');
  const assemblyStepAngle = el<HTMLInputElement>('assemblyStepAngle');
  const assemblyDuplicate = el<HTMLButtonElement>('assemblyDuplicate');
  const assemblyDissolve = el<HTMLButtonElement>('assemblyDissolve');
  const assemblyDelete = el<HTMLButtonElement>('assemblyDelete');
  const saveButton = el<HTMLButtonElement>('saveShip');
  const exportButton = el<HTMLButtonElement>('exportShip');

  const weaponInput = el<HTMLInputElement>('propWeapon');
  const thickInput = el<HTMLInputElement>('propThick');
  const thickTitle = thickInput.title;
  const kindSelect = el<HTMLSelectElement>('propKind');
  const addHeading = el<HTMLElement>('addHeading');
  kindSelect.innerHTML = MODULE_KINDS.map(
    (kind) => `<option value="${kind}">${kindName(kind)}</option>`,
  ).join('');

  const mountDoctrine = el<HTMLDetailsElement>('mountDoctrine');
  const mountDoctrineSummary = el<HTMLElement>('mountDoctrineSummary');
  const mountDoctrineReset = el<HTMLButtonElement>('mountDoctrineReset');
  const shipDoctrine = el<HTMLDetailsElement>('shipDoctrine');
  const shipDoctrineSummary = el<HTMLElement>('shipDoctrineSummary');
  const shipDoctrineReset = el<HTMLButtonElement>('shipDoctrineReset');

  const propInputs: Record<string, HTMLInputElement | HTMLTextAreaElement> = {
    x: el<HTMLInputElement>('propX'),
    y: el<HTMLInputElement>('propY'),
    angle: el<HTMLInputElement>('propAngle'),
    length: el<HTMLInputElement>('propLength'),
    width: el<HTMLInputElement>('propWidth'),
    reinforcement: el<HTMLInputElement>('propReinforcement'),
    barrels: el<HTMLInputElement>('propBarrels'),
    nozzle: el<HTMLInputElement>('propNozzle'),
    traverse: el<HTMLInputElement>('propTraverse'),
    fuse: el<HTMLInputElement>('propFuse'),
    fragments: el<HTMLInputElement>('propFragments'),
    burstSpeed: el<HTMLInputElement>('propBurstSpeed'),
    notes: el<HTMLTextAreaElement>('propNotes'),
  };

  // ---- redraw and repaint -------------------------------------------------

  const resize = (): void => {
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = max(1, Math.round(rect.width * ratio));
    canvas.height = max(1, Math.round(rect.height * ratio));
  };

  /**
   * Two selected modules that share a face, and the seam between them — or
   * null. Each is the exact copy picked, and two copies of one shared part are
   * not offered, since sizing one sizes the other.
   */
  const seamPair = (): {
    a: { spec: ModuleSpec; origin: ModuleOrigin };
    b: { spec: ModuleSpec; origin: ModuleOrigin };
    seam: Seam;
  } | null => {
    if (doc.selections.length !== 2) return null;
    const [first, second] = doc.selections as [ModulePath, ModulePath];
    if (samePlacement(first, second)) return null;
    const picked = (path: ModulePath) => {
      const placement = placementAt(doc.blueprint, path);
      if (placement === null || isInstance(placement)) return null;
      const key = JSON.stringify(path);
      const drawn = doc.view.origins.findIndex((o) => JSON.stringify(o.path) === key);
      if (drawn < 0) return null;
      return { spec: doc.view.modules[drawn]!, origin: doc.view.origins[drawn]! };
    };
    const a = picked(first);
    const b = picked(second);
    if (a === null || b === null) return null;
    const seam = seamBetween(a.spec, b.spec);
    return seam === null ? null : { a, b, seam };
  };

  /**
   * The grab points on the selection, or none.
   *
   * Only for a single module: an assembly has no size, and several modules picked
   * at once have no one box to size or turn. The copy they sit on is the one
   * under the pointer, which is the copy the highlight draws brightest and the
   * one a drag would move.
   */
  /** The selected assembly's pose, in the copy that was picked, and the modules it draws there. */
  const selectedAssemblyPose = (): { path: ModulePath; pose: InstancePose; modules: ModuleSpec[] } | null => {
    const path = doc.selectedAssemblyPath();
    if (path === null) return null;
    // The outlines are of every placement of the assembly; the ones that are
    // this instance's are those whose modules it accounts for.
    const under = (drawn: number) => {
      const at = doc.view.origins[drawn]?.path;
      return at !== undefined && path.every((step, k) => step.index === at[k]?.index && step.copy === at[k]?.copy);
    };
    const own = doc.selectedAssemblies().filter((each) => !each.context && under(each.modules[0]!));
    const outline = own.find((each) => each.primary) ?? own[0];
    const near = outline === undefined ? null : doc.view.origins[outline.modules[0]!]!.path;
    const pose = instancePose(doc.blueprint, path, near);
    if (pose === null) return null;
    return { path, pose, modules: (outline?.modules ?? []).map((i) => doc.view.modules[i]!) };
  };

  const currentHandles = (): Handle[] => {
    const seam = seamPair();
    if (seam !== null) return [seam.seam.handle];
    if (doc.selections.length !== 1) return [];
    const assembly = selectedAssemblyPose();
    if (assembly !== null) return [assemblyKnob(assembly.pose, assembly.modules, camera.scale)];
    const drawn = doc.selectedLoose()[0];
    if (drawn === undefined) return [];
    const spec = doc.view.modules[drawn];
    return spec === undefined ? [] : handlesFor(spec, camera.scale);
  };

  /**
   * Put the spatial number boxes on the same grid the canvas snaps to.
   *
   * A box's arrows and a drag are two ways of saying the same thing, so they
   * have to move by the same amount — otherwise a module nudged with an arrow
   * key lands off the grid its neighbours abut on, which is the one failure
   * the snap exists to prevent. The size boxes take it as their floor as well,
   * since a module smaller than one step of the grid cannot sit on it.
   */
  const matchBoxesToGrid = (): void => {
    const step = String(snapMetres());
    for (const key of ['x', 'y', 'length', 'width'] as const) {
      const input = propInputs[key];
      if (!(input instanceof HTMLInputElement) || input.step === step) continue;
      input.step = step;
      if (key === 'length' || key === 'width') input.min = step;
    }
  };

  const render = (): void => {
    matchBoxesToGrid();
    const view = doc.view;
    if (view.design !== null) {
      previewSnapshot(view.design, snapshot);
      if (fitPending) {
        // Snap rather than ease: a layout being fitted has no motion to follow.
        frame(camera, snapshot, canvas.width, canvas.height, 1);
        fitPending = false;
        easeFit = false;
      } else if (easeFit) {
        const want = fitScale(snapshot, canvas.width, canvas.height);
        camera.x = (snapshot.minX + snapshot.maxX) / 2;
        camera.y = (snapshot.minY + snapshot.maxY) / 2;
        camera.scale = easeScale(camera.scale, want, FIT_EASE);
        easeFit = camera.scale !== want;
        if (easeFit) requestFrame();
      }
    } else {
      snapshot.shipCount = 0;
    }
    if (view.design !== null) demonstration.writeInto(snapshot);
    draw(ctx, snapshot, camera, canvas.width, canvas.height, undefined, arcs);
    drawOverlay(
      ctx,
      {
        design: view.design,
        modules: view.modules,
        selected: doc.selectedLoose(),
        assemblies: doc.selectedAssemblies(),
        faulty: view.faulty,
        handles: currentHandles(),
        envelope,
      },
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
      ['Modules', `${s.moduleCount} (${s.engineCount} engines)`],
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
    // A selected assembly is dragged as one thing, which is the point of having
    // selected the assembly rather than a part of it.
    const assembly = doc.selectedAssemblyPath();
    if (assembly !== null) {
      const handle = instanceHandle(doc.view.origins, assembly);
      return handle === null ? null : { origin: handle, perCopy: true };
    }
    const origin = doc.selectedOrigin();
    return origin === null ? null : positionHandle(doc.blueprint, origin);
  };

  /**
   * A placed assembly: where it sits, how far it is turned, and which way round.
   *
   * Separate from the module panel because it edits a different thing. A
   * module has a size and a kind; an instance has only a *pose*, and the whole
   * reason it is worth reaching is `mirror` — the flag that makes a second
   * copy of a wing the other wing rather than the same one again.
   */
  /** Enable a Take out button for what `path` names, saying what it will leave. */
  const offerTakeOut = (button: HTMLButtonElement, path: ModulePath | null, what: string): void => {
    const leaving = path === null ? 0 : takeOutCount(doc.blueprint, path);
    button.disabled = leaving === 0;
    button.title =
      leaving === 0
        ? `This ${what} is not inside an assembly`
        : leaving === 1
          ? `Take this ${what} out of its assembly, leaving it where it is`
          : `Take this ${what} out of its assembly, leaving a separate one beside each of its ${leaving} copies`;
  };

  const renderAssembly = (instance: AssemblyInstance): void => {
    const members = doc.blueprint.assemblies?.[instance.use]?.modules ?? [];
    const nested = members.filter((member) => !isModuleSpec(member)).length;
    const modules = members.length - nested;
    const path = doc.selection;
    const drawn = path === null ? 0 : doc.accountedFor(path);
    const counted = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
    const parts = [
      ...(modules > 0 || nested === 0 ? [counted(modules, 'module', 'modules')] : []),
      ...(nested > 0 ? [counted(nested, 'assembly', 'assemblies')] : []),
    ];
    assemblyOf.textContent =
      parts.join(' and ') + (drawn > members.length ? `, and this copy draws ${drawn}` : '');
    if (document.activeElement !== assemblyName) assemblyName.value = instance.use;
    offerTakeOut(assemblyTakeOut, path, 'assembly');
    renderAssemblyStats();
    for (const [input, value] of [
      [assemblyX, instance.x],
      [assemblyY, instance.y],
      [assemblyAngle, radiansToDegrees(instance.angle ?? 0)],
    ] as const) {
      if (document.activeElement !== input) input.value = String(value);
    }
    assemblyMirror.checked = instance.mirror === true;

    const copies = instance.repeat ?? 1;
    if (document.activeElement !== assemblyRepeat) assemblyRepeat.value = String(copies);
    assemblyRepeat.max = String(MAX_REPEAT);
    // A step with one copy places nothing, so the boxes are not there to be
    // filled in: the count is what turns an assembly into a row, and the step is
    // what that row is made of.
    assemblyStepRow.hidden = copies < 2;
    assemblyStepAngleRow.hidden = copies < 2;
    const step = instance.step;
    if (step !== undefined) {
      for (const [input, value] of [
        [assemblyStepX, step.x],
        [assemblyStepY, step.y],
        [assemblyStepAngle, radiansToDegrees(step.angle ?? 0)],
      ] as const) {
        if (document.activeElement !== input) input.value = String(value);
      }
    }
  };

  /**
   * What an assembly weighs.
   *
   * The one figure that bubbles up from modules to the assembly: a sum means the
   * same thing about a part of a ship as it does about a module, where
   * capacity, armour, hit points and thrust each describe something a bag of
   * modules has no single answer for. Every copy is counted separately when
   * there is more than one, because what an assembly costs the ship is what all of
   * it costs.
   */
  const renderAssemblyStats = (): void => {
    const outlines = doc.selectedAssemblies().filter((assembly) => !assembly.context);
    const own = outlines.find((assembly) => assembly.primary) ?? outlines[0];
    if (own === undefined) {
      assemblyStats.innerHTML = '';
      return;
    }
    const specs = own.modules.map((index) => doc.view.modules[index]!);
    const mass = assemblyMass(specs);
    const rows = [['Mass', `${numbers(mass / 1000, 2)} t`]];
    if (outlines.length > 1) {
      const all = outlines.flatMap((assembly) => assembly.modules).map((i) => doc.view.modules[i]!);
      rows.push([`All ${outlines.length} copies`, `${numbers(assemblyMass(all) / 1000, 2)} t`]);
    }
    assemblyStats.innerHTML = `<table>${rows
      .map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`)
      .join('')}</table>`;
  };

  /**
   * What can be done with several things picked at once: make an assembly of
   * them, or put the rest of them into the last assembly picked.
   * Both are offered whenever both are possible, and the panel says what each
   * would do, or why it cannot.
   */
  const renderSelectionOfSeveral = (picked: number): void => {
    const why = createAssemblyProblem(doc.blueprint, doc.selections);
    assemblyButton.disabled = why !== null;

    const adding = doc.additionTarget();
    const into = adding === null ? null : placementAt(doc.blueprint, adding.assembly);
    const name = into !== null && !isModuleSpec(into) ? (into as AssemblyInstance).use : null;
    const addWhy =
      adding === null
        ? 'Pick an assembly to add the rest of the selection to'
        : addToAssemblyProblem(doc.blueprint, adding.assembly, adding.members);
    addToAssemblyButton.disabled = adding === null || addWhy !== null;
    addToAssemblyButton.textContent = name === null ? 'Add to assembly' : `Add to ${name}`;
    addToAssemblyButton.title = addWhy ?? `Move the rest of the selection into ${name}`;

    const lines = [
      why === null
        ? `${picked} picked. Create assembly makes them one part, built around the first one picked.`
        : why,
    ];
    if (adding !== null && addWhy === null && name !== null) {
      // Said out loud because it is the bargain rather than a surprise: what
      // goes in joins every copy of the assembly, so the ship gains it per copy.
      const spread =
        countInstances(doc.blueprint, name) > 1 ? ' It is placed more than once, and every copy gains them.' : '';
      lines.push(`Add to ${name} moves the other ${adding.members.length} into it.${spread}`);
    }
    assemblyCount.textContent = lines.join(' ');
  };

  const renderProperties = (): void => {
    const into = doc.selectedAssemblyPath();
    const target = into === null ? null : placementAt(doc.blueprint, into);
    addHeading.textContent =
      target !== null && !isModuleSpec(target)
        ? `Add a module to ${(target as AssemblyInstance).use}`
        : 'Add a module';
    const placement = doc.selectedPlacement;
    const copies = doc.selectedModules().length;

    // Three panels, one selection: several modules picked offers only what can
    // be done to a set, an instance is an assembly's pose rather than a module's
    // properties, and a single module is the ordinary case.
    const picked = doc.selections.length;
    assemblySelection.hidden = picked < 2;
    if (picked >= 2) renderSelectionOfSeveral(picked);

    // With several things picked, only what can be done to a *set* is offered:
    // a panel editing one of them would be editing whichever happened to be
    // first, which is not a thing anybody asked for.
    const single = picked < 2;
    assemblyPanel.hidden = !single || placement === null || isModuleSpec(placement) === true;
    if (!assemblyPanel.hidden) renderAssembly(placement as AssemblyInstance);

    if (!single || placement === null || isModuleSpec(placement) === false) {
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
    kindSelect.value = spec.kind;
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
      else input.value = String(moduleField(spec, key as ModuleNumberField));
    }
    // Offered on a beam mount as well as a gun, and on an engine. More of
    // them is worse for a beam — the aperture is divided between them and only
    // one fires at a time — but worse is a thing somebody may want: a bank of
    // emitters is a look, and the editor's job is to say what a layout costs
    // rather than to refuse the ones it would not have chosen.
    //
    // One field, three words for it: a gun's outlets are barrels, a beam's are
    // the apertures the light leaves by, and an engine's are nozzles. Calling
    // any of them a barrel on the one panel that is supposed to explain a
    // mount would be the tool teaching the wrong thing about it. The
    // blueprint's own key stays `barrels` whatever it is labelled, since
    // renaming a field in the format would cost every file ever saved.
    const nozzles = spec.kind === 'engine';
    const hullMount = isHullMount(spec.kind);
    el<HTMLElement>('barrelsRow').hidden =
      !nozzles && !hullMount && spec.kind !== 'turret' && spec.kind !== 'beamTurret';
    el<HTMLElement>('barrelsLabel').textContent = nozzles
      ? 'nozzles'
      : spec.kind === 'beamTurret'
        ? 'emitters'
        : 'barrels';
    // The same field again: what sticks out of the module, named for the kind
    // showing it — a bell, a barrel, or the housing round a lens.
    el<HTMLElement>('traverseRow').hidden = !isWeaponMount(spec.kind);
    el<HTMLElement>('shellRow').hidden = !readsFuse(spec.kind);
    // Solid shot has no burst to time or to size.
    const shells = firesShells(spec);
    el<HTMLInputElement>('propFuse').disabled = !shells;
    el<HTMLInputElement>('propBurstSpeed').disabled = !shells;
    el<HTMLElement>('nozzleRow').hidden = !nozzles && !hullMount;
    el<HTMLElement>('nozzleLabel').textContent = nozzles
      ? 'nozzle'
      : spec.kind === 'hullBeam'
        ? 'lens'
        : 'barrel';
    // Only an engine has a plume to point.
    el<HTMLElement>('weaponRow').hidden = spec.kind !== 'engine';
    weaponInput.checked = spec.weapon === true;
    el<HTMLElement>('thickRow').hidden = !readsThick(spec.kind);
    // One no more than a deck across is as deep as it is wide either way.
    thickInput.disabled = !canThicken(spec) || doc.blueprint.fighter === true;
    thickInput.checked = isThick(spec);
    thickInput.title = thickInput.disabled
      ? doc.blueprint.fighter === true && canThicken(spec)
        ? 'A fighter has nothing thick.'
        : spec.kind === 'engine'
        ? 'Too narrow to be thick: each nozzle is no more than a deck wide, so already as deep as it is wide.'
        : 'Too narrow to be thick: no more than a deck across, so already as deep as it is wide.'
      : thickTitle;

    const origin = doc.selectedOrigin();
    offerTakeOut(takeOutButton, origin === null ? null : origin.path, 'module');

    const within = origin === null ? null : instanceOf(origin);
    selectAssemblyButton.disabled = within === null;
    selectAssemblyButton.title =
      within === null
        ? 'This module is not in an assembly'
        : 'Edit where the assembly sits, how far it is turned, and whether it is mirrored';

    linked.hidden = copies < 2;
    linked.textContent =
      copies < 2
        ? ''
        : `Shared: drawn ${copies} times. Size, facing and notes change every copy; ` +
          `position moves this one.`;

    renderDoctrine(spec, sameModule);
    renderModuleStats(spec, doc.selectedModules()[0] ?? -1);
  };

  /**
   * The doctrine boxes, built from the field lists rather than written out in
   * the page.
   *
   * A doctrine number added in `sim/doctrine.ts` then appears here by itself,
   * which is the only way a panel of twenty-one numbers stays in step with the
   * thing it is editing. The half a box belongs to is part of its key, since
   * the two halves are separate objects with no field names in common to rely
   * on.
   */
  const doctrineInputs = new Map<string, HTMLInputElement>();

  const buildDoctrine = (into: HTMLElement, rows: readonly DoctrineRow[], half: string): void => {
    for (const row of rows) {
      const field = document.createElement('div');
      field.className = 'field';
      const label = document.createElement('label');
      const id = `doctrine-${half}-${row.field}`;
      label.htmlFor = id;
      label.textContent = row.label;
      const input = document.createElement('input');
      input.id = id;
      input.type = 'number';
      input.step = String(row.step);
      input.title = row.hint;
      label.title = row.hint;
      field.append(label, input);
      into.append(field);
      doctrineInputs.set(`${half}.${row.field}`, input);
    }
  };

  buildDoctrine(el<HTMLElement>('mountDoctrineFields'), MOUNT_ROWS, 'mount');
  buildDoctrine(el<HTMLElement>('shipTargetingFields'), SHIP_TARGETING_ROWS, 'targeting');
  buildDoctrine(el<HTMLElement>('shipApproachFields'), SHIP_APPROACH_ROWS, 'approach');

  /**
   * Show a doctrine box: the stated value, or nothing over a placeholder of
   * what would happen anyway.
   *
   * Empty meaning "the default" rather than zero is the whole of what makes
   * the panel optional, so the placeholder is not decoration — it is the box
   * saying what it will do if left alone.
   */
  const showDoctrineValue = (
    input: HTMLInputElement,
    held: number | undefined,
    fallback: number,
    sameThing: boolean,
  ): void => {
    input.placeholder = String(fallback);
    if (sameThing && document.activeElement === input) return;
    input.value = held === undefined || held === fallback ? '' : String(held);
    input.classList.toggle('stated', input.value !== '');
  };

  /**
   * Which doctrine the selection is about, if any.
   *
   * A weapon is asked what it shoots at, and a core is asked what its *ship*
   * does — which is the ship's one doctrine rather than that core's, since a
   * ship has one and a core is simply where it is edited from. Everything
   * else is asked nothing, and neither section appears.
   */
  const renderDoctrine = (spec: ModuleSpec, sameThing: boolean): void => {
    const weapon = isWeaponMount(spec.kind);
    const core = spec.kind === 'core';
    mountDoctrine.hidden = !weapon;
    shipDoctrine.hidden = !core;
    if (weapon) {
      const held = (spec.targeting ?? {}) as Record<string, number | undefined>;
      mountDoctrineSummary.textContent = mountSummary(spec.kind, spec.targeting);
      mountDoctrineReset.disabled = spec.targeting === undefined;
      mountDoctrineReset.title = `Take this ${kindName(spec.kind)} back to what its archetype does`;
      for (const row of MOUNT_ROWS) {
        const input = doctrineInputs.get(`mount.${row.field}`)!;
        showDoctrineValue(input, held[row.field], mountDefault(spec.kind, row.field), sameThing);
      }
    }
    if (core) {
      const doctrine = doc.blueprint.doctrine;
      shipDoctrineSummary.textContent = shipSummary(doctrine);
      shipDoctrineReset.disabled = doctrine === undefined;
      for (const [half, rows] of [
        ['targeting', SHIP_TARGETING_ROWS],
        ['approach', SHIP_APPROACH_ROWS],
      ] as const) {
        const held = doctrine?.[half] as unknown as Record<string, number> | undefined;
        for (const row of rows) {
          const input = doctrineInputs.get(`${half}.${row.field}`)!;
          showDoctrineValue(input, held?.[row.field], shipDefault(half, row.field), sameThing);
        }
      }
    }
  };

  const renderModuleStats = (spec: ModuleSpec, index: number): void => {
    // Given the whole layout, so a turret's arc can be worked out from what is
    // around it — the one figure on this panel that is not a property of the
    // module alone.
    const readout = moduleReadout(spec, doc.view.modules, index, doc.view.design?.radius ?? 0);
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
          `${numbers(readout.gun.traverseRate)} °/s</td></tr>` +
          (readout.gun.triggerRange == null
            ? ''
            : `<tr><th>Fires within</th><td>${numbers(readout.gun.triggerRange, 0)} m of what its doctrine wants</td></tr>`);
    moduleStats.innerHTML = `<table>${rows}${gun}</table>`;
  };

  /**
   * What opening one entry asks for.
   *
   * A shipped ship shadowed by a saved copy needs a value of its own, since
   * the two entries share a name and are different layouts. A saved ship
   * called `stock:Corvette` would collide with the prefix, which is a name
   * nobody has and would open the wrong ship rather than break the page.
   */
  const STOCK = 'stock:';
  const optionValue = (entry: LibraryEntry): string =>
    entry.stock && entry.saved ? STOCK + entry.name : entry.name;

  const renderLibrary = (): void => {
    const entries = library.list();
    const selected = doc.blueprint.name;
    // Opening a name gives the saved copy where there is one, so a shadowed
    // shipped ship is listed but never the entry shown as selected.
    shipList.innerHTML = entries
      .map((entry) => {
        const chosen = entry.name === selected && !(entry.stock && entry.saved);
        const label = entry.stock ? (entry.saved ? ' (stock)' : '') : ' •';
        return (
          `<option value="${escapeHtml(optionValue(entry))}"${chosen ? ' selected' : ''}>` +
          `${escapeHtml(entry.name)}${label}</option>`
        );
      })
      .join('');
    if (!entries.some((entry) => entry.name === selected)) {
      shipList.insertAdjacentHTML(
        'afterbegin',
        `<option value="${escapeHtml(selected)}" selected>${escapeHtml(selected)} (unsaved)</option>`,
      );
    }
    deleteShipButton.disabled = !library.savedNames().includes(selected);
  };

  /**
   * The fighter box, and what it rules out: turrets and thick modules cannot
   * be added while it is set. A layout that already has one flies as an
   * ordinary ship, and the box says so rather than refusing it.
   */
  const renderFighter = (design: ShipDesign | null): void => {
    const asked = doc.blueprint.fighter === true;
    shipFighter.checked = asked;
    const problem = asked && design !== null && !design.fighter ? fighterProblem(design.modules.map((m) => m.spec)) : null;
    shipFighterLabel.title =
      problem !== null
        ? `Flies as an ordinary ship: ${problem}.`
        : 'A strike craft: no turrets and nothing thick. It flies in the weapons layer, and drops into the hull layer as well only when its doctrine commits it, to ram or dock.';
    shipFighterLabel.classList.toggle('warn', problem !== null);
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-add="turret"], [data-add="beamTurret"]')) {
      button.disabled = asked;
    }
    for (const option of kindSelect.options) {
      option.disabled = asked && (option.value === 'turret' || option.value === 'beamTurret');
    }
  };

  const refresh = (): void => {
    const design = doc.view.design;
    envelope = design === null ? null : envelopes(design);
    if (document.activeElement !== shipName) shipName.value = doc.blueprint.name;
    renderFighter(design);
    if (document.activeElement !== shipNotes) shipNotes.value = doc.blueprint.notes ?? '';
    undoButton.disabled = !doc.canUndo;
    redoButton.disabled = !doc.canRedo;
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

  /**
   * A doctrine field being typed into.
   *
   * An empty box is not a number and not zero: it is the statement being
   * taken back out, so the blueprint stops saying anything about that field
   * and the archetype covers it again.
   */
  const editDoctrine = (half: string, field: string, input: HTMLInputElement): void => {
    const text = input.value.trim();
    if (text !== '' && !Number.isFinite(Number(text))) return;
    let value = text === '' ? null : Number(text);
    if (half === 'mount') {
      const path = doc.selection;
      if (path === null) return;
      // Typing what the archetype already does is not a statement, so the
      // blueprint stops carrying one rather than freezing today's value into
      // the file. The box goes back to showing it as a placeholder.
      const spec = doc.selectedPlacement as ModuleSpec | null;
      if (spec !== null && value === mountDefault(spec.kind, field)) value = null;
      change(
        updatePlacement(doc.blueprint, path, (placement) => {
          const next = { ...placement } as ModuleSpec;
          const targeting = withMountField(next.targeting, field, value);
          if (targeting === undefined) delete next.targeting;
          else next.targeting = targeting;
          return next as Placement;
        }),
        true,
      );
      return;
    }
    const doctrine = withShipField(doc.blueprint.doctrine, half as 'targeting' | 'approach', field, value);
    const next = { ...doc.blueprint };
    if (doctrine === undefined) delete next.doctrine;
    else next.doctrine = doctrine;
    change(next, true);
  };

  for (const [key, input] of doctrineInputs) {
    const [half, field] = key.split('.') as [string, string];
    input.addEventListener('focus', () => {
      gesture = false;
    });
    input.addEventListener('input', () => editDoctrine(half, field, input));
  }

  mountDoctrineReset.addEventListener('click', () => {
    const path = doc.selection;
    if (path === null) return;
    change(
      updatePlacement(doc.blueprint, path, (placement) => {
        const next = { ...placement } as ModuleSpec;
        delete next.targeting;
        return next as Placement;
      }),
    );
  });

  shipDoctrineReset.addEventListener('click', () => {
    const next = { ...doc.blueprint };
    delete next.doctrine;
    change(next);
  });

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
      if (key === 'angle' || key === 'traverse') {
        editSelected({ [key]: degreesToRadians(value) } as Partial<ModuleSpec>, true);
      }
      else editSelected({ [key]: value } as Partial<ModuleSpec>, true);
    });
  }

  // Every copy of a shared part is swapped, as any other edit to it is.
  kindSelect.addEventListener('change', () => {
    const path = doc.selection;
    if (path === null) return;
    const to = kindSelect.value as ModuleKind;
    change(
      updatePlacement(doc.blueprint, path, (placement) =>
        isModuleSpec(placement) ? refitModule(placement as ModuleSpec, to) : placement,
      ),
    );
  });

  weaponInput.addEventListener('change', () => {
    const path = doc.selection;
    if (path === null) return;
    const on = weaponInput.checked;
    // Absent rather than false when it is off, so a blueprint file only ever
    // says the unusual thing. A tick is one discrete act, so it takes an undo
    // step of its own rather than amending whatever came before it.
    change(
      updatePlacement(doc.blueprint, path, (placement) => {
        if (!('kind' in placement)) return placement;
        const next = { ...placement };
        if (on) next.weapon = true;
        else delete next.weapon;
        return next;
      }),
    );
  });

  thickInput.addEventListener('change', () => {
    const path = doc.selection;
    if (path === null) return;
    const on = thickInput.checked;
    // Absent rather than false when it is off, as `weapon` is.
    change(
      updatePlacement(doc.blueprint, path, (placement) => {
        if (!('kind' in placement)) return placement;
        const next = { ...placement };
        if (on) next.thick = true;
        else delete next.thick;
        return next;
      }),
    );
  });

  const deleteSelected = (): void => {
    const assembly = doc.selectedAssemblyPath();
    if (assembly !== null) {
      change(removeInstance(doc.blueprint, assembly));
      return;
    }
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

  assemblyButton.addEventListener('click', () => {
    const assembled = createAssembly(doc.blueprint, doc.selections);
    if (assembled === null) return;
    doc.apply(assembled.blueprint);
    // Selected straight away, because the next thing anybody does with a new
    // assembly is place it again or mirror it, and both live on its own panel.
    doc.select(assembled.path);
    refresh();
  });

  addToAssemblyButton.addEventListener('click', () => {
    const adding = doc.additionTarget();
    if (adding === null) return;
    const next = addToAssembly(doc.blueprint, adding.assembly, adding.members);
    if (next === null) return;
    doc.apply(next.blueprint);
    // The assembly is what is left, and what the player is now working on. Its own
    // path, not the one picked: taking the modules out moved it up the list.
    doc.select(next.path);
    refresh();
  });

  selectAssemblyButton.addEventListener('click', () => {
    const origin = doc.selectedOrigin();
    if (origin === null) return;
    const path = instanceOf(origin);
    if (path === null) return;
    // The copy the module was picked in, not whichever the layout drew first.
    doc.selectAt(doc.selectedModules()[0] ?? 0, path);
    refresh();
  });

  const editInstance = (patch: Partial<AssemblyInstance>, continues: boolean): void => {
    const path = doc.selection;
    if (path === null) return;
    change(
      updatePlacement(doc.blueprint, path, (placement) => ({ ...placement, ...patch }) as Placement),
      continues,
    );
  };

  for (const [input, key] of [
    [assemblyX, 'x'],
    [assemblyY, 'y'],
  ] as const) {
    input.addEventListener('input', () => {
      const value = Number(input.value);
      if (Number.isFinite(value)) editInstance({ [key]: value }, true);
    });
    input.addEventListener('change', () => {
      gesture = false;
    });
  }

  assemblyAngle.addEventListener('input', () => {
    const value = Number(assemblyAngle.value);
    if (Number.isFinite(value)) editInstance({ angle: degreesToRadians(value) }, true);
  });
  assemblyAngle.addEventListener('change', () => {
    gesture = false;
  });

  // Live, like the ship's own name, so the box holds what is being typed and
  // the layout takes it as soon as it is a name it can use. A name already
  // taken is simply not applied — the assembly keeps the one it has, and the
  // panel says why rather than putting the old text back mid-word.
  assemblyName.addEventListener('input', () => {
    const path = doc.selection;
    if (path === null) return;
    const why = renameProblem(doc.blueprint, path, assemblyName.value);
    if (why !== null) {
      assemblyOf.textContent = why;
      return;
    }
    change(renameAssembly(doc.blueprint, path, assemblyName.value), true);
  });
  assemblyName.addEventListener('focus', () => {
    gesture = false;
  });
  assemblyName.addEventListener('change', () => {
    gesture = false;
  });

  /**
   * The step to give an assembly that is being repeated for the first time: its
   * own length along the row, so the second copy lands beyond the first.
   *
   * Measured off the drawn copy rather than guessed, and snapped to the same
   * grid a drag moves on, so the number that appears in the box is one
   * somebody could have typed. Zero would be the alternative, and it is the
   * one answer certain to be wrong: every copy would land on the first.
   */
  const stepClearOfAssembly = (): { x: number; y: number } => {
    const outline = doc.selectedAssemblies().find((assembly) => assembly.primary);
    const specs = (outline?.modules ?? []).map((index) => doc.view.modules[index]!);
    const rotation = doc.selectedOrigin()?.rotation ?? 0;
    const along = specs.length === 0 ? 0 : extentAlong(specs, rotation);
    const step = snapMetres();
    return { x: max(step, snap(along, step)), y: 0 };
  };

  const repeatOf = (): { repeat: number; step: { x: number; y: number; angle?: number } } => {
    const placement = doc.selectedPlacement;
    const instance = placement !== null && !isModuleSpec(placement) ? (placement as AssemblyInstance) : null;
    return {
      repeat: instance?.repeat ?? 1,
      step: instance?.step ?? stepClearOfAssembly(),
    };
  };

  assemblyRepeat.addEventListener('input', () => {
    const path = doc.selection;
    const value = Number(assemblyRepeat.value);
    if (path === null || !Number.isFinite(value)) return;
    const copies = Math.max(1, Math.min(MAX_REPEAT, Math.round(value)));
    change(setRepetition(doc.blueprint, path, copies, repeatOf().step), true);
  });
  assemblyRepeat.addEventListener('change', () => {
    gesture = false;
  });

  for (const [input, key] of [
    [assemblyStepX, 'x'],
    [assemblyStepY, 'y'],
    [assemblyStepAngle, 'angle'],
  ] as const) {
    input.addEventListener('input', () => {
      const path = doc.selection;
      const value = Number(input.value);
      if (path === null || !Number.isFinite(value)) return;
      const current = repeatOf();
      const step = { ...current.step };
      if (key === 'angle') step.angle = degreesToRadians(value);
      else step[key] = value;
      change(setRepetition(doc.blueprint, path, current.repeat, step), true);
    });
    input.addEventListener('change', () => {
      gesture = false;
    });
  }

  assemblyMirror.addEventListener('change', () => {
    const path = doc.selection;
    if (path === null) return;
    change(setMirror(doc.blueprint, path, assemblyMirror.checked));
  });

  assemblyDuplicate.addEventListener('click', () => {
    const path = doc.selection;
    if (path === null) return;
    const placed = duplicateInstance(doc.blueprint, path);
    if (placed === null) return;
    doc.apply(placed.blueprint);
    // The new copy is selected, not the old one: it is the one about to be
    // mirrored or dragged.
    doc.select(placed.path);
    refresh();
  });

  assemblyDissolve.addEventListener('click', () => {
    const path = doc.selection;
    if (path === null) return;
    const dissolved = dissolveInstance(doc.blueprint, path);
    if (dissolved === null) return;
    doc.apply(dissolved.blueprint);
    // What it was made of stays picked, ready to be assembled differently.
    doc.select(dissolved.paths[0] ?? null);
    for (const each of dissolved.paths.slice(1)) doc.togglePath(each);
    refresh();
  });

  assemblyDelete.addEventListener('click', deleteSelected);

  /** Take what `path` names out of its assembly, keeping the loose copy it leaves picked. */
  const takeOut = (path: ModulePath | null): void => {
    if (path === null) return;
    const taken = takeOutOfAssembly(doc.blueprint, path);
    if (taken === null) return;
    doc.apply(taken.blueprint);
    doc.select(taken.path);
    refresh();
  };
  takeOutButton.addEventListener('click', () => takeOut(doc.selectedOrigin()?.path ?? null));
  assemblyTakeOut.addEventListener('click', () => takeOut(doc.selection));

  /**
   * A module a member of the selected copy was written beside: its frame is the
   * assembly's on screen, so a new module can face the way it would on the ship.
   */
  const memberOf = (instance: ModulePath): number => {
    const own = (i: number) => {
      const inner = instanceOf(doc.view.origins[i]!);
      return inner !== null && samePlacement(inner, instance);
    };
    const grabbed = doc.highlightedModules().find(own);
    return grabbed ?? doc.view.origins.findIndex((_, i) => own(i));
  };

  const addInto = (instance: ModulePath, spec: ModuleSpec): void => {
    const member = memberOf(instance);
    const frame = member < 0 ? null : doc.view.origins[member]!;
    const written = frame === null ? spec : { ...spec, angle: toPlacementAngle(frame, spec.angle ?? 0) };
    const added = addModuleTo(doc.blueprint, instance, written);
    if (added === null) return;
    doc.apply(added.blueprint);
    // The copy that was selected, not whichever one the layout drew first.
    const depth = instance.length;
    const same = (a: ModulePath, b: ModulePath) =>
      a.slice(0, depth).every((step, k) => step.index === b[k]?.index && step.copy === b[k]?.copy);
    const drawn = doc.view.origins.findIndex(
      (origin) => samePlacement(origin.path, added.path) && (frame === null || same(origin.path, frame.path)),
    );
    if (drawn >= 0) doc.selectAt(drawn, added.path);
    else doc.select(added.path);
    gesture = false;
    refresh();
  };

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-add]')) {
    button.addEventListener('click', () => {
      const kind = button.dataset['add'] as ModuleSpec['kind'];
      // At the layout's own origin, not at the middle of the view. A ship is
      // drawn about its origin — the authored ones are, and the frame the
      // player types coordinates in is that one — so starting every module
      // wherever the camera happened to be left builds a ship quietly off
      // centre, and the first module of a new ship decides where the rest go.
      const spec: ModuleSpec = { ...DEFAULTS[kind], x: 0, y: 0 };
      // With an assembly selected, the module goes into it, at its origin.
      const into = doc.selectedAssemblyPath();
      if (into !== null) {
        addInto(into, spec);
        return;
      }
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
  shipFighter.addEventListener('change', () => {
    const next = { ...doc.blueprint };
    if (shipFighter.checked) next.fighter = true;
    else delete next.fighter;
    change(next);
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

  const open = (value: string): void => {
    const stock = value.startsWith(STOCK);
    const name = stock ? value.slice(STOCK.length) : value;
    const blueprint = stock ? library.loadStock(name) : read(name);
    if (blueprint === null) return;
    doc.replace(blueprint);
    demonstration.reset();
    easeFit = true;
    gesture = false;
    refresh();
  };

  shipList.addEventListener('change', () => open(shipList.value));
  const taken = (): string[] => library.list().map((entry) => entry.name);
  el<HTMLButtonElement>('newShip').addEventListener('click', () => {
    doc.replace(emptyBlueprint(unusedName('New ship', taken())));
    easeFit = true;
    gesture = false;
    refresh();
  });
  // The copy is left unsaved, as a new ship is: what is on the screen is the
  // player's to keep or abandon until they say otherwise. This is how a
  // shipped hull becomes the start of a ship of their own without the save
  // shadowing the hull they started from.
  el<HTMLButtonElement>('duplicateShip').addEventListener('click', () => {
    doc.replace({ ...doc.blueprint, name: unusedName(nextName(doc.blueprint.name), taken()) });
    gesture = false;
    refresh();
  });
  saveButton.addEventListener('click', () => {
    library.save(doc.blueprint);
    refresh();
  });
  // Deleting clears the editor rather than leaving the ship on the screen: a
  // layout that is still there, still named, and no longer anywhere is the one
  // state where what is drawn and what the library holds disagree.
  //
  // It goes on the undo stack, so the way back is the way back from any other
  // edit — undo brings the ship up again and Save puts it in the library. The
  // stack rather than an undelete of its own, because the ship is the thing
  // being restored and saving is the act that keeps it.
  deleteShipButton.addEventListener('click', () => {
    const name = doc.blueprint.name;
    if (!window.confirm(`Delete the saved copy of ${name}?`)) return;
    library.remove(name);
    doc.apply(emptyBlueprint(unusedName('New ship', taken())));
    gesture = false;
    easeFit = true;
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
      easeFit = true;
      gesture = false;
      refresh();
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
    | {
        kind: 'pan';
        x: number;
        y: number;
        /** Whether releasing without having panned clears the selection. */
        deselect: boolean;
      }
    | {
        kind: 'module';
        from: Blueprint;
        startX: number;
        startY: number;
        moved: boolean;
        /** The module pressed on, and whether releasing without a drag goes in a level. */
        hit: number;
        drill: boolean;
      }
    | {
        /** The knob on a selected assembly, dragged to turn it about its origin. */
        kind: 'turn';
        from: Blueprint;
        path: ModulePath;
        pose: InstancePose;
        moved: boolean;
      }
    | {
        /** The face two selected modules share, moved to size both. */
        kind: 'seam';
        from: Blueprint;
        pair: NonNullable<ReturnType<typeof seamPair>>;
        moved: boolean;
      }
    | {
        /**
         * A corner or edge is dragged to size the module, the knob to turn it,
         * the split to share its length between block and bell or barrel.
         */
        kind: 'size' | 'rotate' | 'split';
        from: Blueprint;
        /** The handle grabbed, which says which faces move. */
        handle: Handle;
        /**
         * The module as it was drawn when the handle was grabbed.
         *
         * Held rather than re-read, because it is the frame every position the
         * pointer reaches is measured in — and re-reading it mid-drag would
         * measure against a module the drag itself has just changed.
         */
        spec: ModuleSpec;
        moved: boolean;
      };
  let drag: Drag | null = null;

  /**
   * Size or turn the selected module to wherever the pointer is.
   *
   * Written through the same `updatePlacement` the panel's boxes use, so a
   * module sized by dragging and one sized by typing are the same edit — and a
   * shared part's size and facing change every copy, exactly as the panel says
   * they do. A resize also moves the module within its assembly so the
   * opposite face stays put, so every copy moves the same way — mirrored where
   * the copy is.
   * The facing has to be converted on the way in: what the pointer names is a
   * direction on screen, and a module inside a turned or mirrored assembly is
   * written in another frame.
   */
  const dragHandle = (event: PointerEvent): void => {
    if (drag === null || drag.kind === 'pan' || drag.kind === 'module') return;
    if (drag.kind === 'turn') {
      const world = worldAt(event);
      const { pose } = drag;
      // The bearing the assembly's +x should take on screen, then the angle
      // that gives it written in the frame the instance is placed in.
      const bearing = facingTo(
        { kind: 'structure', x: pose.x, y: pose.y, length: 0, width: 0 },
        world.x,
        world.y,
        event.altKey ? 0 : ANGLE_SNAP_DEGREES,
      );
      const origin: ModuleOrigin = { path: drag.path, ...pose.written, instanceFrame: null };
      const angle = toPlacementAngle(origin, bearing);
      const next = updatePlacement(drag.from, drag.path, (p) => {
        const turned = { ...p } as AssemblyInstance;
        if (angle === 0) delete turned.angle;
        else turned.angle = angle;
        return turned;
      });
      if (next === null) return;
      if (drag.moved) doc.amend(next);
      else doc.apply(next);
      drag = { ...drag, moved: true };
      refresh();
      return;
    }
    if (drag.kind === 'seam') {
      const { a, b, seam } = drag.pair;
      const world = worldAt(event);
      const moved = seamTo(a.spec, b.spec, seam, world.x, world.y, event.altKey ? 0 : snapMetres());
      const one = resizePlacement(drag.from, a.origin, ...sizes(moved.a), false);
      const both = one === null ? null : resizePlacement(one, b.origin, ...sizes(moved.b), false);
      if (both === null) return;
      if (drag.moved) doc.amend(both);
      else doc.apply(both);
      drag = { ...drag, moved: true };
      refresh();
      return;
    }
    const path = doc.selection;
    const origin = doc.selectedOrigin();
    if (path === null || origin === null) return;
    const world = worldAt(event);
    let next: Blueprint | null;
    if (drag.kind === 'split') {
      const nozzle = shareTo(drag.spec, world.x, world.y, event.altKey ? 0 : snapMetres());
      next = updatePlacement(drag.from, path, (p) => ({ ...p, nozzle }));
    } else if (drag.kind === 'size') {
      const step = event.altKey ? 0 : snapMetres();
      // Shift sizes about the middle, keeping it where it was.
      const { length, width, dx, dy } = resizedTo(drag.spec, drag.handle, world.x, world.y, step, event.shiftKey);
      // Neighbours move with the face unless Ctrl (⌘) asks for this module alone.
      const push = !(event.ctrlKey || event.metaKey);
      next = resizePlacement(drag.from, origin, length, width, dx, dy, push);
    } else {
      const angle = toPlacementAngle(
        origin,
        facingTo(drag.spec, world.x, world.y, event.altKey ? 0 : ANGLE_SNAP_DEGREES),
      );
      next = updatePlacement(drag.from, path, (p) => ({ ...p, angle }));
    }
    if (next === null) return;
    if (drag.moved) doc.amend(next);
    else doc.apply(next);
    drag = { ...drag, moved: true };
    refresh();
  };

  const sizes = (r: ReturnType<typeof resizedTo>): [number, number, number, number] => [
    r.length,
    r.width,
    r.dx,
    r.dy,
  ];

  canvas.addEventListener('pointerdown', (event) => {
    // A canvas is not focusable, so clicking it does not move focus off a
    // properties box on its own. Leaving focus there would keep that box out
    // of every refresh, and would swallow Delete, Escape and F, which are all
    // held back while something is being typed into.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    const world = worldAt(event);
    canvas.setPointerCapture(event.pointerId);
    // The selection's own handles are tested before the layout under them: a
    // corner handle sits on the module's corner, and often over the neighbour
    // it abuts, so whichever is on top would otherwise decide whether a
    // resize or a drag of something else began.
    const handles = currentHandles();
    const grabbed = event.button === 1 ? -1 : handleAt(handles, world.x, world.y, camera.scale);
    const pair = seamPair();
    if (grabbed >= 0 && pair !== null) {
      gesture = false;
      drag = { kind: 'seam', from: doc.blueprint, pair, moved: false };
      return;
    }
    const assembly = grabbed >= 0 ? selectedAssemblyPose() : null;
    if (assembly !== null) {
      gesture = false;
      drag = { kind: 'turn', from: doc.blueprint, path: assembly.path, pose: assembly.pose, moved: false };
      return;
    }
    const spec = doc.view.modules[doc.selectedLoose()[0] ?? -1];
    if (grabbed >= 0 && spec !== undefined) {
      gesture = false;
      drag = {
        kind: handles[grabbed]!.kind === 'rotate' ? 'rotate' : handles[grabbed]!.kind === 'split' ? 'split' : 'size',
        from: doc.blueprint,
        handle: handles[grabbed]!,
        spec,
        moved: false,
      };
      return;
    }
    const hit = moduleAt(doc.view.modules, world.x, world.y);
    // Shift over a module adds it to the selection; shift over empty space
    // still pans, as does the middle button and a plain drag on empty space.
    // The one gesture this costs is panning by shift-dragging *from* a module,
    // which the other two cover.
    if (hit >= 0 && event.shiftKey && event.button !== 1) {
      doc.togglePath(doc.resolveClick(hit));
      refresh();
      return;
    }
    // Panning leaves the selection alone; only a plain click on empty space
    // clears it, and that is decided on release.
    if (hit < 0 || event.button === 1 || event.shiftKey) {
      drag = {
        kind: 'pan',
        x: event.clientX,
        y: event.clientY,
        deselect: hit < 0 && event.button === 0 && !event.shiftKey,
      };
      return;
    }
    // Pressing on something the selection already covers leaves the selection
    // alone, so that an assembly can be dragged as an assembly. Going *in* a level is
    // what a click does, and a click is a press that did not become a drag —
    // otherwise selecting a wing and then dragging it would quietly drag one
    // part of it instead, which is the difference between the two operations.
    const drill = doc.covers(hit);
    if (!drill) doc.selectAt(hit, doc.resolveClick(hit));
    gesture = false;
    drag = {
      kind: 'module',
      from: doc.blueprint,
      startX: world.x,
      startY: world.y,
      moved: false,
      hit,
      drill,
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
      easeFit = false;
      render();
      return;
    }
    if (drag.kind !== 'module') {
      dragHandle(event);
      return;
    }
    const moving = drag;
    const handle = selectedPosition();
    if (handle === null) return;
    const world = worldAt(event);
    // The *displacement* snaps, not the position. A layout drawn on half-metre
    // offsets — which the authored ships are, since modules abut exactly —
    // would be dragged onto whole metres by an absolute grid and every abutting
    // face would part company. Snapping the movement keeps whatever offsets a
    // ship was designed with, and Alt escapes it entirely.
    const step = event.altKey ? 0 : snapMetres();
    const dx = snap(world.x - moving.startX, step);
    const dy = snap(world.y - moving.startY, step);
    if (dx === 0 && dy === 0 && !moving.moved) return;
    const next = movePlacement(moving.from, handle.origin, dx, dy);
    if (next === null) return;
    if (moving.moved) doc.amend(next);
    else doc.apply(next);
    drag = { ...moving, moved: true };
    refresh();
  });

  const endDrag = (): void => {
    // A press that never became a drag is a click, and a click on something
    // already selected goes in a level: assembly, then part of the assembly, then
    // nothing further.
    if (drag !== null && drag.kind === 'module' && drag.drill && !drag.moved) {
      doc.selectAt(drag.hit, doc.resolveClick(drag.hit));
      refresh();
    }
    if (drag !== null && drag.kind === 'pan' && drag.deselect) {
      doc.select(null);
      refresh();
    }
    drag = null;
    gesture = false;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      easeFit = false;
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
      document.activeElement instanceof HTMLTextAreaElement ||
      document.activeElement instanceof HTMLSelectElement;
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
    } else if (event.key.toLowerCase() === ARCS_KEY && !event.ctrlKey && !event.metaKey) {
      arcs = nextArcs(arcs);
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

  // The canvas, not the window: the header rewrapping resizes it too.
  new ResizeObserver(() => {
    resize();
    render();
  }).observe(canvas);

  // The ship as it stands, as a fleet of one, goes with the link.
  el<HTMLAnchorElement>('battleLink').addEventListener('click', (event) => {
    (event.currentTarget as HTMLAnchorElement).href = battleHref(shipFleet(doc.blueprint));
  });

  // Fixed text, although the position snap is not: the footer's height is part
  // of the canvas's, so a line that grows and shrinks resizes the view under
  // the ship. The live figure is drawn in the canvas corner instead.
  hint.textContent =
    'Click a module to select it, drag to move, drag a corner or edge to size it ' +
    '(pushing its neighbours; Ctrl alone; Shift about its middle) or the knob to turn it; ' +
    'select two touching modules to drag the face between them; ' +
    'Shift-click to pick several and Create assembly, or Add them to the last assembly picked; ' +
    'with an assembly selected, a new module goes into it. Positions snap to a tenth of the grid on ' +
    `screen and facings to ${ANGLE_SNAP_DEGREES}° — hold Alt to escape. ` +
    'Drag empty space to pan, scroll to zoom, F to fit, A to cycle the arcs drawn, Delete to remove, Ctrl+Z to undo.';

  resize();
  refresh();
}

/** A name not already in the library, so a new ship does not shadow a saved one. */
function isModuleSpec(placement: Placement): boolean {
  return !('use' in placement);
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}
