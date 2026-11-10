const webPushWhenOffline = (personId: number): boolean =>
  personId >= 399000 && (personId >> 2) % 2 === 0;

export {
  webPushWhenOffline,
};
