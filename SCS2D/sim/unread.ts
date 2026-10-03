/**
 * Keys a file carried that its format does not read, kept as they were
 * written.
 *
 * A file is hand-edited, and a key that is not right — a typo, a field from a
 * newer format, a bell on a turret — is a thing to be told about rather than
 * a reason to refuse the whole file. So it is held beside what was read, said
 * as a warning wherever the file is opened, and written back out when it is
 * saved, rather than quietly lost.
 */
export type UnreadKeys = Readonly<Record<string, unknown>>;

/** What of `value` is not among `read`, or undefined if all of it is. */
export function unreadOf(value: Readonly<Record<string, unknown>>, read: readonly string[]): UnreadKeys | undefined {
  let out: Record<string, unknown> | undefined;
  for (const key of Object.keys(value)) {
    if (read.includes(key)) continue;
    (out ??= {})[key] = value[key];
  }
  return out;
}

/** A warning for each place that carries keys nothing reads. */
export function unreadWarning(where: string, keys: UnreadKeys | undefined, out: string[]): void {
  if (keys === undefined) return;
  const names = Object.keys(keys);
  if (names.length === 0) return;
  out.push(
    `${where} has ${names.length > 1 ? 'keys' : 'a key'} the game does not read, kept as written: ${names.join(', ')}`,
  );
}

/** Write unread keys back beside what was read, without overwriting any of it. */
export function writeUnread(raw: Record<string, unknown>, keys: UnreadKeys | undefined): void {
  if (keys === undefined) return;
  for (const [key, value] of Object.entries(keys)) {
    if (!(key in raw)) raw[key] = value;
  }
}
