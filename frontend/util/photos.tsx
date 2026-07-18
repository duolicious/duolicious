import { IMAGES_URL } from '../env/env';

// The extensions in `extra_exts` which this client knows how to render. The
// server may start reporting extensions which older clients don't support
// (e.g. videos). When none of a photo's `extra_exts` are supported, clients
// must fall back to the still-image renditions, which exist for every upload.
const SUPPORTED_EXTRA_EXTS = ['gif'];

const supportedExtraExt = (
  extraExts: string[] | undefined | null
): string | null => {
  const supported = (extraExts ?? [])
    .map((ext) => ext.toLowerCase())
    .filter((ext) => SUPPORTED_EXTRA_EXTS.includes(ext));

  return supported[0] ?? null;
};

const hasGifExtraExt = (
  extraExts: string[] | undefined | null
): boolean =>
  supportedExtraExt(extraExts) === 'gif';

const photoUri = (
  photoUuid: string | undefined | null,
  resolution: number | string,
  extraExts?: string[] | undefined | null,
): string | null => {
  if (!photoUuid) {
    return null;
  }

  const ext = supportedExtraExt(extraExts);

  return ext
    ? `${IMAGES_URL}/${photoUuid}.${ext}`
    : `${IMAGES_URL}/${resolution}-${photoUuid}.jpg`;
};

// How `900-{uuid}.jpg` was cut out of `original-{uuid}.jpg`, as reported by the
// API. In the original's pixels, after EXIF rotation. Null for photos the
// server hasn't recorded a geometry for.
type PhotoGeometry = {
  width: number
  height: number
  crop_top: number
  crop_left: number
};

type Rect = {
  x: number
  y: number
  width: number
  height: number
};

// One frame of the expand animation. `clip` is a window onto the photo;
// `image` is the whole original, positioned relative to `clip`'s top-left. At
// t=0 `clip` is the on-screen preview; at t=1 it contains the whole image,
// fitted to the viewport. `crop` is where the square rendition - cached, so it
// paints while the original decodes - lines up within `clip`.
type PhotoExpandFrame = {
  clip: Rect
  image: Rect
  crop: Rect
};

// Workletised so the gallery can lerp the same frames on the UI thread.
const lerp = (a: number, b: number, t: number): number => {
  'worklet';
  return a + (b - a) * t;
};

const lerpRect = (a: Rect, b: Rect, t: number): Rect => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
  width: lerp(a.width, b.width, t),
  height: lerp(a.height, b.height, t),
});

const photoExpandFrame = (
  geometry: PhotoGeometry,
  // The preview's square on screen. Square because the server only ever cuts
  // square renditions.
  from: Rect,
  viewport: { width: number, height: number },
  t: number,
): PhotoExpandFrame => {
  const { width, height, crop_top, crop_left } = geometry;

  const minDim = Math.min(width, height);

  // Scale that makes the crop exactly fill the preview square...
  const fromScale = from.width / minDim;

  // ...and the one that fits the whole original within the viewport, but never
  // enlarging it past its native resolution - a photo smaller than the screen
  // shows at native size, matching how the zoomable viewer (Pinchy) fits it.
  const toScale = Math.min(1, viewport.width / width, viewport.height / height);

  const fromImage: Rect = {
    x: -crop_left * fromScale,
    y: -crop_top * fromScale,
    width: width * fromScale,
    height: height * fromScale,
  };

  const toImage: Rect = {
    x: 0,
    y: 0,
    width: width * toScale,
    height: height * toScale,
  };

  const to: Rect = {
    x: (viewport.width - toImage.width) / 2,
    y: (viewport.height - toImage.height) / 2,
    width: toImage.width,
    height: toImage.height,
  };

  const cropWithin = (image: Rect, scale: number): Rect => ({
    x: image.x + crop_left * scale,
    y: image.y + crop_top * scale,
    width: minDim * scale,
    height: minDim * scale,
  });

  return {
    clip: lerpRect(from, to, t),
    image: lerpRect(fromImage, toImage, t),
    crop: lerpRect(
      cropWithin(fromImage, fromScale),
      cropWithin(toImage, toScale),
      t,
    ),
  };
};

export {
  hasGifExtraExt,
  lerp,
  photoExpandFrame,
  photoUri,
  supportedExtraExt,
};

export type {
  PhotoExpandFrame,
  PhotoGeometry,
  Rect,
};
