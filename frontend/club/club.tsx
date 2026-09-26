import { japi } from '../api/api';
import { notify, lastEvent } from '../events/events';
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

const sortClubs = (cs: ClubItem[] | undefined) => {
  const unsortedCs = cs ?? [];
  const sortedCs = unsortedCs.sort((a, b) => {
    if (a.name.toLowerCase() > b.name.toLowerCase()) return +1;
    if (a.name.toLowerCase() < b.name.toLowerCase()) return -1;

    if (a.name > b.name) return +1;
    if (a.name < b.name) return -1;

    return 0;
  });

  return sortedCs;
}

const joinClub = (
  name: string,
  countMembers: number,
  searchPreference?: boolean,
): boolean => {
  const existingClubs = lastEvent<ClubItem[]>('updated-clubs') ?? [];

  if (existingClubs.length >= clubQuota()) {
    return false;
  }

  searchQueue.addTask(async () => await japi('post', '/join-club', { name }));

  const updatedClubs = [
    ...existingClubs
      .filter((c) => c.name !== name)
      .map((c) => ({
        ...c,
        search_preference:
          searchPreference === true ? false : c.search_preference
      })),
    {
      name,
      count_members: countMembers,
      search_preference: searchPreference
    },
  ];

  sortClubs(updatedClubs)

  notify<ClubItem[]>('updated-clubs', updatedClubs);

  return true;
};

const leaveClub = (name: string): void => {
  searchQueue.addTask(async () => await japi('post', '/leave-club', { name }));

  const existingClubs = lastEvent<ClubItem[]>('updated-clubs') ?? [];

  const updatedClubs = existingClubs.filter((c) => c.name !== name);

  sortClubs(updatedClubs)

  notify<ClubItem[]>('updated-clubs', updatedClubs);
};

const resetClubs = () => {
  notify<ClubItem[] | undefined>('updated-clubs', undefined);
};

export {
  clubQuota,
  ClubItem,
  joinClub,
  leaveClub,
  resetClubs,
  sortClubs,
};
