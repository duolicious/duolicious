import { useLayoutEffect, useState } from 'react';
import { listen, notify, lastEvent } from './events';
import type { ClubItem } from '../club/club';

// The GET /profile-info response uses space-separated keys for some fields
// (e.g. 'looking for') while the PATCH endpoint and DB columns use snake_case
// (e.g. 'looking_for'). Normalize everything to snake_case in the store so
// reads and writes share one shape.
const SPACE_TO_SNAKE: Record<string, string> = {
  'looking for': 'looking_for',
  'long distance': 'long_distance',
  'relationship status': 'relationship_status',
  'has kids': 'has_kids',
  'wants kids': 'wants_kids',
  'star sign': 'star_sign',
  'verification level': 'verification_level',
  'public profile': 'public_profile',
  'show my location': 'show_my_location',
  'show my age': 'show_my_age',
  'show my looking for': 'show_my_looking_for',
  'hide me from strangers': 'hide_me_from_strangers',
  'browse invisibly': 'browse_invisibly',
};

const normalizeKeys = (
  raw: ProfileInfo | undefined,
): ProfileInfo | undefined => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const out: ProfileInfo = {};
  for (const [k, v] of Object.entries(raw)) {
    out[SPACE_TO_SNAKE[k] ?? k] = v;
  }
  return out;
};

type ProfileInfoTheme = {
  title_color?: string;
  body_color?: string;
  background_color?: string;
};

type ProfileInfo = {
  name?: string;
  about?: string;
  url_slug?: string | null;
  height?: number;
  theme?: ProfileInfoTheme;
  clubs?: ClubItem[];
  public_profile?: string;
  photo?: { [position: string]: string | null };
  photo_extra_exts?: { [position: string]: string[] };
  photo_blurhash?: { [position: string]: string | null };
  photo_verification?: { [position: string]: boolean };
  verified_gender?: boolean;
  verified_age?: boolean;
  verified_ethnicity?: boolean;
  audio_bio?: string | null;
  audio_bio_max_seconds?: number;
  [key: string]: unknown;
};

const EVENT_KEY = 'profile-info';

const getProfileInfo = (): ProfileInfo | undefined => {
  return lastEvent<ProfileInfo | undefined>(EVENT_KEY);
};

const setProfileInfo = (next: ProfileInfo | undefined) => {
  notify<ProfileInfo | undefined>(EVENT_KEY, normalizeKeys(next));
};

const patchProfileInfo = (partial: ProfileInfo) => {
  const prev = getProfileInfo();
  if (!prev) return;
  notify<ProfileInfo>(EVENT_KEY, { ...prev, ...normalizeKeys(partial) });
};

const resetProfileInfo = () => {
  notify<ProfileInfo | undefined>(EVENT_KEY, undefined);
};

const useProfileInfo = () => {
  const [value, setValue] = useState<ProfileInfo | undefined>(getProfileInfo());

  useLayoutEffect(() => {
    return listen<ProfileInfo | undefined>(EVENT_KEY, setValue, true);
  }, []);

  return value;
};

export {
  ProfileInfo,
  getProfileInfo,
  patchProfileInfo,
  resetProfileInfo,
  setProfileInfo,
  useProfileInfo,
};
