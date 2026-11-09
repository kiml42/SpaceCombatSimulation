import { SCENES } from "~/scenarios/scenes";

/** The scene list's last entry: a battle set up in the panel rather than in code. */
export const CUSTOM = SCENES.length;
const CUSTOM_PARAM = "custom";

/** How the address names a scene: `?scene=Duel`, or `?scene=custom`. */
export function sceneParam(index: number): string {
    return index === CUSTOM ? CUSTOM_PARAM : (SCENES[index]?.name ?? SCENES[0]!.name);
}

/** The scene the address names, or the first if it names none. */
export function sceneIndex(param: string | null): number {
    if (param === CUSTOM_PARAM) return CUSTOM;
    const index = SCENES.findIndex((scene) => scene.name === param);
    return index < 0 ? 0 : index;
}

/** How the address names a scene's variant: `&variant=300 fighters`, or nothing for a scene without them. */
export function variantParam(scene: number, variant: number): string | null {
    const variants = SCENES[scene]?.variants;
    return variants === undefined ? null : (variants[variant] ?? variants[0]!);
}

/** The variant of `scene` the address names, or its first if it names none. */
export function variantIndex(scene: number, param: string | null): number {
    const index = SCENES[scene]?.variants?.indexOf(param ?? "") ?? -1;
    return index < 0 ? 0 : index;
}
