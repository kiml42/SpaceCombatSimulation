import type { SettingField } from "~/host/settingsFields";
import { NumberField } from "~/ui/fields/NumberField";

export interface SettingFieldsProps {
    readonly fields: readonly SettingField[];
    /** Which of them to draw: those of this group. */
    readonly group: string;
    /** Each box's text by its field's name, as typed. */
    readonly values: Readonly<Record<string, string>>;
    readonly onChange: (name: string, text: string) => void;
}

/** The settings of one group as rows, a setting's ± on its row; each box's id is its field's name. */
export function SettingFields({ fields, group, values, onChange }: SettingFieldsProps) {
    const mine = fields.filter((field) => field.group === group);
    return mine
        .filter((field) => field.spreadOf === undefined)
        .map((field) => {
            const spread = mine.find((each) => each.spreadOf === field.name);
            return (
                <NumberField
                    key={field.name}
                    id={field.name}
                    label={field.label}
                    title={field.title}
                    value={values[field.name] ?? String(field.value)}
                    onChange={(text) => onChange(field.name, text)}
                    step={field.step}
                    {...(field.min === undefined ? {} : { min: field.min })}
                    {...(field.max === undefined ? {} : { max: field.max })}
                    {...(spread === undefined
                        ? {}
                        : {
                              spread: {
                                  id: spread.name,
                                  value: values[spread.name] ?? String(spread.value),
                                  onChange: (text: string) => onChange(spread.name, text),
                                  title: spread.title,
                              },
                          })}
                />
            );
        });
}

/** What a box says, as a number: its default where it is blank or unreadable, whole where the setting counts, and no less than its least. */
export function settingValue(field: SettingField, text: string | undefined, whole = false): number {
    const raw = (text ?? "").trim();
    const n = raw === "" ? NaN : Number(raw);
    if (!Number.isFinite(n)) return field.value;
    const rounded = whole ? Math.round(n) : n;
    const least = field.min === undefined ? 0 : field.min;
    return least !== null && rounded < least ? least : rounded;
}
