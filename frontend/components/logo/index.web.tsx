import { useMemo } from 'react';
import Svg, { G, Rect } from 'react-native-svg';
import {
  LOGO_16_RECT_COORDINATES,
  Logo14Props,
  Logo16Props,
  resolveLogoSize,
} from './common';

const EASE_IN_QUINT = 'cubic-bezier(0.64, 0, 0.78, 0)';

const fadeAnimation = (
  doLoop: boolean,
  { FADE, T2, T4 }: { FADE: number, T2: number, T4: number },
) => {
  const percent = (time: number) => `${100 * time / T4}%`;
  const name = doLoop ? `logo16-loop-${T2}-${T4}` : 'logo16-once';

  return {
    name,
    keyframes: doLoop
      ? `@keyframes ${name} {
          0% { opacity: 0; animation-timing-function: ${EASE_IN_QUINT} }
          ${percent(FADE)} { opacity: 1 }
          ${percent(T2)} { opacity: 1; animation-timing-function: ${EASE_IN_QUINT} }
          ${percent(T2 + FADE)} { opacity: 0 }
          100% { opacity: 0 }
        }`
      : `@keyframes ${name} { from { opacity: 0 } to { opacity: 1 } }`,
    style: {
      animationName: name,
      animationDuration: `${doLoop ? T4 : FADE}ms`,
      animationTimingFunction: doLoop ? 'linear' : EASE_IN_QUINT,
      animationIterationCount: doLoop ? 'infinite' : 1,
      animationFillMode: 'both',
    },
  };
};

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
    return { STAGGER, FADE, T1, T2, T4 };
  }, [fadeOutDelay, fadeInDelay]);

  const fade = useMemo(
    () => doAnimate ? fadeAnimation(doLoop, timeline) : undefined,
    [doAnimate, doLoop, timeline]);

  const start = startVisible ? timeline.T1 : 0;

  return (
    <Svg width={sizePx} height={sizePx} viewBox="0 0 4.2333331 4.2333332" style={style}>
      {fade &&
        <style href={fade.name} precedence="default">{fade.keyframes}</style>
      }
      <G pointerEvents="none">
        {LOGO_16_RECT_COORDINATES.map((coord, index) => (
          <rect
            key={index}
            width={rectSize}
            height={rectSize}
            x={coord.x}
            y={coord.y}
            fill={color}
            style={fade && {
              ...fade.style,
              animationDelay: `${index * timeline.STAGGER - start}ms`,
            }}
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
