export const themes = ['dark', 'light'] as const;
export type Theme = (typeof themes)[number];

export type TokenRole =
  | 'text'
  | 'code'
  | 'on-accent'
  | 'surface'
  | 'state'
  | 'glass'
  | 'scrim'
  | 'control'
  | 'accent-fill'
  | 'decorative';

export type ContrastResult = {
  theme: Theme;
  token: string;
  background: string;
  ratio: number;
  required: number;
};

export type Rgba = { r: number; g: number; b: number; a: number };
type Tokens = Record<string, string>;

const TEXT_RATIO = 4.5;
const CONTROL_RATIO = 3;

const SURFACES = ['canvas', 'surface', 'elevated'];
const DECORATIVE = ['line', 'line-subtle', 'glass-line', 'glass-highlight'];

export function tokenRole(name: string): TokenRole | undefined {
  if (name.startsWith('code-')) return 'code';
  if (name === 'on-accent') return 'on-accent';
  if (name === 'accent' || name === 'accent-hover') return 'accent-fill';
  if (name === 'scrim') return 'scrim';
  if (name === 'glass' || name === 'glass-strong') return 'glass';
  if (name === 'line-control' || name === 'focus') return 'control';
  if (name === 'hover' || name === 'pressed') return 'state';
  if (name.endsWith('-subtle') && name !== 'line-subtle') return 'state';
  if (name === 'fg' || name.startsWith('fg-') || name.endsWith('-fg')) {
    return 'text';
  }
  if (SURFACES.includes(name)) return 'surface';
  if (DECORATIVE.includes(name)) return 'decorative';
  return undefined;
}

export function readColorTokens(css: string): Record<Theme, Tokens> {
  const lightStart = css.indexOf(":root[data-theme='light']");
  const dark = extractColors(css.slice(0, lightStart));
  const light = extractColors(css.slice(lightStart));

  return { dark, light: { ...dark, ...light } };
}

function extractColors(css: string): Tokens {
  const tokens: Tokens = {};

  for (const [, name, value] of css.matchAll(
    /--color-([a-z-]+):\s*([^;*]+);/g,
  )) {
    if (name && value) tokens[name] = value.trim();
  }

  return tokens;
}

function glassTone(css: string, name: string, fallback?: number): number {
  const value = new RegExp(`--glass-${name}:\\s*([\\d.]+);`).exec(css)?.[1];
  const tone = value === undefined ? fallback : Number(value);

  if (tone === undefined) throw new Error(`Missing --glass-${name}`);

  return tone;
}

/**
 * The darkest and lightest colors anything behind glass can become. The tone
 * filters run after saturation, so these bounds hold for every possible backdrop.
 */
export function readGlassBackdrop(css: string) {
  const lightStart = css.indexOf(":root[data-theme='light']");
  const [darkCss, lightCss] = [css.slice(0, lightStart), css.slice(lightStart)];

  const contrast = glassTone(darkCss, 'contrast');
  const brightness = glassTone(darkCss, 'brightness');

  const bounds = (slope: number, scale: number) => {
    const channel = (value: number) => {
      const contrasted = Math.min(1, (value - 0.5) * slope + 0.5);
      return Math.min(1, Math.max(0, contrasted) * scale) * 255;
    };
    const grey = (value: number): Rgba => ({
      r: channel(value),
      g: channel(value),
      b: channel(value),
      a: 1,
    });

    return { 'backdrop-darkest': grey(0), 'backdrop-lightest': grey(1) };
  };

  return {
    dark: bounds(contrast, brightness),
    light: bounds(
      glassTone(lightCss, 'contrast', contrast),
      glassTone(lightCss, 'brightness', brightness),
    ),
  } satisfies Record<Theme, Record<string, Rgba>>;
}

export function parseColor(value: string): Rgba {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  if (hex) {
    const [, r = '', g = '', b = ''] = hex;
    return {
      r: parseInt(r, 16),
      g: parseInt(g, 16),
      b: parseInt(b, 16),
      a: 1,
    };
  }

  const rgb = /^rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)$/.exec(value);
  if (rgb) {
    const [, r, g, b, a] = rgb;
    return { r: Number(r), g: Number(g), b: Number(b), a: Number(a) };
  }

  throw new Error(`Unsupported color format: ${value}`);
}

/** Flattens layers onto an opaque base, listed from bottom to top. */
export function composite([base, ...layers]: Rgba[]): Rgba {
  if (!base || base.a !== 1) {
    throw new Error('The bottom layer must be opaque');
  }

  return layers.reduce(
    (below, { r, g, b, a }) => ({
      r: r * a + below.r * (1 - a),
      g: g * a + below.g * (1 - a),
      b: b * a + below.b * (1 - a),
      a: 1,
    }),
    base,
  );
}

function luminance({ r, g, b }: Rgba): number {
  const [red = 0, green = 0, blue = 0] = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function contrastRatio(foreground: Rgba, background: Rgba): number {
  const a = luminance(foreground);
  const b = luminance(background);

  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Every stack of layers a foreground can realistically sit on. */
function backgroundStacks(tokens: Tokens): string[][] {
  const names = Object.keys(tokens);
  const states = names.filter((name) => tokenRole(name) === 'state');
  const glasses = names.filter((name) => tokenRole(name) === 'glass');

  const panels = [
    ...SURFACES.map((surface) => [surface]),
    ...['backdrop-darkest', 'backdrop-lightest'].flatMap((backdrop) =>
      glasses.map((glass) => [backdrop, glass]),
    ),
  ];

  return panels.flatMap((panel) => [
    panel,
    ...states.map((state) => [...panel, state]),
  ]);
}

export function auditContrast(css: string): ContrastResult[] {
  const results: ContrastResult[] = [];

  for (const theme of themes) {
    const tokens = readColorTokens(css)[theme];
    const backdrop: Record<string, Rgba> = readGlassBackdrop(css)[theme];
    const color = (name: string) =>
      backdrop[name] ?? parseColor(tokens[name] ?? '');
    const check = (token: string, background: string[], required: number) => {
      results.push({
        theme,
        token,
        background: background.join(' + '),
        ratio: contrastRatio(
          color(token),
          composite(background.map((name) => color(name))),
        ),
        required,
      });
    };

    for (const stack of backgroundStacks(tokens)) {
      for (const name of Object.keys(tokens)) {
        const role = tokenRole(name);
        const onSolid = !stack[0]?.startsWith('backdrop');
        if (role === 'text') check(name, stack, TEXT_RATIO);
        if (role === 'code' && onSolid) check(name, stack, TEXT_RATIO);
        if (role === 'control' || role === 'accent-fill') {
          check(name, stack, CONTROL_RATIO);
        }
      }
    }

    check('on-accent', ['accent'], TEXT_RATIO);
    check('on-accent', ['accent-hover'], TEXT_RATIO);
  }

  return results;
}
