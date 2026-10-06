const sentMessagesInChats = (personId: number | undefined): boolean =>
  personId !== undefined && personId >= 390700 && personId % 2 === 0;

export { sentMessagesInChats };
