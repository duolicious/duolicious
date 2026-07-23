import { notify, lastEvent, useDerivedEvent } from './events';
import type { PhotoGeometry, Rect } from '../util/photos';

const EVENT_KEY = 'expanded-photo';

// Per-corner because some previews round only some corners (the big-screen
// primary photo rounds just its bottom two).
type BorderRadii = {
  topLeft: number
  topRight: number
  bottomLeft: number
  bottomRight: number
};

const ZERO_BORDER_RADII: BorderRadii = {
  topLeft: 0,
  topRight: 0,
  bottomLeft: 0,
  bottomRight: 0,
};

type AlbumPhoto = {
  uuid: string
  extraExts: string[]
  geometry: PhotoGeometry | null
  blurhash: string | null
};

type ExpandedPhotoMorph = {
  // Where the preview sits on screen, from `measureInWindow`.
  from: Rect

  geometry: PhotoGeometry

  borderRadius: BorderRadii
};

// The photo the gallery was opened from. Passing this through `route.params`
// would leak measured pixel coordinates into the URL, so - as with
// `prospect-cache` - the press stashes it here and the gallery reads it on
// mount. `null` while the gallery is closed.
type ExpandedPhoto = {
  photoUuid: string

  // Every photo of the same person, so the gallery can page between them.
  album: AlbumPhoto[]

  morph: ExpandedPhotoMorph | null

  // Whether the gallery has drawn its copy of the photo over the preview yet.
  // The preview only hides once this is set: the gallery doesn't paint on the
  // same frame as the press, so hiding sooner leaves the photo missing for a
  // frame or two.
  covered: boolean
};

const setExpandedPhoto = (expandedPhoto: ExpandedPhoto | null) => {
  notify<ExpandedPhoto | null>(EVENT_KEY, expandedPhoto);
};

const getExpandedPhoto = (): ExpandedPhoto | null =>
  lastEvent<ExpandedPhoto | null>(EVENT_KEY) ?? null;

// Whether the gallery has this preview's photo covered. Such a preview hides
// itself, so only one instance of the photo is ever apparent.
const useIsPhotoExpanded = (photoUuid: string | undefined | null): boolean =>
  useDerivedEvent(
    EVENT_KEY,
    (e: ExpandedPhoto | null | undefined) =>
      !!photoUuid && e?.photoUuid === photoUuid && e.covered,
    [photoUuid],
  );

export {
  ZERO_BORDER_RADII,
  getExpandedPhoto,
  setExpandedPhoto,
  useIsPhotoExpanded,
};

export type {
  AlbumPhoto,
  BorderRadii,
  ExpandedPhoto,
  ExpandedPhotoMorph,
};
