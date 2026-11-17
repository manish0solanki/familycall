import { lazy, Suspense } from 'react';
import type { LocalMedia } from '../lib/useLocalMedia';

const Sheet = lazy(() => import('./EffectsSheet').then((m) => ({ default: m.EffectsSheet })));

/** The effects picker, downloaded the first time someone opens it. */
export function EffectsSheet(props: { media: LocalMedia; onClose: () => void }) {
  return (
    <Suspense fallback={<div className="sheet-backdrop" aria-busy="true" />}>
      <Sheet {...props} />
    </Suspense>
  );
}
