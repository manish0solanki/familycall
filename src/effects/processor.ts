import type { ImageSegmenter } from '@mediapipe/tasks-vision';
import { loadSegmenter } from './segmenter';
import { FILTERS, needsSegmentation, sceneUrl, type EffectSettings } from './settings';

export type EffectsStatus = 'ready' | 'loading' | 'error';

/** Output is capped at this width: plenty for a call, and keeps phones cool. */
const MAX_WIDTH = 960;
const FPS = 30;
/** Even on very slow devices, update the person outline at least 4 times a second. */
const MAX_SEGMENT_INTERVAL_MS = 250;
const DEBUG = typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug');

const BEAUTY = {
  1: { radius: 3, alpha: 0.28, brightness: 1.03 },
  2: { radius: 4, alpha: 0.4, brightness: 1.05 },
  3: { radius: 5, alpha: 0.52, brightness: 1.07 },
} as const;

/** MediaPipe's VIDEO mode needs strictly increasing timestamps, even across processors. */
let lastTimestamp = 0;
function nextTimestamp(): number {
  lastTimestamp = Math.max(performance.now(), lastTimestamp + 1);
  return lastTimestamp;
}

function makeCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 2;
  return [canvas, canvas.getContext('2d')!];
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Turns a raw camera track into a processed one: background blur or replacement,
 * soft-skin "beautify" and colour filters, drawn onto a canvas each frame.
 * `track` is what gets sent in the call; `setSource` swaps cameras without changing it.
 */
export class EffectsProcessor {
  readonly track: MediaStreamTrack;

  private settings: EffectSettings;
  private readonly onStatus: (status: EffectsStatus) => void;
  private readonly video = document.createElement('video');
  private readonly out = makeCanvas();
  private readonly person = makeCanvas();
  private readonly blurLayer = makeCanvas();
  private readonly softLayer = makeCanvas();
  private readonly mask = makeCanvas();
  private readonly background = makeCanvas();
  private maskPixels: ImageData | null = null;
  private previousMask: Float32Array | null = null;
  private backgroundImage: HTMLImageElement | null = null;
  private backgroundKey = '';
  private backgroundDrawn = false;
  private segmenter: ImageSegmenter | null = null;
  private segmenterFailed = false;
  private readonly canFilter = 'filter' in CanvasRenderingContext2D.prototype;
  private running = true;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private rafId = 0;
  private lastFrame = 0;
  /** Average time the segmenter takes on this device (ms), and when it last ran. */
  private segmentCost = 0;
  private lastSegment = 0;
  private stats = { frames: 0, segment: 0, draw: 0, since: performance.now() };

  constructor(source: MediaStreamTrack, settings: EffectSettings, onStatus: (status: EffectsStatus) => void) {
    this.settings = settings;
    this.onStatus = onStatus;

    this.video.muted = true;
    this.video.playsInline = true;
    this.video.autoplay = true;
    this.setSource(source);

    const { width = 640, height = 480 } = source.getSettings();
    this.resize(width, height);
    this.track = this.out[0].captureStream(FPS).getVideoTracks()[0];

    this.setSettings(settings);
    this.schedule();
  }

  setSource(track: MediaStreamTrack) {
    this.video.srcObject = new MediaStream([track]);
    this.video.play().catch(() => {/* resumes on the next user tap */});
  }

  setSettings(settings: EffectSettings) {
    this.settings = settings;
    this.loadBackgroundImage();
    if (!needsSegmentation(settings)) {
      this.onStatus('ready');
    } else if (this.segmenter) {
      this.onStatus('ready');
    } else if (this.segmenterFailed) {
      this.onStatus('error');
    } else {
      this.onStatus('loading');
      loadSegmenter().then(
        (segmenter) => {
          this.segmenter = segmenter;
          if (this.running) this.onStatus('ready');
        },
        (err) => {
          console.error('[effects] could not load background effects', err);
          this.segmenterFailed = true;
          if (this.running) this.onStatus('error');
        },
      );
    }
  }

  dispose() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    cancelAnimationFrame(this.rafId);
    this.track.stop();
    this.video.srcObject = null;
  }

  // ---------------------------------------------------------------------------

  /** rAF while visible; timers when the tab is hidden so the other person's video doesn't freeze. */
  private schedule() {
    if (!this.running) return;
    const tick = () => {
      this.timer = null;
      if (!this.running) return;
      const now = performance.now();
      if (now - this.lastFrame >= 1000 / FPS - 4) {
        this.lastFrame = now;
        try {
          this.render();
        } catch (err) {
          console.error('[effects] frame failed', err);
        }
      }
      this.schedule();
    };
    if (document.hidden) this.timer = setTimeout(tick, 1000 / FPS);
    else this.rafId = requestAnimationFrame(tick);
  }

  private resize(videoWidth: number, videoHeight: number) {
    const scale = Math.min(1, MAX_WIDTH / videoWidth);
    const width = Math.round((videoWidth * scale) / 2) * 2;
    const height = Math.round((videoHeight * scale) / 2) * 2;
    const [out] = this.out;
    if (out.width === width && out.height === height) return;
    for (const [canvas] of [this.out, this.person, this.background]) {
      canvas.width = width;
      canvas.height = height;
    }
    this.backgroundDrawn = false;
  }

  private render() {
    const video = this.video;
    if (video.readyState < 2 || !video.videoWidth) return;
    this.resize(video.videoWidth, video.videoHeight);

    const [out, ctx] = this.out;
    const W = out.width;
    const H = out.height;
    const settings = this.settings;
    const filter = this.canFilter ? FILTERS[settings.filter].css : 'none';
    const wantsBackground = needsSegmentation(settings);
    const t0 = performance.now();
    let haveMask = false;
    if (wantsBackground && this.segmenter) {
      // Finding the person is the expensive step. On slow devices, do it less often and
      // reuse the last outline in between, so the video itself stays smooth.
      const due = t0 - this.lastSegment >= Math.min(MAX_SEGMENT_INTERVAL_MS, this.segmentCost * 1.5);
      if (due || !this.maskPixels) {
        haveMask = this.updateMask();
        const cost = performance.now() - t0;
        this.segmentCost = this.segmentCost ? this.segmentCost * 0.8 + cost * 0.2 : cost;
        this.lastSegment = performance.now();
      } else {
        haveMask = true;
      }
    }
    const t1 = performance.now();

    if (haveMask) {
      this.drawBackground(ctx, W, H, filter);
      const [personCanvas, p] = this.person;
      p.clearRect(0, 0, W, H);
      this.drawCamera(p, W, H);
      // Keep only the person: multiply by the mask's alpha.
      p.globalCompositeOperation = 'destination-in';
      if (this.canFilter) p.filter = 'blur(1.5px)'; // soften the cut-out edge
      p.drawImage(this.mask[0], 0, 0, W, H);
      p.filter = 'none';
      p.globalCompositeOperation = 'source-over';
      ctx.filter = filter;
      ctx.drawImage(personCanvas, 0, 0);
      ctx.filter = 'none';
    } else if (wantsBackground && !this.segmenterFailed) {
      // Model still loading: blur the whole picture rather than briefly showing the room.
      this.drawBlurred(ctx, video, W, H, 'strong', filter);
    } else {
      const [personCanvas, p] = this.person;
      if (filter === 'none') {
        this.drawCamera(ctx, W, H);
      } else {
        this.drawCamera(p, W, H);
        ctx.filter = filter;
        ctx.drawImage(personCanvas, 0, 0);
        ctx.filter = 'none';
      }
    }
    if (DEBUG) this.logStats(t1 - t0, performance.now() - t1);
  }

  /** With ?debug, logs the average cost of each step every 5 s. */
  private logStats(segmentMs: number, drawMs: number) {
    const st = this.stats;
    st.frames++;
    st.segment += segmentMs;
    st.draw += drawMs;
    const elapsed = performance.now() - st.since;
    if (elapsed < 5000) return;
    console.info(
      `[effects] ${(st.frames / (elapsed / 1000)).toFixed(1)} fps, segment ${(st.segment / st.frames).toFixed(1)} ms, draw ${(st.draw / st.frames).toFixed(1)} ms per frame`,
    );
    this.stats = { frames: 0, segment: 0, draw: 0, since: performance.now() };
  }

  /** Camera frame with optional soft-skin "beautify". */
  private drawCamera(target: CanvasRenderingContext2D, W: number, H: number) {
    const level = this.settings.beauty;
    if (!level || !this.canFilter) {
      target.drawImage(this.video, 0, 0, W, H);
      return;
    }
    const cfg = BEAUTY[level];
    target.filter = `brightness(${cfg.brightness}) saturate(1.04)`;
    target.drawImage(this.video, 0, 0, W, H);

    // A blurred copy, laid over at partial opacity, smooths skin like a soft-focus lens.
    // Blurring at half resolution keeps it cheap.
    const [soft, s] = this.softLayer;
    const sw = Math.max(2, Math.round(W / 2));
    const sh = Math.max(2, Math.round(H / 2));
    if (soft.width !== sw || soft.height !== sh) {
      soft.width = sw;
      soft.height = sh;
    }
    s.filter = `blur(${((cfg.radius * sw) / 480).toFixed(2)}px) brightness(${cfg.brightness})`;
    s.drawImage(this.video, 0, 0, sw, sh);
    s.filter = 'none';

    target.filter = 'none';
    target.globalAlpha = cfg.alpha;
    target.drawImage(soft, 0, 0, W, H);
    target.globalAlpha = 1;
  }

  private drawBackground(ctx: CanvasRenderingContext2D, W: number, H: number, filter: string) {
    const bg = this.settings.background;
    if (bg.type === 'blur') {
      this.drawBlurred(ctx, this.video, W, H, bg.strength, filter);
      return;
    }
    const [bgCanvas, b] = this.background;
    if (this.backgroundImage && !this.backgroundDrawn) {
      // Scale the picture to cover the frame, centred (like CSS object-fit: cover).
      const img = this.backgroundImage;
      const scale = Math.max(W / img.naturalWidth, H / img.naturalHeight);
      const dw = img.naturalWidth * scale;
      const dh = img.naturalHeight * scale;
      b.clearRect(0, 0, W, H);
      b.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
      this.backgroundDrawn = true;
    }
    if (this.backgroundDrawn) {
      ctx.filter = filter;
      ctx.drawImage(bgCanvas, 0, 0);
      ctx.filter = 'none';
    } else {
      // Picture still loading.
      this.drawBlurred(ctx, this.video, W, H, 'strong', filter);
    }
  }

  /** Blur by shrinking, blurring a little, and scaling back up: a big blur for little work. */
  private drawBlurred(
    ctx: CanvasRenderingContext2D,
    source: CanvasImageSource,
    W: number,
    H: number,
    strength: 'light' | 'strong',
    filter: string,
  ) {
    const factor = strength === 'light' ? 6 : 10;
    const radius = strength === 'light' ? 1.5 : 2.5;
    const [blur, b] = this.blurLayer;
    const bw = Math.max(2, Math.round(W / factor));
    const bh = Math.max(2, Math.round(H / factor));
    if (blur.width !== bw || blur.height !== bh) {
      blur.width = bw;
      blur.height = bh;
    }
    const margin = radius * 3; // overscan so the blur doesn't fade at the edges
    if (this.canFilter) b.filter = `blur(${radius}px)`;
    b.drawImage(source, -margin, -margin, bw + margin * 2, bh + margin * 2);
    b.filter = 'none';
    ctx.filter = filter;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(blur, 0, 0, W, H);
    ctx.filter = 'none';
  }

  /** Runs the segmenter on the current frame and turns its output into an alpha mask. */
  private updateMask(): boolean {
    const result = this.segmenter!.segmentForVideo(this.video, nextTimestamp());
    try {
      const mask = result.confidenceMasks?.[0];
      if (!mask) return false;
      const { width: w, height: h } = mask;
      const confidence = mask.getAsFloat32Array();

      const [maskCanvas, m] = this.mask;
      if (!this.maskPixels || this.maskPixels.width !== w || this.maskPixels.height !== h) {
        maskCanvas.width = w;
        maskCanvas.height = h;
        this.maskPixels = new ImageData(w, h);
        this.maskPixels.data.fill(255);
        this.previousMask = null;
      }
      const pixels = this.maskPixels.data;
      const prev = this.previousMask ?? new Float32Array(confidence);
      for (let i = 0; i < confidence.length; i++) {
        // Blend with the last frame to stop the edge flickering.
        const c = prev[i] * 0.35 + confidence[i] * 0.65;
        prev[i] = c;
        pixels[i * 4 + 3] = smoothstep(0.3, 0.7, c) * 255;
      }
      this.previousMask = prev;
      m.putImageData(this.maskPixels, 0, 0);
      return true;
    } finally {
      result.close();
    }
  }

  private loadBackgroundImage() {
    const bg = this.settings.background;
    const key = bg.type === 'scene' ? sceneUrl(bg.id) : bg.type === 'custom' ? bg.url : '';
    if (key === this.backgroundKey) return;
    this.backgroundKey = key;
    this.backgroundImage = null;
    this.backgroundDrawn = false;
    if (!key) return;
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (this.backgroundKey === key) {
        this.backgroundImage = img;
        this.backgroundDrawn = false;
      }
    };
    img.src = key;
  }
}
