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

export {
  hasGifExtraExt,
  photoUri,
  supportedExtraExt,
};
