import { parseBattleSetup, serialiseBattleSetup, type BattleSetup } from './customBattle.js';

/**
 * A custom battle carried whole in a link: the battle file, deflated and
 * written in base64url after `#battle=`, so whoever opens it fights the same
 * battle, seed and all, with nothing to download first.
 *
 * Deflated because a fleet file is mostly the same few keys over and over: a
 * Star Destroyer's battle is a few kilobytes of link rather than tens.
 */

const KEY = '#battle=';

/** The fragment that carries a battle, `#battle=` and all. */
export async function battleFragment(setup: BattleSetup): Promise<string> {
  const text = JSON.stringify(serialiseBattleSetup(setup));
  const packed = await pipe(new TextEncoder().encode(text), new CompressionStream('deflate-raw'));
  return KEY + toBase64Url(packed);
}

/** The battle a fragment carries, or null if it carries none. Throws on one it carries but cannot read. */
export async function linkedBattle(hash: string): Promise<BattleSetup | null> {
  if (!hash.startsWith(KEY)) return null;
  const unpacked = await pipe(fromBase64Url(hash.slice(KEY.length)), new DecompressionStream('deflate-raw'));
  return parseBattleSetup(JSON.parse(new TextDecoder().decode(unpacked)));
}

async function pipe(bytes: Uint8Array, through: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(through);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
