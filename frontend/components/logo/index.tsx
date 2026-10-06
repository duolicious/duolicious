import { memo, useEffect, useMemo } from 'react';
import {
  cancelAnimation,
  Easing,
  SharedValue,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { Canvas, Group, Rect as SkiaRect } from '@shopify/react-native-skia';
import {
  LOGO_16_RECT_COORDINATES,
  Logo14Props,
  Logo16Props,
  resolveLogoSize,
} from './common';

const VIEWBOX_16 = 4.2333331;
const VIEWBOX_14 = 3.7041666;
const easingPoly5 = Easing.poly(5);

const AnimatedLogoRect = memo(({
  index,
  coord,
  rectSize,
  color,
  doAnimate,
  progress,
  timeline, // { STAGGER, FADE, T2, T4 }
}: {
  index: number;
  coord: { x: number; y: number };
  rectSize: number;
  color: string;
  doAnimate: boolean;
  progress: SharedValue<number>;
  timeline: { STAGGER: number; FADE: number; T2: number; T4: number };
}) => {
  const { STAGGER, FADE, T2, T4 } = timeline;

  const opacity = useDerivedValue(() => {
    if (!doAnimate) return 1;

    const time = progress.value % T4;
    const inStart = index * STAGGER;
    const inEnd = inStart + FADE;
    const outStart = T2 + index * STAGGER;
    const outEnd = outStart + FADE;
    const invFade = 1 / FADE;

    let o = 0;
    if (time >= inStart && time <= inEnd) {
      o = easingPoly5((time - inStart) * invFade);
    } else if (time > inEnd && time < outStart) {
      o = 1;
    } else if (time >= outStart && time <= outEnd) {
      o = 1 - easingPoly5((time - outStart) * invFade);
    }
    return o;
  }, [doAnimate, STAGGER, FADE, T2, T4, index]);

  return (
    <SkiaRect
      x={coord.x}
      y={coord.y}
      width={rectSize}
      height={rectSize}
      color={color}
      opacity={opacity}
    />
  );
});

const Logo16 = ({
  size = 48,
  color = 'white',
  rectSize = 0.26458332,
  fadeOutDelay = 5000,
  fadeInDelay = 500,
  doAnimate = false,
  doLoop = true,
  startVisible = false,
  style,
}: Logo16Props) => {
  const sizePx = resolveLogoSize(size);

  const timeline = useMemo(() => {
    const COUNT = LOGO_16_RECT_COORDINATES.length;
    const STAGGER = 40;
    const FADE = 400;
    const IN_WINDOW = (COUNT - 1) * STAGGER + FADE;
    const T1 = IN_WINDOW;
    const T2 = T1 + fadeOutDelay;
    const T3 = T2 + IN_WINDOW;
    const T4 = T3 + fadeInDelay;
    return { COUNT, STAGGER, FADE, T1, T2, T3, T4 };
  }, [fadeOutDelay, fadeInDelay]);

  const start = startVisible ? timeline.T1 : 0;
  const progress = useSharedValue(start);

  useEffect(() => {
    // mirror original behavior with reanimated timing
    cancelAnimation(progress);

    if (!doAnimate) {
      progress.value = 0;
      return;
    }

    progress.value = start;

    if (doLoop) {
      progress.value = withRepeat(
        withTiming(start + timeline.T4, { duration: timeline.T4, easing: Easing.linear }),
        -1,
        false
      );
    } else {
      progress.value = withTiming(timeline.T1, { duration: timeline.T1 - start, easing: Easing.linear });
    }

    return () => cancelAnimation(progress);
  }, [doAnimate, doLoop, start, timeline.T1, timeline.T4]);

  const scale = sizePx / VIEWBOX_16;

  return (
    <Canvas style={[{ width: sizePx, height: sizePx }, style]}>
      {/* Scale Skia coordinates to the requested pixel size */}
      <Group transform={[{ scale }]}>
        {LOGO_16_RECT_COORDINATES.map((coord, index) => (
          <AnimatedLogoRect
            key={index}
            index={index}
            coord={coord}
            rectSize={rectSize}
            color={color}
            doAnimate={doAnimate}
            progress={progress}
            timeline={{ STAGGER: timeline.STAGGER, FADE: timeline.FADE, T2: timeline.T2, T4: timeline.T4 }}
          />
        ))}
      </Group>
    </Canvas>
  );
};

const Logo14 = ({
  size = 42,
  color = 'white',
  rectSize = 0.26458332
}: Logo14Props) => {
  const scale = size / VIEWBOX_14;

  return (
    <Canvas style={{ width: size, height: size }}>
      <Group transform={[{ scale }]}>
        <SkiaRect color={color} width={rectSize} height={rectSize} x={2.1166666} y={0.79374993} />
        <SkiaRect color={color} width={rectSize} height={rectSize} x={2.3812499} y={0.79374993} />
        <SkiaRect color={color} width={rectSize} height={rectSize} x={1.8520831} y={1.0583333} />
        <SkiaRect color={color} width={rectSize} height={rectSize} x={1.8520831} y={1.3229166} />
        <SkiaRect color={color} width={rectSize} height={rectSize} x={2.1166666} y={1.5875} />
        <SkiaRect color={color} width={rectSize} height={rectSize} x={2.3812499} y={1.8520832} />
        <SkiaRect color={color} width={rectSize} height={rectSize} x={2.6458333} y={2.1166666} />
        <SkiaRect color={color} width={rectSize} height={rectSize} x={2.9104166} y={1.8520832} />
        <SkiaRect color={color} width={rectSize} height={rectSize} x={3.175} y={1.5875} />
        <SkiaRect color={color} width={rectSize} height={rectSize} x={3.4395831} y={1.3229166} />
        <SkiaRect color={color} width={rectSize} height={rectSize} x={3.4395831} y={1.0583333} />
        <SkiaRect color={color} width={rectSize} height={rectSize} x={2.6458333} y={1.0583333} />
        <SkiaRect color={color} width={rectSize} height={rectSize} x={2.9104166} y={0.79374993} />
        <SkiaRect color={color} width={rectSize} height={rectSize} x={3.175} y={0.79374993} />
        <SkiaRect color={color} width={rectSize} height={rectSize} x={rectSize} y={1.3229166} />
        <SkiaRect color={color} width={rectSize} height={rectSize} x={0.5291667} y={1.3229166} />
        <SkiaRect color={color} width={rectSize} height={rectSize} x={0} y={1.5875002} />
        <SkiaRect color={color} width={rectSize} height={rectSize} x={0} y={1.8520832} />
        <SkiaRect color={color} width={rectSize} height={rectSize} x={rectSize} y={2.1166666} />
        <SkiaRect color={color} width={rectSize} height={rectSize} x={0.5291667} y={2.3812499} />
        <SkiaRect color={color} width={rectSize} height={rectSize} x={0.79375011} y={2.6458333} />
        <SkiaRect color={color} width={rectSize} height={rectSize} x={1.0583332} y={2.3812499} />
        <SkiaRect color={color} width={rectSize} height={rectSize} x={1.3229165} y={2.1166666} />
        <SkiaRect color={color} width={rectSize} height={rectSize} x={1.5874999} y={1.8520832} />
        <SkiaRect color={color} width={rectSize} height={rectSize} x={1.5874999} y={1.5875002} />
        <SkiaRect color={color} width={rectSize} height={rectSize} x={0.79375011} y={1.5875002} />
        <SkiaRect color={color} width={rectSize} height={rectSize} x={1.0583332} y={1.3229166} />
        <SkiaRect color={color} width={rectSize} height={rectSize} x={1.3229165} y={1.3229166} />
      </Group>
    </Canvas>
  );
};

export { Logo16, Logo14 };
