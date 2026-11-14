import { useEffect, useId } from 'react';
import { VideoContentFit, VideoPlayer, createVideoPlayer } from 'expo-video';
import { notify } from '../events/events';

const EV_SHARED_VIDEOS = 'shared-videos';
const RELEASE_DELAY_MS = 1000;

type PlaybackWants = {
  playing: boolean
  sound: boolean
};

type VideoClaim = {
  container: HTMLElement
  contentFit: VideoContentFit
};

type SharedVideo = {
  id: number
  player: VideoPlayer
  wants: Map<string, PlaybackWants>
  applyQueued: boolean
  element: HTMLVideoElement | null
  host: HTMLElement | null
  claims: VideoClaim[]
};

const sharedVideos = new Map<string, SharedVideo>();

let nextSharedVideoId = 0;

const notifySharedVideos = () => queueMicrotask(
  () => notify<SharedVideo[]>(EV_SHARED_VIDEOS, [...sharedVideos.values()]));

const applyWants = ({ player, wants }: SharedVideo) => {
  player.muted = ![...wants.values()].some((w) => w.sound);

  if ([...wants.values()].some((w) => w.playing)) {
    player.play();
  } else {
    player.pause();
  }
};

const queueApplyWants = (video: SharedVideo) => {
  if (video.applyQueued) {
    return;
  }

  video.applyQueued = true;
  queueMicrotask(() => {
    video.applyQueued = false;
    applyWants(video);
  });
};

const placeElement = ({ element, host, claims }: SharedVideo) => {
  const claim = claims.at(-1);
  const parent = claim?.container ?? host;

  if (!element || !parent) {
    return;
  }

  element.style.objectFit = claim?.contentFit ?? 'contain';

  if (element.parentElement !== parent) {
    parent.appendChild(element);
  }
};

const releaseIfUnwanted = (uri: string, video: SharedVideo) => {
  setTimeout(() => {
    if (video.wants.size === 0 && sharedVideos.get(uri) === video) {
      sharedVideos.delete(uri);
      notifySharedVideos();
      video.player.release();
    }
  }, RELEASE_DELAY_MS);
};

const sharedVideo = (uri: string): SharedVideo => {
  const existing = sharedVideos.get(uri);

  if (existing) {
    return existing;
  }

  const player = createVideoPlayer(uri);
  player.loop = true;
  player.timeUpdateEventInterval = 0.1;

  const video: SharedVideo = {
    id: nextSharedVideoId++,
    player,
    wants: new Map(),
    applyQueued: false,
    element: null,
    host: null,
    claims: [],
  };

  sharedVideos.set(uri, video);
  notifySharedVideos();
  releaseIfUnwanted(uri, video);

  return video;
};

const hostVideo = (
  video: SharedVideo,
  host: HTMLElement | null,
  element: HTMLVideoElement | null,
) => {
  video.host = host;
  video.element = element;
  placeElement(video);
  queueApplyWants(video);
};

const sharedVideoFor = (player: VideoPlayer) =>
  [...sharedVideos.values()].find((v) => v.player === player);

const useSharedVideo = (
  uri: string | null,
  playing: boolean,
  sound: boolean,
): VideoPlayer | null => {
  const id = useId();
  const video = uri === null ? null : sharedVideo(uri);

  useEffect(() => {
    if (!video) {
      return;
    }

    video.wants.set(id, { playing, sound });
    queueApplyWants(video);
  }, [video, playing, sound]);

  useEffect(() => {
    if (!video || !uri) {
      return;
    }

    return () => {
      video.wants.delete(id);
      queueApplyWants(video);
      releaseIfUnwanted(uri, video);
    };
  }, [video]);

  return video?.player ?? null;
};

export {
  EV_SHARED_VIDEOS,
  SharedVideo,
  VideoClaim,
  hostVideo,
  placeElement,
  queueApplyWants,
  sharedVideoFor,
  useSharedVideo,
};
