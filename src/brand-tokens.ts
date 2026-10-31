/** Owner brand tokens (WH-091, WH-070 level 1). Pure, no I/O: the compiler, the Worker and the owner screen all use this one
 * file, so the contrast rule the owner sees is the rule the compiler enforces. Only values that pass `brandProblems` may reach
 * rendered CSS, and every CSS value comes from a fixed table or a validated #rrggbb string, never from owner text. */
export const brandFonts = Object.freeze({
  classic: {label: 'Classic', note: 'Serif headings, plain sans text', heading: "Georgia,'Times New Roman',serif", body: 'Arial,Helvetica,sans-serif'},
  modern: {label: 'Modern', note: 'Clean sans-serif throughout', heading: "system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif", body: "system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"},
  editorial: {label: 'Editorial', note: 'Serif throughout, like a magazine', heading: "Georgia,'Times New Roman',serif", body: "Georgia,'Times New Roman',serif"},
  humanist: {label: 'Friendly', note: 'Soft, open letterforms', heading: "Optima,Candara,'Segoe UI',Ubuntu,sans-serif", body: "'Segoe UI',Candara,Optima,Ubuntu,sans-serif"},
  technical: {label: 'Technical', note: 'Monospace headings, sans text', heading: "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace", body: "system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"}
} as const);
export type BrandFont = keyof typeof brandFonts;
export const brandRadii = Object.freeze({sharp: {label: 'Sharp', px: 0}, soft: {label: 'Soft', px: 12}, round: {label: 'Round', px: 28}} as const);
export type BrandRadius = keyof typeof brandRadii;
export const brandDensities = Object.freeze({compact: {label: 'Compact', scale: 0.75}, comfortable: {label: 'Comfortable', scale: 1}, spacious: {label: 'Spacious', scale: 1.3}} as const);
export type BrandDensity = keyof typeof brandDensities;
export const sectionVariants = ['plain', 'card', 'callout', 'quote'] as const;
export type SectionVariant = (typeof sectionVariants)[number];

export type BrandColors = {ink: string; paper: string; accent: string};
export type Brand = {
  source: null | {kitId: string; version: number};
  light: BrandColors; dark: null | BrandColors;
  font: BrandFont; radius: BrandRadius; density: BrandDensity;
  logo: null | {id: string; alt: string};
};
export const brandKeys = ['source', 'light', 'dark', 'font', 'radius', 'density', 'logo'] as const;
export const minimumContrast = 4.5;

const hex = /^#[0-9a-f]{6}$/;
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
export const isHex = (v: unknown): v is string => typeof v === 'string' && hex.test(v);
const channels = (c: string) => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
const toHex = (rgb: number[]) => '#' + rgb.map(n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('');
export function luminance(c: string) {
  const [r, g, b] = channels(c).map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/** `amount` of `b` mixed into `a`. */
export function mix(a: string, b: string, amount: number) {
  const x = channels(a), y = channels(b);
  return toHex(x.map((v, i) => v + (y[i] - v) * amount));
}
/** The soft panel color. Derived, never chosen, so it always sits between paper and ink. */
export const tintOf = (c: BrandColors) => mix(c.paper, c.ink, 0.1);

export type BrandProblem = {path: string; message: string};
const names: Record<string, string> = {ink: 'Text', accent: 'Accent'};
/** Plain-words reasons a palette cannot be used. Empty means every pairing is readable (4.5:1, WCAG AA for body text). */
export function colorProblems(c: BrandColors, mode: 'light' | 'dark'): BrandProblem[] {
  const where = mode === 'dark' ? 'dark mode' : 'light mode', out: BrandProblem[] = [];
  for (const key of ['ink', 'paper', 'accent'] as const) if (!isHex(c[key])) out.push({path: `${mode}.${key}`, message: 'Use a color in the form #rrggbb.'});
  if (out.length) return out;
  const check = (fg: string, bg: string, path: string, label: string, against: string) => {
    const ratio = contrast(fg, bg);
    if (ratio < minimumContrast) out.push({path, message: `${label} on ${against} is too hard to read in ${where} (contrast ${ratio.toFixed(1)} to 1; at least ${minimumContrast} to 1 is needed so people with low vision can read it).`});
  };
  check(c.ink, c.paper, `${mode}.ink`, names.ink, 'the background');
  check(c.accent, c.paper, `${mode}.accent`, names.accent, 'the background');
  check(c.ink, tintOf(c), `${mode}.ink`, names.ink, 'the soft panels (the background mixed with the text color)');
  check(c.accent, tintOf(c), `${mode}.accent`, names.accent, 'the soft panels');
  return out;
}
export function brandProblems(b: Brand): BrandProblem[] {
  return [...colorProblems(b.light, 'light'), ...(b.dark ? colorProblems(b.dark, 'dark') : [])];
}
/** Moves a failing color toward black or white, in small steps, until it passes. Pure and deterministic; never touches the
 * background the text sits on. Returns the same palette when nothing fails. */
export function adjustColors(c: BrandColors, mode: 'light' | 'dark'): BrandColors {
  const next = {...c};
  const toward = contrast(next.paper, '#000000') >= contrast(next.paper, '#ffffff') ? '#000000' : '#ffffff';
  for (const key of ['ink', 'accent'] as const) {
    for (let step = 0; step <= 25 && colorProblems(next, mode).some(p => p.path === `${mode}.${key}`); step++) next[key] = mix(c[key], toward, step * 0.04);
  }
  return next;
}
/** A readable dark palette from a light one (paper and text swap roles; accent is lightened until it passes). */
export function deriveDark(light: BrandColors): BrandColors {
  const paper = mix(light.ink, '#000000', 0.55), ink = mix(light.paper, '#ffffff', 0.4);
  return adjustColors({paper, ink, accent: mix(light.accent, '#ffffff', 0.35)}, 'dark');
}

/** Closed shape check for the specification. Throws via `fail(code, path)` with fixed codes. */
export function validateBrand(input: unknown, fail: (code: string, path: string) => never): asserts input is Brand {
  type Rec = Record<string, unknown>;
  const rec = (v: unknown, keys: readonly string[], path: string): Rec => {
    if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length !== keys.length || !keys.every(k => Object.hasOwn(v, k))) return fail('INVALID_SHAPE', path);
    return v as Rec;
  };
  const palette = (v: unknown, path: string) => {
    const p = rec(v, ['ink', 'paper', 'accent'], path);
    for (const k of ['ink', 'paper', 'accent']) if (!isHex(p[k])) fail('INVALID_COLOR', `${path}.${k}`);
  };
  const b = rec(input, brandKeys, 'design.brand');
  if (b.source !== null) {
    const s = rec(b.source, ['kitId', 'version'], 'design.brand.source');
    if (typeof s.kitId !== 'string' || !uuid.test(s.kitId) || !Number.isSafeInteger(s.version) || (s.version as number) < 1) fail('INVALID_SHAPE', 'design.brand.source');
  }
  palette(b.light, 'design.brand.light');
  if (b.dark !== null) palette(b.dark, 'design.brand.dark');
  if (typeof b.font !== 'string' || !Object.hasOwn(brandFonts, b.font)) fail('INCOMPATIBLE', 'design.brand.font');
  if (typeof b.radius !== 'string' || !Object.hasOwn(brandRadii, b.radius)) fail('INCOMPATIBLE', 'design.brand.radius');
  if (typeof b.density !== 'string' || !Object.hasOwn(brandDensities, b.density)) fail('INCOMPATIBLE', 'design.brand.density');
  if (b.logo !== null) {
    const l = rec(b.logo, ['id', 'alt'], 'design.brand.logo');
    if (typeof l.id !== 'string' || !uuid.test(l.id) || typeof l.alt !== 'string' || !l.alt.trim() || l.alt.length > 100 || /[\u0000-\u001f\u007f]/.test(l.alt)) fail('INVALID_TEXT', 'design.brand.logo');
  }
  const low = brandProblems(b as unknown as Brand);
  if (low.length) fail('LOW_CONTRAST', 'design.brand.' + low[0].path);
}

/** Human-readable one-line summary for review comparisons. */
export function describeBrand(b: Brand | null): string | null {
  if (!b) return null;
  const c = (p: BrandColors) => `text ${p.ink}, background ${p.paper}, accent ${p.accent}`;
  return [`Light: ${c(b.light)}`, b.dark ? `Dark: ${c(b.dark)}` : 'Dark: not set (the site stays light)', `Type: ${brandFonts[b.font].label}`, `Corners: ${brandRadii[b.radius].label}`, `Spacing: ${brandDensities[b.density].label}`, b.logo ? `Logo: image ${b.logo.id.slice(0, 8)}, described as “${b.logo.alt}”` : 'Logo: none', b.source ? `From brand kit version ${b.source.version}` : 'Not linked to a saved kit'].join('\n');
}
