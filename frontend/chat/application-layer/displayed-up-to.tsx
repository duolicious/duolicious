import { lastEvent, notify } from '../../events/events';

const displayedUpToKey = (personUuid: string) =>
  `inbox-displayed-up-to-${personUuid}`;

const touchedPersonUuids = new Set<string>();

const getDisplayedUpTo = (personUuid: string): Date | null =>
  lastEvent<Date>(displayedUpToKey(personUuid)) ?? null;

const advanceDisplayedUpTo = (personUuid: string, displayedUpTo: Date): void => {
  if (Number.isNaN(displayedUpTo.getTime())) {
    return;
  }

  const prev = getDisplayedUpTo(personUuid);

  if (prev && displayedUpTo <= prev) {
    return;
  }

  touchedPersonUuids.add(personUuid);
  notify<Date>(displayedUpToKey(personUuid), displayedUpTo);
};

const clearDisplayedUpTo = (): void => {
  touchedPersonUuids.forEach((personUuid) =>
    notify<Date>(displayedUpToKey(personUuid)));
  touchedPersonUuids.clear();
};

export {
  advanceDisplayedUpTo,
  clearDisplayedUpTo,
  getDisplayedUpTo,
};