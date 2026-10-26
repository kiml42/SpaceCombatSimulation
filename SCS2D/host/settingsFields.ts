/** One setting as the settings cards draw it: a label and its box, its meaning on hover. */
export interface SettingField {
    readonly name: string;
    /** Which group of a settings card it is drawn in. */
    readonly group: string;
    readonly label: string;
    readonly title: string;
    readonly step: number;
    /** The least it may be, 0 where not said, or null for none. */
    readonly min?: number | null;
    readonly max?: number;
    /** Its default. */
    readonly value: number;
    /** The setting this is the ± of, drawn as a second box on that one's row. */
    readonly spreadOf?: string;
}
