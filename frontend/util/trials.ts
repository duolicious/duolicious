const treated = (
  personId: number | undefined,
  firstPersonId: number,
  bit: number,
): boolean =>
  personId !== undefined &&
  personId >= firstPersonId &&
  (personId >> bit) % 2 === 0;

const landingTab = (personId: number | undefined): 'Search' | 'Q&A' =>
  treated(personId, 389200, 0) ? 'Search' : 'Q&A';

const introMessagePreviews = (personId: number | undefined): boolean =>
  treated(personId, 389200, 1);

const sentMessagesInChats = (personId: number | undefined): boolean =>
  treated(personId, 389200, 2);

export { landingTab, introMessagePreviews, sentMessagesInChats };
