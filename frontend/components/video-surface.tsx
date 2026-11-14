import { useEffect } from 'react';
import { VideoContentFit, VideoPlayer, VideoView } from 'expo-video';
import { queueApplyWants, sharedVideoFor } from './shared-video';

const VideoSurface = ({
  player,
  contentFit,
  onPlaying,
}: {
  player: VideoPlayer
  contentFit: VideoContentFit
  onPlaying?: () => void
}) => {
  useEffect(() => {
    const video = sharedVideoFor(player);

    if (video) {
      queueApplyWants(video);
    }
  }, [player]);

  return (
    <VideoView
      player={player}
      style={{ position: 'absolute', width: '100%', height: '100%' }}
      contentFit={contentFit}
      nativeControls={false}
      surfaceType="textureView"
      useExoShutter={false}
      playsInline={true}
      pointerEvents="none"
      onFirstFrameRender={onPlaying}
    />
  );
};

const VideoHost = () => null;

export {
  VideoHost,
  VideoSurface,
};
