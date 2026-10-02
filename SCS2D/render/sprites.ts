import { shutterWeight } from './exposure.js';

/**
 * Small images stretched over what is drawn, for shading a stroke cannot do:
 * a fade along a streak, across it, or out from a centre. Made once per colour
 * and kept.
 */

export type SpriteShape =
  /** Fades along its length with the shutter; hard sides. */
  | 'streak'
  /** Fades along its length with the shutter, and out from its centre line. */
  | 'glowStreak'
  /** A hard-edged disc. */
  | 'disc'
  /** Fades out from its centre. */
  | 'halo';

type Image = CanvasImageSource & { width: number; height: number };

const ALONG = 64;
const ACROSS = 32;
const cache = new Map<string, Image | null>();

/** The sprite for this shape and colour, or null where nothing can draw one. */
export function sprite(shape: SpriteShape, colour: string): Image | null {
  const key = `${shape} ${colour}`;
  let made = cache.get(key);
  if (made === undefined) {
    made = makeSprite(shape, colour);
    cache.set(key, made);
  }
  return made;
}

/** How bright the sprite is at `(u, v)`, both from 0 to 1 across it. */
function shade(shape: SpriteShape, u: number, v: number): number {
  const across = Math.abs(2 * v - 1);
  switch (shape) {
    case 'streak':
      return shutterWeight(u);
    case 'glowStreak':
      return shutterWeight(u) * falloff(across);
    case 'disc':
      return radial(u, v) <= 1 ? 1 : 0;
    case 'halo':
      return falloff(radial(u, v));
  }
}

/** Distance from the centre, 1 at the edge of the square. */
function radial(u: number, v: number): number {
  const x = 2 * u - 1;
  const y = 2 * v - 1;
  return Math.sqrt(x * x + y * y);
}

/** Full at the centre, nothing at the edge, softly. */
function falloff(r: number): number {
  if (r >= 1) return 0;
  const left = 1 - r * r;
  return left * left;
}

function makeSprite(shape: SpriteShape, colour: string): Image | null {
  const width = shape === 'streak' ? ALONG : shape === 'glowStreak' ? ALONG : ACROSS;
  const height = shape === 'streak' ? 1 : ACROSS;
  const canvas = blankCanvas(width, height);
  const ctx = canvas?.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (canvas === null || ctx === null || ctx === undefined) return null;
  const [r, g, b, a] = rgba(colour);
  const image = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = 4 * (y * width + x);
      image.data[i] = r;
      image.data[i + 1] = g;
      image.data[i + 2] = b;
      image.data[i + 3] = Math.round(a * shade(shape, (x + 0.5) / width, (y + 0.5) / height));
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function blankCanvas(width: number, height: number): (Image & { getContext(id: '2d'): unknown }) | null {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  return null;
}

/** `#rrggbb` or `#rrggbbaa` as four bytes. */
export function rgba(colour: string): [number, number, number, number] {
  const hex = colour.slice(1);
  const byte = (at: number): number => parseInt(hex.slice(at, at + 2), 16);
  return [byte(0), byte(2), byte(4), hex.length >= 8 ? byte(6) : 255];
}
