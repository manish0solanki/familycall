import type { LocalMedia } from '../lib/useLocalMedia';
import { Icon } from './Icon';

/** Switches my camera between a normal and a wide-angle view (more of the room). */
export function ShapeButton({ media, className = 'call__fit-btn' }: { media: LocalMedia; className?: string }) {
  const wide = media.view === 'wide';
  return (
    <button
      type="button"
      className={className}
      onClick={() => void media.setView(wide ? 'normal' : 'wide')}
      aria-pressed={wide}
      aria-label={wide ? 'Camera view: wide angle. Tap for normal view.' : 'Camera view: normal. Tap for wide angle (fits more of the room).'}
      data-testid="view-button"
    >
      <Icon name={wide ? 'shapeWide' : 'shapeAuto'} size={18} />
      {wide ? 'Wide angle' : 'Normal view'}
    </button>
  );
}
