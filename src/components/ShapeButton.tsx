import type { VideoShape } from '../effects/settings';
import type { LocalMedia } from '../lib/useLocalMedia';
import { Icon } from './Icon';

const NEXT: Record<VideoShape, VideoShape> = { auto: 'tall', tall: 'wide', wide: 'auto' };
const LABEL: Record<VideoShape, string> = { auto: 'Auto', tall: 'Tall', wide: 'Wide' };
const HELP: Record<VideoShape, string> = {
  auto: 'Sends your camera’s full picture; its shape follows how you hold your device',
  tall: 'Sends a tall (portrait) picture, cut from your camera’s picture',
  wide: 'Sends a wide (landscape) picture, cut from your camera’s picture',
};

/** Cycles the shape of the video I send: Auto → Tall → Wide. */
export function ShapeButton({ media, className = 'call__fit-btn' }: { media: LocalMedia; className?: string }) {
  const shape = media.effects.shape;
  return (
    <button
      type="button"
      className={className}
      onClick={() => media.setEffects({ ...media.effects, shape: NEXT[shape] })}
      title={HELP[shape]}
      aria-label={`My video shape: ${LABEL[shape]}. ${HELP[shape]}. Tap to change.`}
      data-testid="shape-button"
    >
      <Icon name={shape === 'wide' ? 'shapeWide' : shape === 'tall' ? 'shapeTall' : 'shapeAuto'} size={18} />
      My video: {LABEL[shape]}
    </button>
  );
}
