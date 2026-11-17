import type { FaceLandmarker, ImageSegmenter } from '@mediapipe/tasks-vision';
import { faceParts, type FaceParts } from './faceMask';

export interface FaceTracker {
  landmarker: FaceLandmarker;
  parts: FaceParts;
}

/**
 * Google MediaPipe "selfie segmenter": finds the person in each camera frame so the
 * background can be blurred or replaced. Runs entirely on the device.
 * The library (~3 MB compressed) is only downloaded the first time someone turns on
 * a background effect.
 */
let loading: Promise<ImageSegmenter> | null = null;

export function loadSegmenter(): Promise<ImageSegmenter> {
  if (!loading) {
    loading = create().catch((err) => {
      loading = null; // allow a retry later
      throw err;
    });
  }
  return loading;
}

async function create(): Promise<ImageSegmenter> {
  const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks('/mediapipe');
  const options = (delegate: 'GPU' | 'CPU') => ({
    baseOptions: { modelAssetPath: '/models/selfie_segmenter.tflite', delegate },
    runningMode: 'VIDEO' as const,
    outputConfidenceMasks: true,
    outputCategoryMask: false,
  });
  try {
    return await ImageSegmenter.createFromOptions(fileset, options('GPU'));
  } catch (err) {
    console.warn('[effects] GPU segmenter unavailable, using CPU', err);
    return ImageSegmenter.createFromOptions(fileset, options('CPU'));
  }
}

/**
 * MediaPipe face landmarker (478 points per face), used by Beautify to smooth only
 * skin and keep eyes, eyebrows and lips sharp. Downloaded the first time Beautify is on.
 */
let loadingFaces: Promise<FaceTracker> | null = null;

export function loadFaceLandmarker(): Promise<FaceTracker> {
  if (!loadingFaces) {
    loadingFaces = createFaceLandmarker().catch((err) => {
      loadingFaces = null;
      throw err;
    });
  }
  return loadingFaces;
}

async function createFaceLandmarker(): Promise<FaceTracker> {
  const { FilesetResolver, FaceLandmarker } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks('/mediapipe');
  const options = (delegate: 'GPU' | 'CPU') => ({
    baseOptions: { modelAssetPath: '/models/face_landmarker.task', delegate },
    runningMode: 'VIDEO' as const,
    numFaces: 2,
    outputFaceBlendshapes: false,
  });
  const parts = faceParts(FaceLandmarker);
  try {
    return { landmarker: await FaceLandmarker.createFromOptions(fileset, options('GPU')), parts };
  } catch (err) {
    console.warn('[effects] GPU face tracking unavailable, using CPU', err);
    return { landmarker: await FaceLandmarker.createFromOptions(fileset, options('CPU')), parts };
  }
}
