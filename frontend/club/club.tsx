import { useEffect, useMemo, useState } from 'react';
import { GestureResponderEvent } from 'react-native';
import { api, japi } from '../api/api';
import { notify, lastEvent, useDerivedEvent } from '../events/events';
import { searchQueue } from '../api/queue';
import { getSignedInUser } from '../events/signed-in-user';

const clubQuota = (hasGold?: boolean) => {
  if (hasGold ?? getSignedInUser()?.hasGold) {
    return 100;
  } else {
    return 50;
  }
};

type ClubItem = {
  name: string,
  count_members: number,
  search_preference?: boolean,
};

type RowPosition = 'front' | 'end';

type Anchor = {
  x: number,
  y: number,
  width: number,
  height: number,
};

type OpenClubCard = {
  name: string,
  anchor: Anchor,
  rowPosition?: RowPosition,
};

const sortClubs = (names: string[]) => [...names].sort((a, b) => {
  if (a.toLowerCase() > b.toLowerCase()) return +1;
  if (a.toLowerCase() < b.toLowerCase()) return -1;

  if (a > b) return +1;
  if (a < b) return -1;

  return 0;
});

const joinedClubs = () => lastEvent<string[]>('joined-clubs');

const useJoinedClubs = () => useDerivedEvent<string[] | undefined, string[] | undefined>(
  'joined-clubs', (cs) => cs, []);

const isClubMember = (name: string) => (joinedClubs() ?? []).includes(name);

const useIsClubMember = (name: string) => useDerivedEvent(
  'joined-clubs',
  (cs: string[] | undefined) => (cs ?? []).includes(name),
  [name],
);

const memberCountNow = (
  fetchedCount: number,
  wasMember: boolean,
  isMember: boolean,
) => fetchedCount + Number(isMember) - Number(wasMember);

const selectSearchClub = (name: string | null) => {
  notify<string | null>('search-club', name);
};

const useSearchClub = () => useDerivedEvent<string | null, string | null>(
  'search-club', (c) => c ?? null, []);

const moveClubToFront = (name: string) => {
  notify<string[]>('joined-clubs', [
    name,
    ...(joinedClubs() ?? []).filter((c) => c !== name),
  ]);
};

let suggestionsRequest = 0;

const setClubs = (clubs: ClubItem[] | undefined) => {
  const searchClub = clubs?.find((c) => c.search_preference)?.name ?? null;

  suggestionsRequest++;
  notify<ClubItem[] | undefined>('suggested-clubs', undefined);
  notify<string[] | undefined>('joined-clubs', clubs && [
    ...(searchClub === null ? [] : [searchClub]),
    ...sortClubs(clubs.map((c) => c.name)).filter((c) => c !== searchClub),
  ]);
  selectSearchClub(searchClub);
};

const postClubChange = (endpoint: string, name: string) => {
  const request = suggestionsRequest;

  searchQueue.addTask(async () => {
    const response = await japi<{ suggested_clubs?: ClubItem[] | null }>(
      'post', endpoint, { name });
    const clubs = response.json?.suggested_clubs;

    if (clubs && request === suggestionsRequest) {
      notify<ClubItem[]>('suggested-clubs', clubs);
    }
  });
};

const joinClub = (
  name: string,
  rowPosition: RowPosition = 'front',
): boolean => {
  const otherClubs = (joinedClubs() ?? []).filter((c) => c !== name);

  if (otherClubs.length >= clubQuota()) {
    return false;
  }

  postClubChange('/join-club', name);

  notify<string[]>(
    'joined-clubs',
    rowPosition === 'front' ? [name, ...otherClubs] : [...otherClubs, name]);

  if (otherClubs.length === 0) {
    selectSearchClub(name);
  }

  return true;
};

const leaveClub = (name: string): void => {
  postClubChange('/leave-club', name);

  notify<string[]>(
    'joined-clubs', (joinedClubs() ?? []).filter((c) => c !== name));

  if (lastEvent<string | null>('search-club') === name) {
    selectSearchClub(null);
  }
};

const resetClubs = () => {
  setClubs(undefined);
};

const fetchClubItems = async (q: string): Promise<ClubItem[]> => {
  const response = await api<ClubItem[]>(
    'get',
    `/search-clubs?q=${encodeURIComponent(q)}`
  );

  return response.ok && response.json ? response.json : [];
};

const refreshSuggestedClubs = async () => {
  const request = ++suggestionsRequest;
  const clubs = await fetchClubItems('');

  if (request === suggestionsRequest) {
    notify<ClubItem[]>('suggested-clubs', clubs);
  }
};

const NOT_LEAVING = new Set<string>();

const useSuggestedClubs = () => {
  const suggested = useDerivedEvent<ClubItem[] | undefined, ClubItem[] | null>(
    'suggested-clubs', (cs) => cs ?? null, []);

  const [shown, setShown] = useState(suggested);

  useEffect(() => setShown(suggested), [suggested]);

  const leaving = useMemo(() => {
    if (shown === suggested) {
      return NOT_LEAVING;
    }
    const kept = new Set((suggested ?? []).map((c) => c.name));
    return new Set((shown ?? []).map((c) => c.name).filter((n) => !kept.has(n)));
  }, [shown, suggested]);

  return { suggested: shown, leaving };
};

const openClubs = (anchor: Anchor) => {
  notify<Anchor | null>('clubs-sheet', anchor);
};

const useClubsSheet = () => useDerivedEvent<Anchor | null | undefined, Anchor | null>(
  'clubs-sheet', (s) => s ?? null, []);

const openClubCard = ({
  name,
  anchor,
  rowPosition,
}: Omit<OpenClubCard, 'anchor'> & { anchor: Anchor | GestureResponderEvent }) => {
  if ('nativeEvent' in anchor) {
    return anchor.currentTarget.measureInWindow((x, y, width, height) =>
      openClubCard({ name, anchor: { x, y, width, height }, rowPosition }));
  }

  notify<OpenClubCard | null>('club-card', { name, anchor, rowPosition });
};

const useOpenClubCard = () => useDerivedEvent<OpenClubCard | null | undefined, OpenClubCard | null>(
  'club-card', (c) => c ?? null, []);

const closeClubCard = () => {
  notify<OpenClubCard | null>('club-card', null);
};

const closeClubs = () => {
  closeClubCard();
  notify<Anchor | null>('clubs-sheet', null);
};

export {
  clubQuota,
  ClubItem,
  joinClub,
  leaveClub,
  resetClubs,
  Anchor,
  OpenClubCard,
  RowPosition,
  closeClubCard,
  closeClubs,
  fetchClubItems,
  isClubMember,
  memberCountNow,
  moveClubToFront,
  openClubCard,
  openClubs,
  refreshSuggestedClubs,
  selectSearchClub,
  setClubs,
  sortClubs,
  useClubsSheet,
  useIsClubMember,
  useJoinedClubs,
  useOpenClubCard,
  useSearchClub,
  useSuggestedClubs,
};
