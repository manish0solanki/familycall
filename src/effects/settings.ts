export type BackgroundSetting =
  | { type: 'none' }
  | { type: 'blur'; strength: 'light' | 'strong' }
  | { type: 'scene'; id: string }
  | { type: 'custom'; url: string };

export type BeautyLevel = 0 | 1 | 2 | 3;

export type FilterId = 'none' | 'warm' | 'cool' | 'vivid' | 'bw' | 'vintage' | 'soft';

/**
 * The shape of the video I send. 'auto' sends the camera's full picture (its shape follows
 * how the device is held). 'tall' / 'wide' cut that picture to the chosen shape.
 */
export type VideoShape = 'auto' | 'tall' | 'wide';

export interface EffectSettings {
  background: BackgroundSetting;
  beauty: BeautyLevel;
  filter: FilterId;
  shape: VideoShape;
}

export const DEFAULT_EFFECTS: EffectSettings = { background: { type: 'none' }, beauty: 0, filter: 'none', shape: 'auto' };

export const SCENES = [
  { id: 'beach', name: 'Beach sunset' },
  { id: 'mountains', name: 'Mountains' },
  { id: 'living-room', name: 'Living room' },
  { id: 'garden', name: 'Garden' },
  { id: 'festive', name: 'Festive lights' },
  { id: 'night-sky', name: 'Night sky' },
] as const;

export function sceneUrl(id: string): string {
  return `/backgrounds/${id}.svg`;
}

/** Colour filters as CSS filter strings (applied with CanvasRenderingContext2D.filter). */
export const FILTERS: Record<FilterId, { name: string; css: string }> = {
  none: { name: 'None', css: 'none' },
  warm: { name: 'Warm', css: 'sepia(0.25) saturate(1.25) brightness(1.04)' },
  cool: { name: 'Cool', css: 'hue-rotate(-12deg) saturate(1.1) brightness(1.03) contrast(1.02)' },
  vivid: { name: 'Vivid', css: 'saturate(1.55) contrast(1.08)' },
  bw: { name: 'B&W', css: 'grayscale(1) contrast(1.1)' },
  vintage: { name: 'Vintage', css: 'sepia(0.55) contrast(0.92) brightness(1.05) saturate(0.85)' },
  soft: { name: 'Soft glow', css: 'brightness(1.08) contrast(0.92) saturate(1.05)' },
};

export const BEAUTY_LEVELS: Array<{ level: BeautyLevel; name: string }> = [
  { level: 0, name: 'Off' },
  { level: 1, name: 'Low' },
  { level: 2, name: 'Medium' },
  { level: 3, name: 'High' },
];

/** Whether the person needs to be cut out from the background. */
export function needsSegmentation(s: EffectSettings): boolean {
  return s.background.type !== 'none';
}

/** Whether the camera picture needs any processing at all (otherwise it's sent untouched). */
export function needsProcessing(s: EffectSettings): boolean {
  return needsSegmentation(s) || s.beauty > 0 || s.filter !== 'none' || s.shape !== 'auto';
}

export function sameBackground(a: BackgroundSetting, b: BackgroundSetting): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'blur' && b.type === 'blur') return a.strength === b.strength;
  if (a.type === 'scene' && b.type === 'scene') return a.id === b.id;
  if (a.type === 'custom' && b.type === 'custom') return a.url === b.url;
  return true;
}

const KEY = 'familycall:effects';

export function loadEffects(): EffectSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as EffectSettings | null;
    if (!saved) return DEFAULT_EFFECTS;
    // A custom photo is only kept for this visit (it's a temporary object URL).
    const background = saved.background?.type === 'custom' ? DEFAULT_EFFECTS.background : saved.background;
    return {
      background: background ?? DEFAULT_EFFECTS.background,
      beauty: ([0, 1, 2, 3] as const).includes(saved.beauty) ? saved.beauty : 0,
      filter: saved.filter in FILTERS ? saved.filter : 'none',
      shape: saved.shape === 'tall' || saved.shape === 'wide' ? saved.shape : 'auto',
    };
  } catch {
    return DEFAULT_EFFECTS;
  }
}

export function saveEffects(s: EffectSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Not remembering effects is fine.
  }
}
