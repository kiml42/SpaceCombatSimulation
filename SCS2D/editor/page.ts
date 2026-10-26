import { keyHelp } from "../host/keyHelp.js";
import {
    DEFAULT_BURST_SPEED,
    barrelCalibres,
    readsBarrelCalibres,
    moduleProblem,
    moduleStats,
    DEFAULT_DOCTRINE,
    defaultTargeting,
    resolveTargeting,
    DEFAULT_FRAGMENTS,
    DEFAULT_FUSE,
    firesShells,
    DEFAULT_NOZZLE_WIDTHS,
    degreesToRadians,
    isHullMount,
    isWeaponMount,
    readsThick,
    readsFuse,
    readsSealing,
    readsDrainPriority,
    readsFill,
    readsComputing,
    CORE_COMPUTING_SHARE,
    inReachDesign,
    readsDocked,
    padHolds,
    readsCraft,
    readsCraftAngle,
    slipwayHolds,
    blueprintProblem,
    compileDraft,
    canShape,
    canThicken,
    isShaped,
    shapeModule,
    wedge,
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
    withFleetFighters,
    type AssemblyInstance,
    type Blueprint,
    type ModuleKind,
    type ModulePath,
    type ModuleSpec,
    type ShipDesign,
    type Placement,
    type ShipModuleKind,
} from "../sim/index.js";
import { ARC_LABELS } from "../render/canvas2d.js";
import { EditorDocument } from "./document.js";
import {
    addModule,
    addModuleTo,
    arrivingModule,
    addToAssembly,
    addToAssemblyProblem,
    dissolveInstance,
    duplicateInstance,
    duplicatePlacement,
    countInstances,
    createAssembly,
    createAssemblyProblem,
    instanceOf,
    reshapePlacement,
    renameAssembly,
    renameProblem,
    setMirror,
    setRepetition,
    extentAlong,
    toPlacementAngle,
    removeCopy,
    removeInstance,
    snap,
    takeOutCount,
    takeOutOfAssembly,
    updatePlacement,
    dockFighter,
    renameShip,
} from "./edit.js";
import { emptyBlueprint, Library, nextName, toFileText, unusedName, type LibraryEntry } from "./library.js";
import { battleHref, designHref, fleetHref, handedDesign, shipFleet, type DesignInFleet } from "./handoff.js";
import { replaceDesign, replacedName } from "./fleetEdit.js";
import { budgetRows } from "./budget.js";
import { billOfFleet, canFight, fleetFault, overLimit } from "../scenarios/skirmish.js";
import { ANGLE_SNAP_DEGREES, selectedPosition, shipCanvas } from "./shipCanvas.js";
import {
    kindName,
    mountDefault,
    mountSummary,
    shipDefault,
    shipSummary,
    withMountField,
    withShipField,
    MOUNT_SECTIONS,
    sectionEntries,
    SHIP_SECTIONS,
    type DoctrineContext,
    type DoctrineEntry,
    type DoctrineSection,
    type DoctrineValues,
} from "./doctrine.js";
import { attackBearings, doctrineBand } from "./preview.js";
import { buildTime, designStats, assemblyMass, moduleReadout, roundsAboard, megawatts, megajoules } from "./stats.js";

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

const { abs, max, PI } = math;

/** The ways a slipway can lay out what it builds (`ModuleSpec.craftAngle`), offered by name. */
const CRAFT_ANGLES: readonly { degrees: number; label: string }[] = [
    { degrees: 0, label: "bow first" },
    { degrees: 90, label: "side first, bow turned +90°" },
    { degrees: -90, label: "side first, bow turned −90°" },
    { degrees: 180, label: "stern first" },
];

/** What a freshly added module of each kind starts as, metres. */
const DEFAULTS: Record<ShipModuleKind, Omit<ModuleSpec, "x" | "y">> = {
    structure: { kind: "structure", length: 8, width: 5 },
    tank: { kind: "tank", length: 6, width: 4 },
    hold: { kind: "hold", length: 4, width: 3 },
    battery: { kind: "battery", length: 4, width: 3 },
    generator: { kind: "generator", length: 4, width: 4 },
    // Berths for four robots.
    robotBay: { kind: "robotBay", length: 4, width: 4 },
    core: { kind: "core", length: 3, width: 3 },
    // Facing aft along its bell, so it pushes the ship forward.
    engine: { kind: "engine", angle: math.PI, length: 1.5, width: 3 },
    turret: { kind: "turret", angle: 0, length: 4, width: 3, barrels: 1 },
    beamTurret: { kind: "beamTurret", angle: 0, length: 4, width: 3, barrels: 1 },
    hullGun: { kind: "hullGun", angle: 0, length: 4, width: 4, barrels: 1 },
    hullBeam: { kind: "hullBeam", angle: 0, length: 4, width: 4, barrels: 1 },
    claw: { kind: "claw", angle: 0, length: 2, width: 2 },
    // Room for a fighter to sit on, wholly inside it.
    pad: { kind: "pad", length: 12, width: 10 },
    // Facing out of the hull it is bolted to, its face the side that mates.
    port: { kind: "port", angle: 0, length: 1, width: 2 },
    // Facing out of the hull, the ship it builds coming out of its face.
    slipway: { kind: "slipway", angle: 0, length: 4, width: 12 },
};

function el<T extends HTMLElement>(id: string): T {
    const found = document.getElementById(id);
    if (found === null) throw new Error(`missing element #${id}`);
    return found as T;
}

type ModuleNumberField =
    | "angle"
    | "reinforcement"
    | "barrels"
    | "nozzle"
    | "barrelCalibres"
    | "traverse"
    | "fuse"
    | "fragments"
    | "burstSpeed"
    | "sealing"
    | "drainPriority"
    | "fill"
    | "computing"
    | "keep";

/** A module's own value for a field, with the default the parser would have applied. */
function moduleField(spec: ModuleSpec, key: ModuleNumberField): number {
    if (key === "angle") return radiansToDegrees(spec.angle ?? 0);
    if (key === "reinforcement") return spec.reinforcement ?? 1;
    if (key === "nozzle") return spec.nozzle ?? DEFAULT_NOZZLE_WIDTHS;
    if (key === "barrelCalibres") return barrelCalibres(spec);
    // What the mount would do if the layout said nothing, so the box shows the
    // arc it actually has rather than a blank.
    if (key === "traverse") return radiansToDegrees(mountTraverse(spec));
    if (key === "fuse") return spec.fuse ?? DEFAULT_FUSE;
    if (key === "fragments") return spec.fragments ?? DEFAULT_FRAGMENTS;
    if (key === "burstSpeed") return spec.burstSpeed ?? DEFAULT_BURST_SPEED;
    // Millimetres on the panel, metres in the layout.
    if (key === "sealing") return (spec.sealing ?? 0) * 1000;
    if (key === "drainPriority") return spec.drainPriority ?? 0;
    // Per cent on the panel, a share in the layout.
    if (key === "fill") return (spec.fill ?? 1) * 100;
    if (key === "computing") return (spec.computing ?? CORE_COMPUTING_SHARE) * 100;
    if (key === "keep") return spec.keep ?? 0;
    return spec.barrels ?? 1;
}

/** How far each core reaches, and how many modules none of them does. */
function controlReadout(design: ShipDesign): string {
    const reaches = design.cores.map((core) => `${design.modules[core]!.stats.controlRadius.toFixed(1)} m`);
    const out = design.coveredBy?.filter((cores) => cores !== null && cores.length === 0).length ?? 0;
    const cores = reaches.length === 1 ? `its core reaches ${reaches[0]}` : `its cores reach ${reaches.join(", ")}`;
    return out === 0 ? cores : `${cores}; ${out} module${out === 1 ? "" : "s"} out of reach will not work`;
}

/** A gun's barrel in metres, and how much of it is braced. */
function barrelReadout(spec: ModuleSpec): string {
    if (!readsBarrelCalibres(spec.kind) || moduleProblem(spec) !== null) return "";
    const gun = moduleStats(spec).gun;
    if (gun === null) return "";
    const metres = `= ${gun.barrelLength.toFixed(2)} m`;
    return gun.braceLength > 0 ? `${metres}, ${gun.braceLength.toFixed(2)} m braced` : metres;
}

export function startEditor(): void {
    const canvas = el<HTMLCanvasElement>("view");

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
            window.alert(`Could not read the saved ${name}.\n\n${error instanceof Error ? error.message : error}`);
            return null;
        }
    };
    // Opened from the fleet editor, the ship is one of a fleet's designs, to be taken back to it.
    let inFleet: DesignInFleet | null = null;
    try {
        inFleet = handedDesign(window.location.hash);
    } catch (error) {
        window.alert(`Could not read the fleet's design handed over.\n\n${error instanceof Error ? error.message : error}`);
    }
    const doc = new EditorDocument(
        // As it flies in its fleet, carrying the fleet's fighters for its pads.
        (inFleet === null ? null : withFleetFighters(inFleet.fleet.designs[inFleet.design]!, inFleet.fleet.designs)) ??
            read("Corvette") ??
            emptyBlueprint("New ship"),
    );
    const shipView = shipCanvas(canvas, doc, {
        changed: () => refreshPanels(),
        gestureEnded: () => {
            gesture = false;
        },
        deleteSelected: () => deleteSelected(),
        zoomed: () => matchBoxesToGrid(),
        viewChanged: () => {
            arcsButton.textContent = ARC_LABELS[shipView.arcs];
        },
    });
    const camera = shipView.camera;
    const snapMetres = (): number => shipView.snapMetres();
    const refitButton = el<HTMLButtonElement>("showRefit");
    const arcsButton = el<HTMLButtonElement>("cycleArcs");

    // ---- the controls -------------------------------------------------------

    const shipList = el<HTMLSelectElement>("ship");
    const shipName = el<HTMLInputElement>("shipName");
    const shipFighter = el<HTMLInputElement>("shipFighter");
    const shipFighterLabel = el<HTMLElement>("shipFighterLabel");
    const shipNotes = el<HTMLTextAreaElement>("shipNotes");
    const properties = el<HTMLElement>("properties");
    const linked = el<HTMLElement>("linked");
    const statsPanel = el<HTMLElement>("stats");
    const problemsPanel = el<HTMLElement>("problems");
    const hint = el<HTMLElement>("hint");
    const undoButton = el<HTMLButtonElement>("undo");
    const redoButton = el<HTMLButtonElement>("redo");
    const deleteShipButton = el<HTMLButtonElement>("deleteShip");
    const moduleStats = el<HTMLElement>("moduleStats");
    const duplicateButton = el<HTMLButtonElement>("propDuplicate");
    const takeOutButton = el<HTMLButtonElement>("propTakeOut");
    const assemblyTakeOut = el<HTMLButtonElement>("assemblyTakeOut");
    const selectAssemblyButton = el<HTMLButtonElement>("propSelectAssembly");
    const assemblySelection = el<HTMLElement>("assemblySelection");
    const assemblyCount = el<HTMLElement>("assemblyCount");
    const assemblyButton = el<HTMLButtonElement>("propAssembly");
    const addToAssemblyButton = el<HTMLButtonElement>("propAddToAssembly");
    const assemblyPanel = el<HTMLElement>("assemblyPanel");
    const assemblyOf = el<HTMLElement>("assemblyOf");
    const assemblyName = el<HTMLInputElement>("assemblyName");
    const assemblyStats = el<HTMLElement>("assemblyStats");
    const assemblyX = el<HTMLInputElement>("assemblyX");
    const assemblyY = el<HTMLInputElement>("assemblyY");
    const assemblyAngle = el<HTMLInputElement>("assemblyAngle");
    const assemblyMirror = el<HTMLInputElement>("assemblyMirror");
    const assemblyRepeat = el<HTMLInputElement>("assemblyRepeat");
    const assemblyStepRow = el<HTMLElement>("assemblyStepRow");
    const assemblyStepAngleRow = el<HTMLElement>("assemblyStepAngleRow");
    const assemblyStepX = el<HTMLInputElement>("assemblyStepX");
    const assemblyStepY = el<HTMLInputElement>("assemblyStepY");
    const assemblyStepAngle = el<HTMLInputElement>("assemblyStepAngle");
    const assemblyDuplicate = el<HTMLButtonElement>("assemblyDuplicate");
    const assemblyDissolve = el<HTMLButtonElement>("assemblyDissolve");
    const assemblyDelete = el<HTMLButtonElement>("assemblyDelete");
    const saveButton = el<HTMLButtonElement>("saveShip");
    const exportButton = el<HTMLButtonElement>("exportShip");

    const weaponInput = el<HTMLInputElement>("propWeapon");
    const mainInput = el<HTMLInputElement>("propMain");
    const shapeInput = el<HTMLInputElement>("propShape");
    const thickInput = el<HTMLInputElement>("propThick");
    const thickTitle = thickInput.title;
    const kindSelect = el<HTMLSelectElement>("propKind");
    const dockedSelect = el<HTMLSelectElement>("propDocked");
    const craftAngleSelect = el<HTMLSelectElement>("propCraftAngle");
    const padDockedInput = el<HTMLInputElement>("propPadDocked");
    const buildAnchoredInput = el<HTMLInputElement>("propBuildAnchored");
    const addHeading = el<HTMLElement>("addHeading");
    kindSelect.innerHTML = MODULE_KINDS.map((kind) => `<option value="${kind}">${kindName(kind)}</option>`).join("");

    const mountDoctrine = el<HTMLDetailsElement>("mountDoctrine");
    const mountDoctrineSummary = el<HTMLElement>("mountDoctrineSummary");
    const mountDoctrineReset = el<HTMLButtonElement>("mountDoctrineReset");
    const shipDoctrine = el<HTMLDetailsElement>("shipDoctrine");
    const shipDoctrineSummary = el<HTMLElement>("shipDoctrineSummary");
    const shipDoctrineReset = el<HTMLButtonElement>("shipDoctrineReset");

    const propInputs: Record<string, HTMLInputElement | HTMLTextAreaElement> = {
        x: el<HTMLInputElement>("propX"),
        y: el<HTMLInputElement>("propY"),
        angle: el<HTMLInputElement>("propAngle"),
        length: el<HTMLInputElement>("propLength"),
        width: el<HTMLInputElement>("propWidth"),
        reinforcement: el<HTMLInputElement>("propReinforcement"),
        barrels: el<HTMLInputElement>("propBarrels"),
        nozzle: el<HTMLInputElement>("propNozzle"),
        barrelCalibres: el<HTMLInputElement>("propBarrelCalibres"),
        traverse: el<HTMLInputElement>("propTraverse"),
        fuse: el<HTMLInputElement>("propFuse"),
        fragments: el<HTMLInputElement>("propFragments"),
        burstSpeed: el<HTMLInputElement>("propBurstSpeed"),
        sealing: el<HTMLInputElement>("propSealing"),
        drainPriority: el<HTMLInputElement>("propDrainPriority"),
        fill: el<HTMLInputElement>("propFill"),
        computing: el<HTMLInputElement>("propComputing"),
        keep: el<HTMLInputElement>("propKeep"),
        notes: el<HTMLTextAreaElement>("propNotes"),
    };

    // ---- redraw and repaint -------------------------------------------------

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
        for (const key of ["x", "y", "length", "width"] as const) {
            const input = propInputs[key];
            if (!(input instanceof HTMLInputElement) || input.step === step) continue;
            input.step = step;
            if (key === "length" || key === "width") input.min = step;
        }
    };

    const numbers = (value: number, places = 1, significant = 2): string => {
        let decimals = places;
        if (value !== 0 && Number.isFinite(value)) {
            const magnitude = Math.floor(Math.log10(Math.abs(value)));
            decimals = Math.max(places, Math.min(20, significant - 1 - magnitude));
        }
        return value.toLocaleString("en-GB", { maximumFractionDigits: decimals });
    };

    const renderStats = (): void => {
        const design = doc.view.design;
        const envelope = shipView.envelope();
        if (design === null || envelope === null) {
            statsPanel.innerHTML = `<p class="none">${doc.view.underivable ?? "Nothing to measure yet."}</p>`;
            return;
        }
        const s = designStats(inReachDesign(design), envelope);
        const rows = [
            ["Mass", `${numbers(s.mass / 1000, 2)} t, ${numbers(s.fuel / 1000, 2)} t of it fuel and ${numbers(s.metal / 1000, 2)} t metal`],
            [
                "Cost",
                `${numbers(s.bill.metal / 1000, 2)} t of metal, ${numbers(s.bill.fuel / 1000, 2)} t of fuel and ${buildTime(s.bill.build)} for one robot to build` +
                    ((design.aboard?.length ?? 0) > 0 ? ", with the fighters it sets out with" : ""),
            ],
            [
                "Endurance",
                Number.isFinite(s.endurance) ? `${numbers(s.endurance, 0)} s flat out, ${numbers(s.deltaV, 0)} m/s of Δv` : "no engines",
            ],
            [
                "Power",
                s.generation > 0 || s.storage > 0
                    ? `${megawatts(s.generation)} generated, ${megajoules(s.storageAtStart)} stored` +
                      (s.storageAtStart < s.storage ? ` of ${megajoules(s.storage)}` : "") +
                      (s.discharge > 0 ? `, given out at up to ${megawatts(s.discharge)}` : "") +
                      (s.beamDraw > 0 ? `; its beams draw ${megawatts(s.beamDraw)} firing flat out` : "")
                    : "no generators or batteries",
            ],
            [
                "Ammunition",
                s.mainRounds === null
                    ? "no guns that fire rounds"
                    : `${numbers(s.mainRounds.rounds, 0)} rounds of its ${numbers(s.mainRounds.roundMass, 1)} kg main gun`,
            ],
            ["Inertia", `${numbers(s.inertia / 1000, 0)} t·m²`],
            ["Modules", `${s.moduleCount} (${s.engineCount} engines)`],
            ["Control", controlReadout(design)],
            ["Radius", `${numbers(s.radius)} m`],
            ["Accel fore / aft", `${numbers(s.accelFore, 2)} / ${numbers(s.accelAft, 2)} m/s²`],
            ["Accel port / stbd", `${numbers(s.accelPort, 2)} / ${numbers(s.accelStarboard, 2)} m/s²`],
            ["Turn left / right", `${numbers(radiansToDegrees(s.turnLeft), 2)} / ${numbers(radiansToDegrees(s.turnRight), 2)} °/s²`],
            ["Authority", s.fullAuthority ? "full" : "incomplete — cannot hold a heading"],
            // What a layout pays for its thrust not being balanced about its centre
            // of mass: the acceleration it gives up to avoid spinning. The envelope
            // shows which directions it is paid in.
            ["Heading cost", s.headingCost < 0.005 ? "none — thrust is balanced" : `up to ${numbers(s.headingCost * 100)}%`],
        ];
        // No turret rows: a gun's figures belong to the gun, and selecting it
        // shows them. Repeating them here made the ship's own totals hard to find
        // on a ship with several mounts, and said nothing the module panel does
        // not say better.
        rows.push(["Turrets", `${s.turrets.length}`]);
        // Against the enemy its own doctrine wants, as the band drawn round it is.
        const band = doctrineBand(design);
        rows.push(["Closes to", `${numbers(band.min, 0)}–${numbers(band.max, 0)} m, centre to centre`]);
        // Positive is to port, as every bearing in the body frame is.
        const fights = attackBearings(design)
            .map((r) => `${numbers(radiansToDegrees(r.bearing), 0)}° (${r.guns} of ${r.total} main guns)`)
            .join(", ");
        rows.push(["Fights with target at", fights]);
        statsPanel.innerHTML = `<table>${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("")}</table>`;
    };

    const renderProblems = (): void => {
        const problems = doc.view.problems;
        problemsPanel.innerHTML =
            (problems.length === 0
                ? '<p class="ok">No problems — this layout would fly.</p>'
                : `<p class="warn">${problems.length} problem${problems.length > 1 ? "s" : ""}</p><ul>` +
                  problems.map((p) => `<li>${escapeHtml(p)}</li>`).join("") +
                  "</ul>") +
            reachNote(doc.view.design) +
            unreadNote(doc.view.warnings);
        // A ship already built to the design as it was opened would be refitted to this one.
        const refit = doc.refit;
        el<HTMLElement>("refitSection").hidden = refit === null;
        refitButton.disabled = refit === null;
        if (refit !== null) {
            el<HTMLElement>("refit").innerHTML =
                `<p>A ship built as it was opened, refitted to this: ${refit.built.length} built (green), ` +
                `${refit.takenDown.length} taken down (dashed).</p>` +
                (refit.refused !== null
                    ? `<p class="warn">It could not be refitted: ${escapeHtml(refit.refused)}.</p>`
                    : refit.bay
                      ? ""
                      : '<p class="warn">It has no robot bay, so a refit to it could never be finished.</p>');
        }
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
            ...(modules > 0 || nested === 0 ? [counted(modules, "module", "modules")] : []),
            ...(nested > 0 ? [counted(nested, "assembly", "assemblies")] : []),
        ];
        assemblyOf.textContent = parts.join(" and ") + (drawn > members.length ? `, and this copy draws ${drawn}` : "");
        if (document.activeElement !== assemblyName) assemblyName.value = instance.use;
        offerTakeOut(assemblyTakeOut, path, "assembly");
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
            assemblyStats.innerHTML = "";
            return;
        }
        const mass = assemblyMass(doc.view.modules, own.modules);
        const rows = [["Mass", `${numbers(mass / 1000, 2)} t`]];
        if (outlines.length > 1) {
            const all = outlines.flatMap((assembly) => assembly.modules);
            rows.push([`All ${outlines.length} copies`, `${numbers(assemblyMass(doc.view.modules, all) / 1000, 2)} t`]);
        }
        assemblyStats.innerHTML = `<table>${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("")}</table>`;
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
                ? "Pick an assembly to add the rest of the selection to"
                : addToAssemblyProblem(doc.blueprint, adding.assembly, adding.members);
        addToAssemblyButton.disabled = adding === null || addWhy !== null;
        addToAssemblyButton.textContent = name === null ? "Add to assembly" : `Add to ${name}`;
        addToAssemblyButton.title = addWhy ?? `Move the rest of the selection into ${name}`;

        const lines = [why === null ? `${picked} picked. Create assembly makes them one part, built around the first one picked.` : why];
        if (adding !== null && addWhy === null && name !== null) {
            // Said out loud because it is the bargain rather than a surprise: what
            // goes in joins every copy of the assembly, so the ship gains it per copy.
            const spread = countInstances(doc.blueprint, name) > 1 ? " It is placed more than once, and every copy gains them." : "";
            lines.push(`Add to ${name} moves the other ${adding.members.length} into it.${spread}`);
        }
        assemblyCount.textContent = lines.join(" ");
    };

    const renderProperties = (): void => {
        const into = doc.selectedAssemblyPath();
        const target = into === null ? null : placementAt(doc.blueprint, into);
        addHeading.textContent =
            target !== null && !isModuleSpec(target) ? `Add a module to ${(target as AssemblyInstance).use}` : "Add a module";
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
        const handle = selectedPosition(doc);
        const positioned = handle === null ? null : placementAt(doc.blueprint, handle.origin.path);
        // Whether the panel is still describing the module it was describing last
        // time. Compared by placement rather than by identity, because a path
        // object is rebuilt on every edit even when the selection has not moved.
        const path = doc.selection;
        const sameModule = shownSelection !== null && path !== null && samePlacement(shownSelection, path);
        shownSelection = path;
        kindSelect.value = spec.kind;
        for (const [key, input] of Object.entries(propInputs)) {
            // Never overwrite the box being typed into: a refresh triggered by the
            // keystroke would otherwise reformat the number under the cursor. That
            // holds only while the panel is describing the *same* module — moving to
            // another one has to rewrite every box, focused or not, or the panel
            // goes on showing the values of the module that was left behind.
            if (sameModule && document.activeElement === input) continue;
            if (key === "notes") input.value = spec.notes ?? "";
            else if (key === "x" || key === "y") {
                // The position shown is the one that puts *this copy* here, which for a
                // shared part is its instance's rather than the module's own — the
                // module sits at its assembly's origin, and showing that would report
                // every copy as being at (0, 0).
                const at = positioned;
                input.value = String(at === null ? 0 : key === "x" ? at.x : at.y);
            } else if (key === "length" || key === "width") input.value = String(spec[key]);
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
        const nozzles = spec.kind === "engine";
        const hullMount = isHullMount(spec.kind);
        el<HTMLElement>("barrelsRow").hidden = !nozzles && !hullMount && spec.kind !== "turret" && spec.kind !== "beamTurret";
        el<HTMLElement>("barrelsLabel").textContent = nozzles ? "nozzles" : spec.kind === "beamTurret" ? "emitters" : "barrels";
        el<HTMLElement>("traverseRow").hidden = !isWeaponMount(spec.kind);
        el<HTMLElement>("shellRow").hidden = !readsFuse(spec.kind);
        // Solid shot has no burst to time or to size.
        const shells = firesShells(spec);
        el<HTMLInputElement>("propFuse").disabled = !shells;
        el<HTMLInputElement>("propBurstSpeed").disabled = !shells;
        el<HTMLElement>("nozzleRow").hidden = !nozzles;
        el<HTMLElement>("barrelCalibresRow").hidden = !readsBarrelCalibres(spec.kind);
        el<HTMLElement>("barrelMetres").textContent = barrelReadout(spec);
        // Only an engine has a plume to point.
        el<HTMLElement>("weaponRow").hidden = spec.kind !== "engine";
        weaponInput.checked = spec.weapon === true;
        // An engine is only a weapon once it is marked as one.
        el<HTMLElement>("mainRow").hidden = !(isWeaponMount(spec.kind) || (spec.kind === "engine" && spec.weapon === true));
        mainInput.checked = spec.main !== false;
        el<HTMLElement>("shapeRow").hidden = !canShape(spec.kind);
        shapeInput.checked = isShaped(spec);
        el<HTMLElement>("thickRow").hidden = !readsThick(spec.kind);
        el<HTMLElement>("sealingRow").hidden = !readsSealing(spec.kind);
        el<HTMLElement>("drainPriorityRow").hidden = !readsDrainPriority(spec.kind);
        el<HTMLElement>("fillRow").hidden = !readsFill(spec.kind);
        el<HTMLElement>("computingRow").hidden = !readsComputing(spec.kind);
        el<HTMLElement>("dockedRow").hidden = !readsCraft(spec.kind);
        el<HTMLElement>("propDockedLabel").textContent = spec.kind === "pad" ? "fighter" : "builds";
        if (readsCraft(spec.kind)) renderDocked(spec);
        // Whether it sets out with one, and how many it keeps, mean nothing until it names one.
        el<HTMLElement>("padDockedRow").hidden = !readsDocked(spec.kind) || spec.craft === undefined;
        el<HTMLElement>("keepRow").hidden = !readsCraft(spec.kind) || spec.craft === undefined;
        el<HTMLElement>("craftAngleRow").hidden = !readsCraftAngle(spec.kind) || spec.craft === undefined;
        if (readsCraftAngle(spec.kind)) renderCraftAngle(spec);
        padDockedInput.checked = spec.docked === true;
        el<HTMLElement>("buildAnchoredRow").hidden = !readsCraft(spec.kind) || spec.craft === undefined;
        buildAnchoredInput.checked = spec.buildAnchored === true;
        // One no more than a deck across is as deep as it is wide either way.
        thickInput.disabled = !canThicken(spec) || doc.blueprint.fighter === true;
        thickInput.checked = isThick(spec);
        thickInput.title = thickInput.disabled
            ? doc.blueprint.fighter === true && canThicken(spec)
                ? "A fighter has nothing thick."
                : spec.kind === "engine"
                  ? "Too narrow to be thick: each nozzle is no more than a deck wide, so already as deep as it is wide."
                  : "Too narrow to be thick: no more than a deck across, so already as deep as it is wide."
            : thickTitle;

        const origin = doc.selectedOrigin();
        offerTakeOut(takeOutButton, origin === null ? null : origin.path, "module");

        const within = origin === null ? null : instanceOf(origin);
        selectAssemblyButton.disabled = within === null;
        selectAssemblyButton.title =
            within === null
                ? "This module is not in an assembly"
                : "Edit where the assembly sits, how far it is turned, and whether it is mirrored";

        linked.hidden = copies < 2;
        linked.textContent =
            copies < 2 ? "" : `Shared: drawn ${copies} times. Size, facing and notes change every copy; ` + `position moves this one.`;

        renderDoctrine(spec, sameModule);
        renderModuleStats(spec, doc.selectedModules()[0] ?? -1);
    };

    /**
     * The doctrine boxes, laid out by what each decision is about, from the
     * section lists rather than written out in the page.
     *
     * Every box carries a line for what its number comes to for this ship, and
     * is hidden while a setting above it has made it mean nothing. The half a
     * box belongs to is part of its key, since the two halves are separate
     * objects with no field names in common to rely on.
     */
    const doctrineInputs = new Map<string, HTMLInputElement>();
    const doctrineRows = new Map<string, { field: HTMLElement; absolute: HTMLElement; entry: DoctrineEntry }>();

    const buildDoctrine = (into: HTMLElement, sections: readonly DoctrineSection[]): void => {
        for (const section of sections) {
            const heading = document.createElement("h3");
            heading.textContent = section.title;
            into.append(heading);
            for (const group of section.groups) {
                // A section of one group says it once.
                if (group.title !== section.title) {
                    const sub = document.createElement("h4");
                    sub.textContent = group.title;
                    into.append(sub);
                }
                for (const row of group.entries) {
                    const key = `${row.half}.${row.field}`;
                    const field = document.createElement("div");
                    field.className = "field";
                    const label = document.createElement("label");
                    const id = `doctrine-${row.half}-${row.field}`;
                    label.htmlFor = id;
                    label.textContent = row.label;
                    const input = document.createElement("input");
                    input.id = id;
                    input.type = "number";
                    input.step = String(row.step);
                    input.title = row.hint;
                    label.title = row.hint;
                    const absolute = document.createElement("span");
                    absolute.className = "absolute";
                    field.append(label, input, absolute);
                    into.append(field);
                    doctrineInputs.set(key, input);
                    doctrineRows.set(key, { field, absolute, entry: row });
                }
            }
        }
    };

    buildDoctrine(el<HTMLElement>("mountDoctrineFields"), MOUNT_SECTIONS);
    buildDoctrine(el<HTMLElement>("shipDoctrineFields"), SHIP_SECTIONS);

    /** Hide what a higher setting has made moot, and say what the rest comes to. */
    const showDoctrineRows = (entries: readonly DoctrineEntry[], values: DoctrineValues, ship: DoctrineContext | null): void => {
        for (const row of entries) {
            const shown = doctrineRows.get(`${row.half}.${row.field}`)!;
            shown.field.hidden = row.shown !== undefined && !row.shown(values);
            shown.absolute.textContent = ship === null ? "" : (row.absolute?.(values, ship) ?? "");
        }
    };

    /** What the panel says relative numbers in terms of: the ship being edited. */
    const doctrineContext = (fireRange: number | null = null): DoctrineContext | null => {
        const design = doc.view.design;
        const envelope = shipView.envelope();
        if (design === null || envelope === null) return null;
        const stats = designStats(inReachDesign(design), envelope);
        return {
            mass: design.mass,
            radius: design.radius,
            reach: design.reach,
            accelFore: stats.accelFore,
            accelAft: stats.accelAft,
            brakeHolding: stats.brakeHolding,
            brakeTurned: stats.brakeTurned,
            guns: design.turrets.filter((turret) => turret.main).length,
            fireRange,
        };
    };

    /**
     * Show a doctrine box: the stated value, or nothing over a placeholder of
     * what would happen anyway.
     *
     * Empty meaning "the default" rather than zero is the whole of what makes
     * the panel optional, so the placeholder is not decoration — it is the box
     * saying what it will do if left alone.
     */
    const showDoctrineValue = (input: HTMLInputElement, held: number | undefined, fallback: number, sameThing: boolean): void => {
        input.placeholder = String(fallback);
        if (sameThing && document.activeElement === input) return;
        input.value = held === undefined || held === fallback ? "" : String(held);
        input.classList.toggle("stated", input.value !== "");
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
        const core = spec.kind === "core";
        mountDoctrine.hidden = !weapon;
        shipDoctrine.hidden = !core;
        if (weapon) {
            const held = (spec.targeting ?? {}) as Record<string, number | undefined>;
            mountDoctrineSummary.textContent = mountSummary(spec.kind, spec.targeting);
            mountDoctrineReset.disabled = spec.targeting === undefined;
            mountDoctrineReset.title = `Take this ${kindName(spec.kind)} back to what its archetype does`;
            const entries = sectionEntries(MOUNT_SECTIONS);
            for (const row of entries) {
                const input = doctrineInputs.get(`mount.${row.field}`)!;
                showDoctrineValue(input, held[row.field], mountDefault(spec.kind, row.field), sameThing);
            }
            const index = doc.selectedModules()[0] ?? -1;
            const fireRange = moduleReadout(spec, doc.view.modules, index, doc.view.design?.radius ?? 0).gun?.triggerRange ?? null;
            showDoctrineRows(
                entries,
                {
                    targeting: resolveTargeting(spec.targeting, defaultTargeting(spec.kind)),
                    approach: (doc.blueprint.doctrine ?? DEFAULT_DOCTRINE).approach,
                },
                doctrineContext(fireRange),
            );
        }
        if (core) {
            const doctrine = doc.blueprint.doctrine;
            shipDoctrineSummary.textContent = shipSummary(doctrine);
            shipDoctrineReset.disabled = doctrine === undefined;
            const entries = sectionEntries(SHIP_SECTIONS);
            for (const row of entries) {
                const half = row.half as "targeting" | "approach";
                const held = doctrine?.[half] as unknown as Record<string, number> | undefined;
                const input = doctrineInputs.get(`${half}.${row.field}`)!;
                showDoctrineValue(input, held?.[row.field], shipDefault(half, row.field), sameThing);
            }
            showDoctrineRows(entries, doctrine ?? DEFAULT_DOCTRINE, doctrineContext());
        }
    };

    const renderModuleStats = (spec: ModuleSpec, index: number): void => {
        // Given the whole layout, so a turret's arc can be worked out from what is
        // around it — the one figure on this panel that is not a property of the
        // module alone.
        const readout = moduleReadout(spec, doc.view.modules, index, doc.view.design?.radius ?? 0);
        const design = doc.view.design;
        const rows = readout.rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("");
        const gun =
            readout.gun === null
                ? ""
                : `<tr><th>Gun</th><td>${numbers(readout.gun.calibre * 1000, 0)} mm` +
                  `${readout.gun.barrels > 1 ? ` ×${readout.gun.barrels}` : ""}, ` +
                  `${numbers(readout.gun.roundsPerMinute)} rpm, ${numbers(readout.gun.muzzleSpeed, 0)} m/s, ` +
                  `${numbers(readout.gun.roundMass, 1)} kg shell</td></tr>` +
                  (design === null || !(readout.gun.roundMass > 0) || design.modules[index]?.spec.kind !== spec.kind
                      ? ""
                      : `<tr><th>Rounds</th><td>${numbers(roundsAboard(design, index), 0)} from the metal its piece of hull sets out with, shared with every gun there</td></tr>`) +
                  `<tr><th>Arc</th><td>${numbers(readout.gun.arcRight, 0)}°R–` +
                  `${numbers(readout.gun.arcLeft, 0)}°L, trains at ` +
                  `${numbers(readout.gun.traverseRate)} °/s</td></tr>` +
                  (readout.gun.triggerRange == null
                      ? ""
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
    const STOCK = "stock:";
    const optionValue = (entry: LibraryEntry): string => (entry.stock && entry.saved ? STOCK + entry.name : entry.name);

    const renderLibrary = (): void => {
        const entries = library.list();
        const selected = doc.blueprint.name;
        // Opening a name gives the saved copy where there is one, so a shadowed
        // shipped ship is listed but never the entry shown as selected.
        shipList.innerHTML = entries
            .map((entry) => {
                const chosen = entry.name === selected && !(entry.stock && entry.saved);
                const label = entry.stock ? (entry.saved ? " (stock)" : "") : " •";
                return (
                    `<option value="${escapeHtml(optionValue(entry))}"${chosen ? " selected" : ""}>` +
                    `${escapeHtml(entry.name)}${label}</option>`
                );
            })
            .join("");
        if (!entries.some((entry) => entry.name === selected)) {
            shipList.insertAdjacentHTML(
                "afterbegin",
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
                : "A strike craft: no turrets and nothing thick. It flies in the weapons layer, and drops into the hull layer as well only when its doctrine commits it, to ram or dock.";
        shipFighterLabel.classList.toggle("warn", problem !== null);
        for (const button of document.querySelectorAll<HTMLButtonElement>('[data-add="turret"], [data-add="beamTurret"]')) {
            button.disabled = asked;
        }
        for (const option of kindSelect.options) {
            option.disabled = asked && (option.value === "turret" || option.value === "beamTurret");
        }
    };

    let keepTimer: ReturnType<typeof setTimeout> | undefined;
    const renderInFleet = (): void => {
        if (inFleet === null) return;
        const fleet = replaceDesign(inFleet.fleet, inFleet.design, doc.blueprint);
        const skirmish = inFleet.skirmish;
        el<HTMLElement>("inFleetTitle").textContent = skirmish === undefined ? `In ${fleet.name}` : `Skirmish — round ${skirmish.round}`;
        // A design that would not fly cannot be priced, and is an ordinary state to be editing in.
        const fault = skirmish === undefined ? null : fleetFault(fleet);
        const limit = skirmish === undefined || fault !== null ? null : overLimit({ ...skirmish, player: fleet });
        el<HTMLElement>("inFleetBudget").innerHTML =
            skirmish === undefined || fault !== null ? "" : budgetRows(billOfFleet(fleet), skirmish.budget);
        el<HTMLElement>("inFleetNote").textContent =
            skirmish === undefined
                ? "Back to fleet takes this design back to every ship of it in the fleet."
                : fault !== null
                  ? "Priced once the fleet would fly."
                  : canFight({ ...skirmish, player: fleet })
                    ? `The fleet with this design, against ${skirmish.enemy.name}.`
                    : limit !== null
                      ? `The fleet with this design has ${limit}.`
                      : "The fleet with this design is over budget.";
        // Kept in the address as it is edited, so a reload picks up where this left off.
        clearTimeout(keepTimer);
        keepTimer = setTimeout(() => {
            if (inFleet === null) return;
            const design = replacedName(inFleet.fleet, inFleet.design, doc.blueprint);
            history.replaceState(null, "", designHref({ ...inFleet, fleet, design }).slice("editor.html".length));
        }, 300);
    };
    // A design that would not fly stays here until it would, so a fleet never
    // carries one it cannot be fixed from.
    const exits = [el<HTMLAnchorElement>("backToFleet"), el<HTMLAnchorElement>("battleLink")];
    const refuseBroken = (event: Event): boolean => {
        const problem = doc.view.problems[0];
        if (problem === undefined) return false;
        event.preventDefault();
        window.alert(`Fix the design first: ${problem}`);
        return true;
    };
    if (inFleet !== null) {
        el<HTMLElement>("inFleet").hidden = false;
        const back = el<HTMLAnchorElement>("backToFleet");
        back.hidden = false;
        // One way back into a battle when in a skirmish, and it is through the fleet.
        if (inFleet.skirmish !== undefined) el<HTMLElement>("battleLink").hidden = true;
        back.addEventListener("click", (event) => {
            if (inFleet === null || refuseBroken(event)) return;
            back.href = fleetHref(replaceDesign(inFleet.fleet, inFleet.design, doc.blueprint), inFleet.skirmish);
        });
    }

    const refreshPanels = (): void => {
        matchBoxesToGrid();
        renderInFleet();
        const broken = doc.view.problems.length > 0;
        for (const link of exits) link.classList.toggle("blocked", broken);
        const design = doc.view.design;
        if (document.activeElement !== shipName) shipName.value = doc.blueprint.name;
        renderFighter(design);
        if (document.activeElement !== shipNotes) shipNotes.value = doc.blueprint.notes ?? "";
        undoButton.disabled = !doc.canUndo;
        redoButton.disabled = !doc.canRedo;
        renderLibrary();
        renderProperties();
        renderStats();
        renderProblems();
    };
    const refresh = (): void => {
        refreshPanels();
        shipView.changed();
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

    /** Compiled designs by their layout, so a pad's or slipway's list does not recompile the library on every repaint. */
    const craftCache = new Map<string, ShipDesign | null>();
    const compiledCraft = (blueprint: Blueprint): ShipDesign | null => {
        const key = JSON.stringify(blueprint);
        const known = craftCache.get(key);
        if (known !== undefined) return known;
        const design = blueprintProblem(blueprint) === null ? compileDraft(blueprint) : null;
        craftCache.set(key, design);
        return design;
    };
    /** What a module of `kind` could build of `blueprint`: a fighter for a pad, any other ship for a slipway. */
    const asCraft = (blueprint: Blueprint, kind: ModuleKind): ShipDesign | null => {
        if ((blueprint.fighter === true) !== (kind === "pad")) return null;
        const design = compiledCraft(blueprint);
        return design !== null && design.fighter === (kind === "pad") ? design : null;
    };

    /** Everything a pad or slipway of `kind` could build: the ship itself, the library's, and any the hangar carries that it has not. */
    const craftChoices = (kind: ModuleKind): Map<string, Blueprint> => {
        const choices = new Map<string, Blueprint>();
        if (asCraft(doc.blueprint, kind) !== null) choices.set(doc.blueprint.name, doc.blueprint);
        // In a fleet, its own designs next: what a pad names there is the fleet's.
        for (const [name, blueprint] of Object.entries(inFleet?.fleet.designs ?? {})) {
            if (!choices.has(name) && name !== inFleet?.design && asCraft(blueprint, kind) !== null) choices.set(name, blueprint);
        }
        for (const entry of library.list()) {
            if (choices.has(entry.name)) continue;
            let blueprint: Blueprint | null;
            try {
                blueprint = library.load(entry.name);
            } catch {
                continue;
            }
            if (blueprint !== null && entry.name !== doc.blueprint.name && asCraft(blueprint, kind) !== null)
                choices.set(entry.name, blueprint);
        }
        for (const [name, blueprint] of Object.entries(doc.blueprint.hangar ?? {})) {
            if (!choices.has(name)) choices.set(name, blueprint);
        }
        return choices;
    };

    const renderDocked = (spec: ModuleSpec): void => {
        const options = ['<option value="">none</option>'];
        for (const [name, blueprint] of craftChoices(spec.kind)) {
            // The copy aboard is what flies, so it is what is measured for the pad it is on.
            const own = name === doc.blueprint.name;
            const flown = name === spec.craft && !own ? (doc.blueprint.hangar?.[name] ?? blueprint) : blueprint;
            const design = asCraft(flown, spec.kind);
            // A slipway is turned for a ship that fits only turned, when it is picked.
            const fits =
                design !== null &&
                (spec.kind === "pad"
                    ? padHolds(design, spec)
                    : [spec.craftAngle ?? 0, 0, PI / 2].some((turn) => slipwayHolds(design, { ...spec, craftAngle: turn })));
            const chosen = name === spec.craft ? " selected" : "";
            const why = spec.kind === "pad" ? " ✗ too big" : " ✗ too wide";
            options.push(
                `<option value="${escapeHtml(name)}"${chosen}>${escapeHtml(name)}${own ? " (itself)" : ""}${fits ? "" : why}</option>`,
            );
        }
        if (spec.craft !== undefined && !options.some((o) => o.includes(" selected"))) {
            options.push(`<option value="${escapeHtml(spec.craft)}" selected>${escapeHtml(spec.craft)} ✗ missing</option>`);
        }
        dockedSelect.innerHTML = options.join("");
        el<HTMLElement>("propDockedLabel").classList.toggle("warn", dockedSelect.selectedOptions[0]?.textContent?.includes("✗") === true);
    };

    const renderCraftAngle = (spec: ModuleSpec): void => {
        const turn = spec.craftAngle ?? 0;
        const options = CRAFT_ANGLES.map(
            ({ degrees, label }) =>
                `<option value="${degrees}"${abs(degreesToRadians(degrees) - turn) < 1e-9 ? " selected" : ""}>${label}</option>`,
        );
        if (!CRAFT_ANGLES.some(({ degrees }) => abs(degreesToRadians(degrees) - turn) < 1e-9)) {
            const degrees = radiansToDegrees(turn);
            options.push(`<option value="${degrees}" selected>turned ${degrees.toFixed(0)}°</option>`);
        }
        craftAngleSelect.innerHTML = options.join("");
    };

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
        if (text !== "" && !Number.isFinite(Number(text))) return;
        let value = text === "" ? null : Number(text);
        if (half === "mount") {
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
        const doctrine = withShipField(doc.blueprint.doctrine, half as "targeting" | "approach", field, value);
        const next = { ...doc.blueprint };
        if (doctrine === undefined) delete next.doctrine;
        else next.doctrine = doctrine;
        change(next, true);
    };

    for (const [key, input] of doctrineInputs) {
        const [half, field] = key.split(".") as [string, string];
        input.addEventListener("focus", () => {
            gesture = false;
        });
        input.addEventListener("input", () => editDoctrine(half, field, input));
    }

    mountDoctrineReset.addEventListener("click", () => {
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

    shipDoctrineReset.addEventListener("click", () => {
        const next = { ...doc.blueprint };
        delete next.doctrine;
        change(next);
    });

    for (const [key, input] of Object.entries(propInputs)) {
        input.addEventListener("focus", () => {
            gesture = false;
        });
        input.addEventListener("input", () => {
            if (key === "notes") {
                const text = input.value.trim();
                const path = doc.selection;
                if (path === null) return;
                change(
                    updatePlacement(doc.blueprint, path, (placement) => {
                        const next = { ...placement };
                        if (text === "") delete next.notes;
                        else next.notes = text;
                        return next;
                    }),
                    true,
                );
                return;
            }
            const value = Number(input.value);
            if (!Number.isFinite(value)) return;
            if (key === "x" || key === "y") {
                // Position is written wherever this copy's position lives, which is
                // its instance when the module is a shared part.
                const handle = selectedPosition(doc);
                if (handle === null) return;
                change(
                    updatePlacement(doc.blueprint, handle.origin.path, (p) => ({ ...p, [key]: value })),
                    true,
                );
                return;
            }
            if (key === "angle" || key === "traverse") {
                editSelected({ [key]: degreesToRadians(value) } as Partial<ModuleSpec>, true);
            } else if (key === "sealing") editSelected({ sealing: value / 1000 }, true);
            // Full is what a tank is when nothing says otherwise, so it is left unsaid.
            else if (key === "fill") {
                const path = doc.selection;
                if (path === null) return;
                const share = Math.min(Math.max(value, 0), 100) / 100;
                change(
                    updatePlacement(doc.blueprint, path, (placement) => {
                        const { fill: _, ...rest } = placement as ModuleSpec;
                        return (share < 1 ? { ...rest, fill: share } : rest) as Placement;
                    }),
                    true,
                );
            } else if (key === "computing") {
                const path = doc.selection;
                if (path === null) return;
                const share = Math.min(Math.max(value, 0), 100) / 100;
                change(
                    updatePlacement(doc.blueprint, path, (placement) => {
                        const { computing: _, ...rest } = placement as ModuleSpec;
                        return (share !== CORE_COMPUTING_SHARE ? { ...rest, computing: share } : rest) as Placement;
                    }),
                    true,
                );
            }
            // None is what a pad keeps when nothing says otherwise, so it is left unsaid.
            else if (key === "keep") {
                const path = doc.selection;
                if (path === null) return;
                const keep = Math.max(0, Math.floor(value));
                change(
                    updatePlacement(doc.blueprint, path, (placement) => {
                        const { keep: _, ...rest } = placement as ModuleSpec;
                        return (keep > 0 ? { ...rest, keep } : rest) as Placement;
                    }),
                    true,
                );
            } else editSelected({ [key]: value } as Partial<ModuleSpec>, true);
        });
    }

    padDockedInput.addEventListener("change", () => {
        const path = doc.selection;
        if (path === null) return;
        const on = padDockedInput.checked;
        change(
            updatePlacement(doc.blueprint, path, (placement) => {
                if (!("kind" in placement)) return placement;
                const next = { ...placement };
                if (on) next.docked = true;
                else delete next.docked;
                return next;
            }),
        );
    });

    buildAnchoredInput.addEventListener("change", () => {
        const path = doc.selection;
        if (path === null) return;
        const on = buildAnchoredInput.checked;
        change(
            updatePlacement(doc.blueprint, path, (placement) => {
                if (!("kind" in placement)) return placement;
                const next = { ...placement };
                if (on) next.buildAnchored = true;
                else delete next.buildAnchored;
                return next;
            }),
        );
    });

    craftAngleSelect.addEventListener("change", () => {
        const path = doc.selection;
        if (path === null) return;
        const turn = degreesToRadians(Number(craftAngleSelect.value));
        change(
            updatePlacement(doc.blueprint, path, (placement) => {
                if (!("kind" in placement)) return placement;
                const { craftAngle: _, ...rest } = placement;
                return turn === 0 ? rest : { ...rest, craftAngle: turn };
            }),
        );
    });

    dockedSelect.addEventListener("change", () => {
        const path = doc.selection;
        if (path === null) return;
        const name = dockedSelect.value;
        const kind = (placementAt(doc.blueprint, path) as ModuleSpec | null)?.kind ?? "pad";
        change(dockFighter(doc.blueprint, path, name === "" ? null : (craftChoices(kind).get(name) ?? null)));
    });

    // Every copy of a shared part is swapped, as any other edit to it is.
    kindSelect.addEventListener("change", () => {
        const path = doc.selection;
        if (path === null) return;
        const to = kindSelect.value as ModuleKind;
        change(
            updatePlacement(doc.blueprint, path, (placement) =>
                isModuleSpec(placement) ? refitModule(placement as ModuleSpec, to) : placement,
            ),
        );
    });

    weaponInput.addEventListener("change", () => {
        const path = doc.selection;
        if (path === null) return;
        const on = weaponInput.checked;
        // Absent rather than false when it is off, so a blueprint file only ever
        // says the unusual thing. A tick is one discrete act, so it takes an undo
        // step of its own rather than amending whatever came before it.
        change(
            updatePlacement(doc.blueprint, path, (placement) => {
                if (!("kind" in placement)) return placement;
                const next = { ...placement };
                if (on) next.weapon = true;
                else delete next.weapon;
                return next;
            }),
        );
    });

    mainInput.addEventListener("change", () => {
        const path = doc.selection;
        if (path === null) return;
        const on = mainInput.checked;
        change(
            updatePlacement(doc.blueprint, path, (placement) => {
                if (!("kind" in placement)) return placement;
                const next = { ...placement };
                // Absent rather than true when it is on: main is the usual thing.
                if (on) delete next.main;
                else next.main = false;
                return next;
            }),
        );
    });

    /**
     * Box to triangle and back.
     *
     * A module made triangular starts as the wedge filling its own box — nose on
     * the bow face, base across the stern — which is the shape a packing of
     * rectangles cannot draw and the one anybody reaching for this wanted. Every
     * other triangle is a corner or two away from it, and the corners are what
     * the drag is for.
     *
     * Squaring one off gives back the box its corners fitted inside, in the place
     * that box was, so the material does not jump.
     */
    shapeInput.addEventListener("change", () => {
        const origin = doc.selectedOrigin();
        const spec = doc.view.modules[doc.selectedLoose()[0] ?? -1];
        if (origin === null || spec === undefined) return;
        const shaped = shapeInput.checked ? shapeModule(spec, wedge(spec)) : shapeModule(spec, null);
        if (shaped === null) {
            shapeInput.checked = isShaped(spec);
            return;
        }
        change(reshapePlacement(doc.blueprint, origin, shaped.vertices ?? null, shaped.x - spec.x, shaped.y - spec.y));
    });

    thickInput.addEventListener("change", () => {
        const path = doc.selection;
        if (path === null) return;
        const on = thickInput.checked;
        // Absent rather than false when it is off, as `weapon` is.
        change(
            updatePlacement(doc.blueprint, path, (placement) => {
                if (!("kind" in placement)) return placement;
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
    el<HTMLButtonElement>("propDelete").addEventListener("click", deleteSelected);

    duplicateButton.addEventListener("click", () => {
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

    assemblyButton.addEventListener("click", () => {
        const assembled = createAssembly(doc.blueprint, doc.selections);
        if (assembled === null) return;
        doc.apply(assembled.blueprint);
        // Selected straight away, because the next thing anybody does with a new
        // assembly is place it again or mirror it, and both live on its own panel.
        doc.select(assembled.path);
        refresh();
    });

    addToAssemblyButton.addEventListener("click", () => {
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

    selectAssemblyButton.addEventListener("click", () => {
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
        [assemblyX, "x"],
        [assemblyY, "y"],
    ] as const) {
        input.addEventListener("input", () => {
            const value = Number(input.value);
            if (Number.isFinite(value)) editInstance({ [key]: value }, true);
        });
        input.addEventListener("change", () => {
            gesture = false;
        });
    }

    assemblyAngle.addEventListener("input", () => {
        const value = Number(assemblyAngle.value);
        if (Number.isFinite(value)) editInstance({ angle: degreesToRadians(value) }, true);
    });
    assemblyAngle.addEventListener("change", () => {
        gesture = false;
    });

    // Live, like the ship's own name, so the box holds what is being typed and
    // the layout takes it as soon as it is a name it can use. A name already
    // taken is simply not applied — the assembly keeps the one it has, and the
    // panel says why rather than putting the old text back mid-word.
    assemblyName.addEventListener("input", () => {
        const path = doc.selection;
        if (path === null) return;
        const why = renameProblem(doc.blueprint, path, assemblyName.value);
        if (why !== null) {
            assemblyOf.textContent = why;
            return;
        }
        change(renameAssembly(doc.blueprint, path, assemblyName.value), true);
    });
    assemblyName.addEventListener("focus", () => {
        gesture = false;
    });
    assemblyName.addEventListener("change", () => {
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

    assemblyRepeat.addEventListener("input", () => {
        const path = doc.selection;
        const value = Number(assemblyRepeat.value);
        if (path === null || !Number.isFinite(value)) return;
        const copies = Math.max(1, Math.min(MAX_REPEAT, Math.round(value)));
        change(setRepetition(doc.blueprint, path, copies, repeatOf().step), true);
    });
    assemblyRepeat.addEventListener("change", () => {
        gesture = false;
    });

    for (const [input, key] of [
        [assemblyStepX, "x"],
        [assemblyStepY, "y"],
        [assemblyStepAngle, "angle"],
    ] as const) {
        input.addEventListener("input", () => {
            const path = doc.selection;
            const value = Number(input.value);
            if (path === null || !Number.isFinite(value)) return;
            const current = repeatOf();
            const step = { ...current.step };
            if (key === "angle") step.angle = degreesToRadians(value);
            else step[key] = value;
            change(setRepetition(doc.blueprint, path, current.repeat, step), true);
        });
        input.addEventListener("change", () => {
            gesture = false;
        });
    }

    assemblyMirror.addEventListener("change", () => {
        const path = doc.selection;
        if (path === null) return;
        change(setMirror(doc.blueprint, path, assemblyMirror.checked));
    });

    assemblyDuplicate.addEventListener("click", () => {
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

    assemblyDissolve.addEventListener("click", () => {
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

    assemblyDelete.addEventListener("click", deleteSelected);

    /** Take what `path` names out of its assembly, keeping the loose copy it leaves picked. */
    const takeOut = (path: ModulePath | null): void => {
        if (path === null) return;
        const taken = takeOutOfAssembly(doc.blueprint, path);
        if (taken === null) return;
        doc.apply(taken.blueprint);
        doc.select(taken.path);
        refresh();
    };
    takeOutButton.addEventListener("click", () => takeOut(doc.selectedOrigin()?.path ?? null));
    assemblyTakeOut.addEventListener("click", () => takeOut(doc.selection));

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

    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-add]")) {
        button.addEventListener("click", () => {
            const kind = button.dataset["add"] as ShipModuleKind;
            const spec: ModuleSpec = { ...DEFAULTS[kind], x: 0, y: 0 };
            const view = {
                x: camera.x,
                y: camera.y,
                width: canvas.width / camera.scale,
                height: canvas.height / camera.scale,
            };
            // With an assembly selected, the module goes into it, at its origin.
            const into = doc.selectedAssemblyPath();
            if (into !== null) {
                const sized = arrivingModule(spec, view, snapMetres());
                addInto(into, { ...sized, x: 0, y: 0 });
                return;
            }
            // The first module of a new ship is where it starts, at the size it
            // starts at: the view is still whatever the last ship left it as.
            const empty = (doc.blueprint.modules ?? []).length === 0;
            const added = addModule(doc.blueprint, empty ? spec : arrivingModule(spec, view, snapMetres()));
            doc.apply(added.blueprint);
            doc.select(added.path);
            gesture = false;
            refresh();
        });
    }

    shipName.addEventListener("input", () => {
        const name = shipName.value.trim();
        if (name === "") return;
        change(renameShip(doc.blueprint, name), true);
    });
    shipFighter.addEventListener("change", () => {
        const next = { ...doc.blueprint };
        if (shipFighter.checked) next.fighter = true;
        else delete next.fighter;
        change(next);
    });
    shipName.addEventListener("focus", () => {
        gesture = false;
    });
    shipNotes.addEventListener("focus", () => {
        gesture = false;
    });
    shipNotes.addEventListener("input", () => {
        const text = shipNotes.value.trim();
        const next = { ...doc.blueprint };
        if (text === "") delete next.notes;
        else next.notes = text;
        change(next, true);
    });

    undoButton.addEventListener("click", () => {
        doc.undo();
        gesture = false;
        refresh();
    });
    redoButton.addEventListener("click", () => {
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
        shipView.easeToNext();
        gesture = false;
        refresh();
    };

    shipList.addEventListener("change", () => open(shipList.value));
    const taken = (): string[] => library.list().map((entry) => entry.name);
    el<HTMLButtonElement>("newShip").addEventListener("click", () => {
        doc.replace(emptyBlueprint(unusedName("New ship", taken())));
        shipView.easeToNext();
        gesture = false;
        refresh();
    });
    // The copy is left unsaved, as a new ship is: what is on the screen is the
    // player's to keep or abandon until they say otherwise. This is how a
    // shipped hull becomes the start of a ship of their own without the save
    // shadowing the hull they started from.
    el<HTMLButtonElement>("duplicateShip").addEventListener("click", () => {
        doc.replace(renameShip(doc.blueprint, unusedName(nextName(doc.blueprint.name), taken())));
        gesture = false;
        refresh();
    });
    // Following a link away keeps the work, in case it was not saved. A reload
    // does not: that is how changes are thrown away.
    const keep = (): void => {
        try {
            library.saveIfChanged(doc.blueprint);
        } catch {
            // Storage full or refused: nothing more to be done on the way out.
        }
    };
    for (const link of document.querySelectorAll("a")) link.addEventListener("click", keep);
    saveButton.addEventListener("click", () => {
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
    deleteShipButton.addEventListener("click", () => {
        const name = doc.blueprint.name;
        if (!window.confirm(`Delete the saved copy of ${name}?`)) return;
        library.remove(name);
        doc.apply(emptyBlueprint(unusedName("New ship", taken())));
        gesture = false;
        shipView.easeToNext();
        refresh();
    });
    exportButton.addEventListener("click", () => {
        const blob = new Blob([toFileText(doc.blueprint)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${doc.blueprint.name.replace(/[^\w.-]+/g, "-").toLowerCase()}.ship.json`;
        link.click();
        URL.revokeObjectURL(url);
    });
    const importInput = el<HTMLInputElement>("importShip");
    el<HTMLButtonElement>("importTrigger").addEventListener("click", () => importInput.click());
    importInput.addEventListener("change", () => {
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
            shipView.easeToNext();
            gesture = false;
            refresh();
        });
        importInput.value = "";
    });

    arcsButton.addEventListener("click", () => {
        shipView.cycleArcs();
        arcsButton.textContent = ARC_LABELS[shipView.arcs];
    });
    refitButton.addEventListener("click", () => {
        shipView.toggleRefit();
        refitButton.setAttribute("aria-pressed", String(shipView.showRefit));
    });

    // The ship as it stands, as a fleet of one, goes with the link.
    el<HTMLAnchorElement>("battleLink").addEventListener("click", (event) => {
        if (refuseBroken(event)) return;
        (event.currentTarget as HTMLAnchorElement).href = battleHref(shipFleet(doc.blueprint));
    });

    // Fixed text, although the position snap is not: the footer's height is part
    // of the canvas's, so a line that grows and shrinks resizes the view under
    // the ship. The live figure is drawn in the canvas corner instead.
    keyHelp(hint, [
        { keys: "Click a module", does: "Select it" },
        { keys: "Drag a module", does: "Move it" },
        { keys: "Drag a corner or edge", does: "Size it, pushing its neighbours; with Ctrl, alone; with Shift, about its middle" },
        { keys: "Drag the knob", does: "Turn it" },
        { keys: "Two touching selected", does: "Drag the face between them" },
        { keys: "Shift-click", does: "Pick several, to Create assembly or Add them to the last assembly picked" },
        { keys: "Assembly selected", does: "A new module goes into it" },
        { keys: "Alt", does: `Hold to escape the snaps: positions to a tenth of the grid on screen, facings to ${ANGLE_SNAP_DEGREES}°` },
        { keys: "Drag empty space", does: "Pan" },
        { keys: "Scroll", does: "Zoom" },
        { keys: "F", does: "Fit the ship in view" },
        { keys: "A", does: "Cycle the arcs drawn" },
        { keys: "Delete or Backspace", does: "Remove what is selected" },
        { keys: "Escape", does: "Select nothing" },
        { keys: "Ctrl+Z, Ctrl+Shift+Z", does: "Undo, redo" },
    ]);

    refresh();
}

/** A name not already in the library, so a new ship does not shadow a saved one. */
function isModuleSpec(placement: Placement): boolean {
    return !("use" in placement);
}

/** Each module out of every core's reach, as a warning: it flies, but that module does nothing. */
function reachNote(design: ShipDesign | null): string {
    const out: string[] = [];
    design?.coveredBy?.forEach((cores, m) => {
        if (cores === null || cores.length > 0) return;
        const module = design.modules[m]!;
        out.push(`module ${module.index} (${module.spec.kind}) is out of every core's reach, so it will not work`);
    });
    if (out.length === 0) return "";
    return (
        `<p class="note">${out.length} warning${out.length > 1 ? "s" : ""}</p><ul class="note">` +
        out.map((w) => `<li>${escapeHtml(w)}</li>`).join("") +
        "</ul>"
    );
}

/**
 * Keys a file carried that nothing reads, said rather than refused: they are
 * kept, and go back out with the ship when it is saved or exported.
 */
function unreadNote(warnings: readonly string[]): string {
    if (warnings.length === 0) return "";
    return (
        `<p class="note">Kept as written, and saved and exported with the ship:</p><ul class="note">` +
        warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("") +
        "</ul>"
    );
}

function escapeHtml(text: string): string {
    return text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}
