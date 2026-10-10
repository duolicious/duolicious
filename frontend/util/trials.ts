const sentMessagesInChats = (personId: number | undefined): boolean =>
  personId !== undefined &&
  personId >= 390250 &&
  personId < 391400 &&
  personId % 2 === 0;

const clubsRedesign = (personId: number | undefined): boolean =>
  personId !== undefined && personId >= 391400 && (personId >> 1) % 2 === 0;

export { clubsRedesign, sentMessagesInChats };
