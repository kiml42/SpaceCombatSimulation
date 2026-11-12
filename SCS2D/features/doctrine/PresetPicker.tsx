import { DOCTRINE_PRESETS, type DoctrinePreset } from "~/editor/doctrinePresets";

/** A list of doctrine presets that applies the one picked and goes back to its prompt, as picking is an action. */
export function PresetPicker({ id, onPick }: { readonly id?: string; readonly onPick: (preset: DoctrinePreset) => void }) {
    return (
        <select
            id={id}
            aria-label="Doctrine preset"
            title="Set the ship's doctrine to a ready-made way of fighting"
            value=""
            onChange={(event) => {
                const preset = DOCTRINE_PRESETS[Number(event.target.value)];
                if (event.target.value !== "" && preset !== undefined) onPick(preset);
            }}
        >
            <option value="">Preset…</option>
            {DOCTRINE_PRESETS.map((preset, n) => (
                <option key={preset.name} value={n} title={preset.hint}>
                    {preset.name}
                </option>
            ))}
        </select>
    );
}
