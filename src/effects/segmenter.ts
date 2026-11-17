import type { ImageSegmenter } from '@mediapipe/tasks-vision';

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
