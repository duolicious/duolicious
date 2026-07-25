export const GIF_MESSAGE = '🖼️ GIF';

// Tenor remains for messages sent before the switch to Klipy
export const isGifUrl = (str: string): boolean => {
  const urlRegex = /^https:\/\/(media\.tenor\.com|static\.klipy\.com)\/\S+\.(gif|webp)$/i;
  return urlRegex.test(str);
};
