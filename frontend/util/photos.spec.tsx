import {
  hasGifExtraExt,
  photoExpandFrame,
  photoUri,
  supportedExtraExt,
} from './photos';
import type { PhotoGeometry, Rect } from './photos';
import { IMAGES_URL } from '../env/env';

describe('supportedExtraExt', () => {
  it('returns gif when present', () => {
    expect(supportedExtraExt(['gif'])).toBe('gif');
    expect(supportedExtraExt(['GIF'])).toBe('gif');
  });

  it('returns null when there are no extra exts', () => {
    expect(supportedExtraExt([])).toBe(null);
    expect(supportedExtraExt(null)).toBe(null);
    expect(supportedExtraExt(undefined)).toBe(null);
  });

  it('ignores extensions the client does not support', () => {
    expect(supportedExtraExt(['mp4'])).toBe(null);
    expect(supportedExtraExt(['some-future-format'])).toBe(null);
  });

  it('finds a supported extension among unsupported ones', () => {
    expect(supportedExtraExt(['mp4', 'gif'])).toBe('gif');
  });
});

describe('hasGifExtraExt', () => {
  it('detects gifs', () => {
    expect(hasGifExtraExt(['gif'])).toBe(true);
    expect(hasGifExtraExt(['GIF'])).toBe(true);
  });

  it('rejects everything else', () => {
    expect(hasGifExtraExt([])).toBe(false);
    expect(hasGifExtraExt(null)).toBe(false);
    expect(hasGifExtraExt(undefined)).toBe(false);
    expect(hasGifExtraExt(['mp4'])).toBe(false);
  });
});

describe('photoUri', () => {
  const uuid = 'some-uuid';

  it('returns null without a uuid', () => {
    expect(photoUri(null, 450, ['gif'])).toBe(null);
    expect(photoUri(undefined, 450, ['gif'])).toBe(null);
  });

  it('uses the extra ext when supported', () => {
    expect(photoUri(uuid, 450, ['gif']))
      .toBe(`${IMAGES_URL}/${uuid}.gif`);
  });

  it('uses the resolution-prefixed jpg when there are no extra exts', () => {
    expect(photoUri(uuid, 450, []))
      .toBe(`${IMAGES_URL}/450-${uuid}.jpg`);
    expect(photoUri(uuid, 900))
      .toBe(`${IMAGES_URL}/900-${uuid}.jpg`);
  });

  it('falls back to the jpg still for unsupported extra exts', () => {
    expect(photoUri(uuid, 450, ['mp4']))
      .toBe(`${IMAGES_URL}/450-${uuid}.jpg`);
  });
});

describe('photoExpandFrame', () => {
  const viewport = { width: 400, height: 800 };

  // A landscape photo whose square crop the uploader dragged to the right.
  const offCentre: PhotoGeometry = {
    width: 1000,
    height: 500,
    crop_top: 0,
    crop_left: 400,
  };

  // The preview square, as measured on screen.
  const preview: Rect = { x: 20, y: 100, width: 200, height: 200 };

  // The part of the image the preview is showing, in screen coordinates.
  const cropOnScreen = (frame: ReturnType<typeof photoExpandFrame>, g: PhotoGeometry) => {
    const scale = frame.image.width / g.width;
    return {
      x: frame.clip.x + frame.image.x + g.crop_left * scale,
      y: frame.clip.y + frame.image.y + g.crop_top * scale,
      size: Math.min(g.width, g.height) * scale,
    };
  };

  it('starts as the preview, so the first frame replaces it seamlessly', () => {
    const frame = photoExpandFrame(offCentre, preview, viewport, 0);

    // The window onto the photo is exactly the preview square...
    expect(frame.clip).toEqual(preview);

    // ...and the crop lands on it exactly, rather than merely nearby.
    const crop = cropOnScreen(frame, offCentre);
    expect(crop.x).toBeCloseTo(preview.x);
    expect(crop.y).toBeCloseTo(preview.y);
    expect(crop.size).toBeCloseTo(preview.width);
  });

  it('fills the first frame with the crop, which is the cached preview image', () => {
    // The original hasn't decoded on the first frame. If the square rendition
    // didn't cover the window exactly here, the photo would visibly blink out
    // at the moment of the press.
    const frame = photoExpandFrame(offCentre, preview, viewport, 0);

    expect(frame.crop.x).toBeCloseTo(0);
    expect(frame.crop.y).toBeCloseTo(0);
    expect(frame.crop.width).toBeCloseTo(frame.clip.width);
    expect(frame.crop.height).toBeCloseTo(frame.clip.height);
  });

  it('tracks the crop onto the right part of the photo as it opens', () => {
    // The crop is the right-hand 500px of a 1000x500 photo, so once open it
    // should sit over the right-hand half of the fitted image.
    const frame = photoExpandFrame(offCentre, preview, viewport, 1);

    expect(frame.image).toEqual({ x: 0, y: 0, width: 400, height: 200 });
    expect(frame.crop.x).toBeCloseTo(160); // 400/1000 * 400
    expect(frame.crop.width).toBeCloseTo(200);
    expect(frame.crop.height).toBeCloseTo(200);
  });

  it('keeps the crop glued to the same pixels throughout', () => {
    // Wherever the animation is, the square rendition must land exactly where
    // those same pixels are in the original, or the two would visibly disagree.
    for (const t of [0, 0.3, 0.7, 1]) {
      const frame = photoExpandFrame(offCentre, preview, viewport, t);
      const scale = frame.image.width / offCentre.width;

      expect(frame.crop.x).toBeCloseTo(frame.image.x + offCentre.crop_left * scale);
      expect(frame.crop.y).toBeCloseTo(frame.image.y + offCentre.crop_top * scale);
      expect(frame.crop.width).toBeCloseTo(500 * scale);
    }
  });

  it('ends with the whole photo fitted and centred in the viewport', () => {
    const frame = photoExpandFrame(offCentre, preview, viewport, 1);

    // 1000x500 into 400x800 is width-bound: 400x200, centred vertically.
    expect(frame.clip).toEqual({ x: 0, y: 300, width: 400, height: 200 });

    // The whole image fills the window: nothing is cropped away any more.
    expect(frame.image).toEqual({ x: 0, y: 0, width: 400, height: 200 });
  });

  it('never crops tighter than the preview while opening', () => {
    // The visible fraction of the photo should only ever grow, otherwise the
    // crop would appear to close before it opens.
    const visible = [0, 0.25, 0.5, 0.75, 1].map((t) => {
      const frame = photoExpandFrame(offCentre, preview, viewport, t);
      return frame.clip.width / frame.image.width;
    });

    for (let i = 1; i < visible.length; i++) {
      expect(visible[i]).toBeGreaterThan(visible[i - 1]);
    }
    expect(visible[0]).toBeCloseTo(0.5); // 500 of 1000px wide
    expect(visible[visible.length - 1]).toBeCloseTo(1);
  });

  it('keeps a centred crop centred, for photos the uploader never dragged', () => {
    const centred: PhotoGeometry = {
      width: 1000,
      height: 500,
      crop_top: 0,
      crop_left: 250,
    };

    const frame = photoExpandFrame(centred, preview, viewport, 0);
    const crop = cropOnScreen(frame, centred);

    expect(crop.x).toBeCloseTo(preview.x);
    expect(crop.size).toBeCloseTo(preview.width);
  });

  it('handles portrait photos, which fit by height', () => {
    const portrait: PhotoGeometry = {
      width: 500,
      height: 1000,
      crop_top: 100,
      crop_left: 0,
    };

    const frame = photoExpandFrame(portrait, preview, viewport, 1);

    // 500x1000 into 400x800 is height-bound: 400x800 exactly fills it.
    expect(frame.clip).toEqual({ x: 0, y: 0, width: 400, height: 800 });
  });

  it('shows a photo smaller than the viewport at native size, not enlarged', () => {
    // Both dimensions fit within 400x800, so it must not be scaled up - it
    // ends at its own resolution, centred, matching the zoomable viewer.
    const small: PhotoGeometry = {
      width: 200,
      height: 150,
      crop_top: 0,
      crop_left: 25,
    };

    const frame = photoExpandFrame(small, preview, viewport, 1);

    // Native size (`image` fills its clip), and the clip is centred on screen.
    expect(frame.image).toEqual({ x: 0, y: 0, width: 200, height: 150 });
    expect(frame.clip).toEqual({
      x: (viewport.width - 200) / 2,
      y: (viewport.height - 150) / 2,
      width: 200,
      height: 150,
    });
  });

  it('still fits a photo that overflows on only one axis', () => {
    // Narrower than the viewport but taller: fit by height, not native size.
    const tall: PhotoGeometry = {
      width: 200,
      height: 1600,
      crop_top: 700,
      crop_left: 0,
    };

    const frame = photoExpandFrame(tall, preview, viewport, 1);

    // 200x1600 into 400x800 is height-bound: scale 0.5 -> 100x800, centred.
    expect(frame.image).toEqual({ x: 0, y: 0, width: 100, height: 800 });
    expect(frame.clip).toEqual({ x: 150, y: 0, width: 100, height: 800 });
  });

  it('is a no-op expansion for a square photo, which has nothing to uncrop', () => {
    const square: PhotoGeometry = {
      width: 600,
      height: 600,
      crop_top: 0,
      crop_left: 0,
    };

    const start = photoExpandFrame(square, preview, viewport, 0);
    const end = photoExpandFrame(square, preview, viewport, 1);

    // The window always shows the whole photo; it only ever grows.
    expect(start.clip.width / start.image.width).toBeCloseTo(1);
    expect(end.clip.width / end.image.width).toBeCloseTo(1);
    expect(end.clip.width).toBe(400);
  });
});
