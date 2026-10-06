import {
  memo,
  useEffect,
  useMemo,
} from 'react';
import Animated, {
  cancelAnimation,
  Easing,
  SharedValue,
  useAnimatedProps,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { G, Rect } from 'react-native-svg';
import {
  LOGO_16_RECT_COORDINATES,
  Logo14Props,
  Logo16Props,
  resolveLogoSize,
} from './common';

const AnimatedRect = Animated.createAnimatedComponent(Rect);

const easingPoly5 = Easing.poly(5);

const AnimatedLogoRect = memo(({
  index,
  coord,
  rectSize,
  color,
  doAnimate,
  progress,                 // <— pass this
  timeline,                 // <— pass the scalar timings (numbers)
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

  const animatedProps = useAnimatedProps(() => {
    'worklet';
    if (!doAnimate) return { opacity: 1 };

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
    return { opacity: o };    // use element opacity (cheaper composite) instead of fillOpacity
  });

  return (
    <AnimatedRect
      width={rectSize}
      height={rectSize}
      x={coord.x}
      y={coord.y}
      fill={color}
      animatedProps={animatedProps}
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
    if (!doAnimate) {
      cancelAnimation(progress);
      progress.value = 0;
      return;
    }
    cancelAnimation(progress);
    progress.value = start;
    progress.value = doLoop
      ? withRepeat(withTiming(start + timeline.T4, { duration: timeline.T4, easing: Easing.linear }), -1, false)
      : withTiming(timeline.T1, { duration: timeline.T1 - start, easing: Easing.linear });

    return () => cancelAnimation(progress);
  }, [doAnimate, doLoop, start, timeline.T1, timeline.T4]);

  return (
    <Svg width={sizePx} height={sizePx} viewBox="0 0 4.2333331 4.2333332" style={style}>
      <G pointerEvents="none">
        {LOGO_16_RECT_COORDINATES.map((coord, index) => (
          <AnimatedLogoRect
            key={index}
            index={index}
            coord={coord}
            rectSize={rectSize}
            color={color}
            doAnimate={doAnimate}
            progress={progress}                     // <—
            timeline={{ STAGGER: timeline.STAGGER, FADE: timeline.FADE, T2: timeline.T2, T4: timeline.T4 }} // <—
          />
        ))}
      </G>
    </Svg>
  );
};

const Logo14 = ({
  size = 42,
  color = 'white',
  rectSize = 0.26458332
}: Logo14Props) => {
  return (
    <Svg
       width={size}
       height={size}
       viewBox="0 0 3.7041665 3.7041666"
    >
      <G>
        <Rect
           fill={color} strokeWidth="1" strokeLinecap="round" strokeDashoffset="6.8276"
           id="Rect499"
           width={rectSize}
           height={rectSize}
           x="2.1166666"
           y="0.79374993" />
        <Rect
           fill={color} strokeWidth="1" strokeLinecap="round" strokeDashoffset="6.8276"
           id="Rect501"
           width={rectSize}
           height={rectSize}
           x="2.3812499"
           y="0.79374993" />
        <Rect
           fill={color} strokeWidth="1" strokeLinecap="round" strokeDashoffset="6.8276"
           id="Rect503"
           width={rectSize}
           height={rectSize}
           x="1.8520831"
           y="1.0583333" />
        <Rect
           fill={color} strokeWidth="1" strokeLinecap="round" strokeDashoffset="6.8276"
           id="Rect505"
           width={rectSize}
           height={rectSize}
           x="1.8520831"
           y="1.3229166" />
        <Rect
           fill={color} strokeWidth="1" strokeLinecap="round" strokeDashoffset="6.8276"
           id="Rect507"
           width={rectSize}
           height={rectSize}
           x="2.1166666"
           y="1.5875" />
        <Rect
           fill={color} strokeWidth="1" strokeLinecap="round" strokeDashoffset="6.8276"
           id="Rect509"
           width={rectSize}
           height={rectSize}
           x="2.3812499"
           y="1.8520832" />
        <Rect
           fill={color} strokeWidth="1" strokeLinecap="round" strokeDashoffset="6.8276"
           id="Rect511"
           width={rectSize}
           height={rectSize}
           x="2.6458333"
           y="2.1166666" />
        <Rect
           fill={color} strokeWidth="1" strokeLinecap="round" strokeDashoffset="6.8276"
           id="Rect513"
           width={rectSize}
           height={rectSize}
           x="2.9104166"
           y="1.8520832" />
        <Rect
           fill={color} strokeWidth="1" strokeLinecap="round" strokeDashoffset="6.8276"
           id="Rect515"
           width={rectSize}
           height={rectSize}
           x="3.175"
           y="1.5875" />
        <Rect
           fill={color} strokeWidth="1" strokeLinecap="round" strokeDashoffset="6.8276"
           id="Rect517"
           width={rectSize}
           height={rectSize}
           x="3.4395831"
           y="1.3229166" />
        <Rect
           fill={color} strokeWidth="1" strokeLinecap="round" strokeDashoffset="6.8276"
           id="Rect519"
           width={rectSize}
           height={rectSize}
           x="3.4395831"
           y="1.0583333" />
        <Rect
           fill={color} strokeWidth="1" strokeLinecap="round" strokeDashoffset="6.8276"
           id="Rect521"
           width={rectSize}
           height={rectSize}
           x="2.6458333"
           y="1.0583333" />
        <Rect
           fill={color} strokeWidth="1" strokeLinecap="round" strokeDashoffset="6.8276"
           id="Rect523"
           width={rectSize}
           height={rectSize}
           x="2.9104166"
           y="0.79374993" />
        <Rect
           fill={color} strokeWidth="1" strokeLinecap="round" strokeDashoffset="6.8276"
           id="Rect525"
           width={rectSize}
           height={rectSize}
           x="3.175"
           y="0.79374993" />
        <Rect
           fill={color} strokeWidth="1" strokeLinecap="round" strokeDashoffset="6.8276"
           id="Rect499-7"
           width={rectSize}
           height={rectSize}
           x={rectSize}
           y="1.3229166" />
        <Rect
           fill={color} strokeWidth="1" strokeLinecap="round" strokeDashoffset="6.8276"
           id="Rect501-5"
           width={rectSize}
           height={rectSize}
           x="0.5291667"
           y="1.3229166" />
        <Rect
           fill={color} strokeWidth="1" strokeLinecap="round" strokeDashoffset="6.8276"
           id="Rect503-3"
           width={rectSize}
           height={rectSize}
           x="3.4701156e-08"
           y="1.5875002" />
        <Rect
           fill={color} strokeWidth="1" strokeLinecap="round" strokeDashoffset="6.8276"
           id="Rect505-5"
           width={rectSize}
           height={rectSize}
           x="3.4701156e-08"
           y="1.8520832" />
        <Rect
           fill={color} strokeWidth="1" strokeLinecap="round" strokeDashoffset="6.8276"
           id="Rect507-6"
           width={rectSize}
           height={rectSize}
           x={rectSize}
           y="2.1166666" />
        <Rect
           fill={color} strokeWidth="1" strokeLinecap="round" strokeDashoffset="6.8276"
           id="Rect509-2"
           width={rectSize}
           height={rectSize}
           x="0.5291667"
           y="2.3812499" />
        <Rect
           fill={color} strokeWidth="1" strokeLinecap="round" strokeDashoffset="6.8276"
           id="Rect511-9"
           width={rectSize}
           height={rectSize}
           x="0.79375011"
           y="2.6458333" />
        <Rect
           fill={color} strokeWidth="1" strokeLinecap="round" strokeDashoffset="6.8276"
           id="Rect513-1"
           width={rectSize}
           height={rectSize}
           x="1.0583332"
           y="2.3812499" />
        <Rect
           fill={color} strokeWidth="1" strokeLinecap="round" strokeDashoffset="6.8276"
           id="Rect515-2"
           width={rectSize}
           height={rectSize}
           x="1.3229165"
           y="2.1166666" />
        <Rect
           fill={color} strokeWidth="1" strokeLinecap="round" strokeDashoffset="6.8276"
           id="Rect517-7"
           width={rectSize}
           height={rectSize}
           x="1.5874999"
           y="1.8520832" />
        <Rect
           fill={color} strokeWidth="1" strokeLinecap="round" strokeDashoffset="6.8276"
           id="Rect519-0"
           width={rectSize}
           height={rectSize}
           x="1.5874999"
           y="1.5875002" />
        <Rect
           fill={color} strokeWidth="1" strokeLinecap="round" strokeDashoffset="6.8276"
           id="Rect521-9"
           width={rectSize}
           height={rectSize}
           x="0.79375011"
           y="1.5875002" />
        <Rect
           fill={color} strokeWidth="1" strokeLinecap="round" strokeDashoffset="6.8276"
           id="Rect523-3"
           width={rectSize}
           height={rectSize}
           x="1.0583332"
           y="1.3229166" />
        <Rect
           fill={color} strokeWidth="1" strokeLinecap="round" strokeDashoffset="6.8276"
           id="Rect525-6"
           width={rectSize}
           height={rectSize}
           x="1.3229165"
           y="1.3229166" />
      </G>
    </Svg>
  );
};

export {
  Logo16,
  Logo14,
};
