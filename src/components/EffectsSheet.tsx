import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import {
  BEAUTY_LEVELS,
  FILTERS,
  SCENES,
  needsSegmentation,
  sameBackground,
  sceneUrl,
  type BackgroundSetting,
  type FilterId,
} from '../effects/settings';
import type { LocalMedia } from '../lib/useLocalMedia';
import { Icon } from './Icon';
import { VideoView } from './VideoView';

type Tab = 'background' | 'beauty' | 'filters';

const canvasFilters = typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype;

/** Bottom sheet for picking background, beautify level and colour filter, with a live preview. */
export function EffectsSheet({ media, onClose }: { media: LocalMedia; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('background');
  const fileRef = useRef<HTMLInputElement>(null);
  const { effects, setEffects, effectsStatus } = media;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const setBackground = (background: BackgroundSetting) => setEffects({ ...effects, background });
  const isBackground = (b: BackgroundSetting) => sameBackground(effects.background, b);

  const onPhoto = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (effects.background.type === 'custom') URL.revokeObjectURL(effects.background.url);
    setBackground({ type: 'custom', url: URL.createObjectURL(file) });
  };

  const backgroundNote =
    needsSegmentation(effects) && effectsStatus === 'loading'
      ? 'Loading background effects… this takes a few seconds the first time.'
      : needsSegmentation(effects) && effectsStatus === 'error'
        ? 'Background effects aren’t supported on this device or browser.'
        : null;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section className="sheet" role="dialog" aria-modal="true" aria-label="Effects" onClick={(e) => e.stopPropagation()}>
        <header className="sheet__header">
          <h2>Effects</h2>
          <button type="button" className="sheet__close" onClick={onClose} aria-label="Close effects">
            <Icon name="close" />
          </button>
        </header>

        <div className="sheet__preview">
          <VideoView stream={media.previewStream} muted mirrored={media.facing === 'user'} className="sheet__video" label="Preview of your camera with effects" />
          {backgroundNote && <p className="sheet__note" role="status">{backgroundNote}</p>}
        </div>

        <div className="tabs" role="tablist" aria-label="Effect type">
          {(['background', 'beauty', 'filters'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              className={`tabs__tab${tab === t ? ' is-active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t === 'background' ? 'Background' : t === 'beauty' ? 'Beautify' : 'Filters'}
            </button>
          ))}
        </div>

        <div className="sheet__body" role="tabpanel">
          {tab === 'background' && (
            <div className="tiles">
              <Tile label="None" selected={isBackground({ type: 'none' })} onClick={() => setBackground({ type: 'none' })}>
                <span className="tile__icon"><Icon name="ban" /></span>
              </Tile>
              <Tile label="Slight blur" selected={isBackground({ type: 'blur', strength: 'light' })} onClick={() => setBackground({ type: 'blur', strength: 'light' })}>
                <span className="tile__icon tile__icon--blur-light"><Icon name="blur" /></span>
              </Tile>
              <Tile label="Blur" selected={isBackground({ type: 'blur', strength: 'strong' })} onClick={() => setBackground({ type: 'blur', strength: 'strong' })}>
                <span className="tile__icon tile__icon--blur"><Icon name="blur" /></span>
              </Tile>
              {SCENES.map((scene) => (
                <Tile
                  key={scene.id}
                  label={scene.name}
                  selected={isBackground({ type: 'scene', id: scene.id })}
                  onClick={() => setBackground({ type: 'scene', id: scene.id })}
                >
                  <img src={sceneUrl(scene.id)} alt="" className="tile__img" />
                </Tile>
              ))}
              <Tile
                label="Your photo"
                selected={effects.background.type === 'custom'}
                onClick={() => fileRef.current?.click()}
              >
                {effects.background.type === 'custom' ? (
                  <img src={effects.background.url} alt="" className="tile__img" />
                ) : (
                  <span className="tile__icon"><Icon name="image" /></span>
                )}
              </Tile>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPhoto} data-testid="background-file" />
            </div>
          )}

          {tab === 'beauty' && (
            <div className="beauty">
              <p className="muted">Tracks your face to smooth and brighten skin, while keeping eyes, eyebrows and lips sharp.</p>
              <div className="segmented" role="radiogroup" aria-label="Beautify level">
                {BEAUTY_LEVELS.map(({ level, name }) => (
                  <button
                    key={level}
                    type="button"
                    role="radio"
                    aria-checked={effects.beauty === level}
                    className={`segmented__option${effects.beauty === level ? ' is-active' : ''}`}
                    onClick={() => setEffects({ ...effects, beauty: level })}
                  >
                    {name}
                  </button>
                ))}
              </div>
              {!canvasFilters && <p className="sheet__warn">Beautify needs a newer browser version.</p>}
            </div>
          )}

          {tab === 'filters' && (
            <div className="tiles">
              {(Object.keys(FILTERS) as FilterId[]).map((id) => (
                <Tile key={id} label={FILTERS[id].name} selected={effects.filter === id} onClick={() => setEffects({ ...effects, filter: id })}>
                  <img src={sceneUrl('garden')} alt="" className="tile__img" style={{ filter: FILTERS[id].css }} />
                </Tile>
              ))}
              {!canvasFilters && <p className="sheet__warn">Filters need a newer browser version.</p>}
            </div>
          )}
        </div>

        <footer className="sheet__footer">
          <button type="button" className="btn btn--secondary" onClick={() => setEffects({ ...effects, background: { type: 'none' }, beauty: 0, filter: 'none' })}>
            Reset all
          </button>
          <button type="button" className="btn btn--primary" onClick={onClose}>Done</button>
        </footer>
      </section>
    </div>
  );
}

function Tile({ label, selected, onClick, children }: { label: string; selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={`tile${selected ? ' is-selected' : ''}`} aria-pressed={selected} onClick={onClick}>
      <span className="tile__thumb">{children}</span>
      <span className="tile__label">{label}</span>
    </button>
  );
}
