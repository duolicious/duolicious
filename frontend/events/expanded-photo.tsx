import { useLayoutEffect, useState } from 'react';
import { listen, notify, lastEvent } from './events';
import type { PhotoGeometry, Rect } from '../util/photos';

const EVENT_KEY = 'expanded-photo';

// Per-corner so a preview that rounds only some corners (the big-screen primary
// photo rounds just its bottom two) animates each correctly, rather than
// snapping the corners a single radius can't describe.
type BorderRadii = {
  topLeft: number
  topRight: number
  bottomLeft: number
  bottomRight: number
};

// One photo in the album the gallery can page through.
type AlbumPhoto = {
  uuid: string
  geometry: PhotoGeometry | null
};

// The photo the gallery is currently expanding out of, and back into when it
// closes. Passing this through React Navigation's `route.params` would leak
// measured pixel coordinates into the URL, so - as with `prospect-cache` - the
// press stashes it here and the gallery reads it on mount.
//
// `null` while no photo is expanded. Only ever one, since the gallery covers
// the screen it was opened from.
type ExpandedPhoto = {
  photoUuid: string

  // Every photo of the same person, so the gallery can page between them. The
  // tapped one (`photoUuid`) is where it starts and what the open/close morph
  // is anchored to.
  album: AlbumPhoto[]

  // Where the preview being expanded sits on screen, from `measureInWindow`.
  from: Rect

  geometry: PhotoGeometry

  // The preview's corner radii, animated out to square as it fills the screen.
  borderRadius: BorderRadii

  // Whether the gallery has drawn its copy of the photo over the preview yet.
  // The preview only hides once this is set, because the gallery is a screen
  // and doesn't paint on the same frame as the press: hiding on the press
  // itself leaves the photo missing for a frame or two.
  covered: boolean
};

const setExpandedPhoto = (expandedPhoto: ExpandedPhoto | null) => {
  notify<ExpandedPhoto | null>(EVENT_KEY, expandedPhoto);
};

const getExpandedPhoto = (): ExpandedPhoto | null =>
  lastEvent<ExpandedPhoto | null>(EVENT_KEY) ?? null;

// Whether the gallery has this preview's photo covered. Such a preview hides
// itself: the gallery draws the same photo over the top of it, and the two
// mustn't both be visible once the gallery's copy starts moving - the whole
// point being that there's only ever one apparent instance of the photo.
const useIsPhotoExpanded = (photoUuid: string | undefined | null): boolean => {
  const [expandedPhoto, setExpandedPhoto_] = useState<ExpandedPhoto | null>(
    () => getExpandedPhoto(),
  );

  useLayoutEffect(() => {
    return listen<ExpandedPhoto | null>(
      EVENT_KEY,
      (e) => setExpandedPhoto_(e ?? null),
      true,
    );
  }, []);

  if (!photoUuid) return false;
  if (expandedPhoto?.photoUuid !== photoUuid) return false;

  return expandedPhoto.covered;
};

export {
  getExpandedPhoto,
  setExpandedPhoto,
  useIsPhotoExpanded,
};

export type {
  AlbumPhoto,
  BorderRadii,
  ExpandedPhoto,
};
