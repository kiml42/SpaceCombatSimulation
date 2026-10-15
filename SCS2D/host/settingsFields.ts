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

/** Put the rows for each field of a group in place of every `[data-fields=group]` under `root`. */
export function fillFields(root: ParentNode, fields: readonly SettingField[], prefix = ''): void {
  for (const slot of root.querySelectorAll<HTMLElement>('[data-fields]')) {
    const group = slot.dataset['fields'];
    slot.replaceWith(...fields.filter((f) => f.group === group).map((f) => fieldRow(f, prefix + f.name)));
  }
}
