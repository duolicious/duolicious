import { useEffect, useRef, useState } from 'react';
import { VideoContentFit, VideoPlayer, VideoView } from 'expo-video';
import { listen } from '../events/events';
import {
  EV_SHARED_VIDEOS,
  SharedVideo,
  VideoClaim,
  hostVideo,
  placeElement,
  queueApplyWants,
  sharedVideoFor,
} from './shared-video';

const VideoSurface = ({
  player,
  contentFit,
  onPlaying,
}: {
  player: VideoPlayer
  contentFit: VideoContentFit
  onPlaying?: () => void
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const video = sharedVideoFor(player);
    const container = containerRef.current;

    if (!video || !container) {
      return;
    }

    const claim: VideoClaim = { container, contentFit };
    video.claims.push(claim);
    placeElement(video);
    queueApplyWants(video);

    const element = video.element;
    const isPlaying = element && !element.paused && element.readyState >= 3;

    if (onPlaying && isPlaying) {
      onPlaying();
    } else if (onPlaying && element) {
      element.addEventListener('playing', onPlaying, { once: true });
    }

    return () => {
      if (onPlaying && element) {
        element.removeEventListener('playing', onPlaying);
      }

      video.claims = video.claims.filter((c) => c !== claim);
      placeElement(video);
    };
  }, [player]);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      }}
    />
  );
};

const HostedVideo = ({ video }: { video: SharedVideo }) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<VideoView>(null);

  useEffect(() => {
    hostVideo(
      video,
      hostRef.current,
      viewRef.current?.nativeRef.current ?? null,
    );
  }, []);

  return (
    <div ref={hostRef} style={{ display: 'none' }}>
      <VideoView
        ref={viewRef}
        player={video.player}
        style={{ position: 'absolute', width: '100%', height: '100%' }}
        nativeControls={false}
        playsInline={true}
        pointerEvents="none"
      />
    </div>
  );
};

const VideoHost = () => {
  const [videos, setVideos] = useState<SharedVideo[]>([]);

  useEffect(
    () => listen<SharedVideo[]>(
      EV_SHARED_VIDEOS,
      (videos) => setVideos(videos ?? []),
      true,
    ),
    [],
  );

  return <>{videos.map((video) => <HostedVideo key={video.id} video={video} />)}</>;
};

export {
  VideoHost,
  VideoSurface,
};
