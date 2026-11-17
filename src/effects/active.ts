import type { LocalMedia } from '../lib/useLocalMedia';
import { needsProcessing } from './settings';

/** Whether any effect is switched on (the Effects button is highlighted). */
export function effectsActive(media: Pick<LocalMedia, 'effects'>): boolean {
  return needsProcessing(media.effects);
}
