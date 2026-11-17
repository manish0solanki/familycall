import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

/**
 * Landmark indices of the face parts (MediaPipe face mesh), taken from
 * FaceLandmarker's connection lists so they always match the model.
 */
export interface FaceParts {
  oval: number[];
  keepSharp: Array<{ points: number[]; grow: number }>;
}

type Connection = { start: number; end: number };
const ids = (c: Connection[]) => [...new Set(c.flatMap((e) => [e.start, e.end]))];

export function faceParts(F: {
  FACE_LANDMARKS_FACE_OVAL: Connection[];
  FACE_LANDMARKS_LEFT_EYE: Connection[];
  FACE_LANDMARKS_RIGHT_EYE: Connection[];
  FACE_LANDMARKS_LEFT_EYEBROW: Connection[];
  FACE_LANDMARKS_RIGHT_EYEBROW: Connection[];
  FACE_LANDMARKS_LIPS: Connection[];
}): FaceParts {
  return {
    oval: ids(F.FACE_LANDMARKS_FACE_OVAL),
    // `grow` widens each part (as a fraction of face width) so lashes and lip edges stay sharp too.
    keepSharp: [
      { points: ids(F.FACE_LANDMARKS_LEFT_EYE), grow: 0.07 },
      { points: ids(F.FACE_LANDMARKS_RIGHT_EYE), grow: 0.07 },
      { points: ids(F.FACE_LANDMARKS_LEFT_EYEBROW), grow: 0.05 },
      { points: ids(F.FACE_LANDMARKS_RIGHT_EYEBROW), grow: 0.05 },
      { points: ids(F.FACE_LANDMARKS_LIPS), grow: 0.035 },
      // Nose tip and nostrils (face mesh points) keep the nose's shape.
      { points: [1, 2, 4, 19, 48, 64, 94, 97, 98, 278, 294, 326, 327], grow: 0.03 },
    ],
  };
}

type P = { x: number; y: number };

/** Convex hull (monotone chain): the outline around a set of points. */
function hull(points: P[]): P[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o: P, a: P, b: P) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: P[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: P[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function path(ctx: CanvasRenderingContext2D, pts: P[]) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
}

/**
 * Paints white where there is skin (face outline minus eyes, eyebrows and lips) on a
 * transparent canvas. Returns the widest face width in pixels (0 if no face).
 */
export function drawSkinMask(
  ctx: CanvasRenderingContext2D,
  faces: NormalizedLandmark[][],
  parts: FaceParts,
  width: number,
  height: number,
): number {
  ctx.clearRect(0, 0, width, height);
  let widest = 0;
  for (const face of faces) {
    const at = (i: number): P => ({ x: face[i].x * width, y: face[i].y * height });
    const oval = hull(parts.oval.map(at));
    const xs = oval.map((p) => p.x);
    const faceWidth = Math.max(...xs) - Math.min(...xs);
    widest = Math.max(widest, faceWidth);

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#fff';
    path(ctx, oval);
    ctx.fill();

    // Cut out the parts that should stay sharp.
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineJoin = 'round';
    for (const part of parts.keepSharp) {
      path(ctx, hull(part.points.map(at)));
      ctx.fill();
      ctx.lineWidth = faceWidth * part.grow;
      ctx.stroke();
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  return widest;
}
