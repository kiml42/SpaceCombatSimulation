/** One setting as the settings cards draw it: a label and its box, its meaning on hover. */
export interface SettingField {
  readonly name: string;
  /** Which `[data-fields]` slot it goes in. */
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

/**
 * A row of the settings cards, as the evolution and skirmish pages draw them:
 * one setting a row.
 */
export function fieldRow(field: SettingField, id = field.name): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'field';
  row.title = field.title;
  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = field.label;
  const input = document.createElement('input');
  input.id = id;
  input.type = 'number';
  const min = field.min === undefined ? 0 : field.min;
  if (min !== null) input.min = String(min);
  if (field.max !== undefined) input.max = String(field.max);
  input.step = String(field.step);
  row.append(label, input);
  return row;
}

/** The ± box of a spread, added to the row of the setting it spreads. */
function addSpread(row: HTMLDivElement, field: SettingField, id: string): void {
  const plusMinus = document.createElement('span');
  plusMinus.textContent = '±';
  const input = fieldRow(field, id).querySelector('input')!;
  input.title = field.title;
  row.classList.add('spread');
  row.append(plusMinus, input);
}

/** Put the rows for each field of a group in place of every `[data-fields=group]` under `root`. */
export function fillFields(root: ParentNode, fields: readonly SettingField[], prefix = ''): void {
  for (const slot of root.querySelectorAll<HTMLElement>('[data-fields]')) {
    const group = slot.dataset['fields'];
    const rows = new Map<string, HTMLDivElement>();
    for (const field of fields.filter((f) => f.group === group)) {
      if (field.spreadOf === undefined) rows.set(field.name, fieldRow(field, prefix + field.name));
      else addSpread(rows.get(field.spreadOf)!, field, prefix + field.name);
    }
    slot.replaceWith(...rows.values());
  }
}
