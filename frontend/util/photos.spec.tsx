import { hasGifExtraExt, photoUri, supportedExtraExt } from './photos';
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
