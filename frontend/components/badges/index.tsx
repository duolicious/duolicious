import { View } from 'react-native';
import { DefaultText } from '../default-text';
import { Logo16 } from '../logo';
import { QAndADevice } from '../q-and-a-device';
import { useEffect, useRef, useState, Fragment } from 'react';
import Svg, { Polygon } from 'react-native-svg';
import { faPen } from '@fortawesome/free-solid-svg-icons/faPen'
import { faSeedling } from '@fortawesome/free-solid-svg-icons/faSeedling'
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, {
  Easing,
  PinwheelIn,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useTooltip } from '../tooltip';
import { WithDeferredMount } from '../with-deferred-mount';

const size = 20;

const durationColor = '#ff6bfa';

const Staff = ({
  label,
  tip,
  color = '#70f',
}: {
  label: string,
  tip: string,
  color?: string,
}) => {
  const { viewRef, props } = useTooltip(tip);

  return (
    <View
      ref={viewRef}
      style={{
          backgroundColor: color,
          borderRadius: 999,
          paddingLeft: 7,
          paddingRight: 8,
          height: size,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 2,
      }}
      {...props}
    >
      <Ionicons
        style={{
          fontSize: size / 3 * 2,
        }}
        color="white"
        name="shield-checkmark"
      />
      <DefaultText
        style={{
          fontSize: 12,
          color: 'white',
          fontWeight: 700,
        }}
      >
        {label.toUpperCase()}
      </DefaultText>
    </View>
  );
};

const Admin = () => <Staff label="admin" tip="Duolicious administrator" />;

const Bot = () => <Staff label="bot" tip="Duolicious bot" />;

const Mod = () => <Staff label="mod" tip="Duolicious moderator" color="black" />;

const Gold = ({
  style = {},
  doAnimate = true,
  color = "#ffd700",
  rectSize = undefined,
  enableTooltip = true,
}) => {
  const tooltip = useTooltip(`Has Gold membership`);

  const { viewRef = null, props = { } } = enableTooltip ? tooltip : { };

  return (
    <View
      ref={viewRef}
      style={{
        backgroundColor: '#70f',
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        ...style,
      }}
      {...props}
    >
      <WithDeferredMount randomDelay={{ min: 2000, max: 3000 }}>
        <Logo16
          size={16}
          rectSize={rectSize}
          color={color}
          doAnimate={doAnimate}
          doLoop={false}
        />
      </WithDeferredMount>
    </View>
  );
};

const QAndA = ({
  intervalMs = 400,  // time between each step
  step = 50,         // increment amount
  startAt = 0,
  target = 100,
  pauseMs = 3000,    // pause at target before looping
  color1 = "#004467",
  color2 = "#45ddc0",
  numLoops = Infinity,
}) => {
  const { viewRef, props } = useTooltip(`Answered ${target} Q&A`);

  const [count, setCount] = useState(startAt);
  const timerRef = useRef<NodeJS.Timeout>(null);
  const countRef = useRef(startAt);
  const loopsRef = useRef(0);

  useEffect(() => {
    // Ensure we start from startAt each time props change
    countRef.current = startAt;
    loopsRef.current = 0;

    const schedule = (delay: number, fn: () => void) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(fn, delay);
    };

    const tick = () => {
      const current = countRef.current;
      const next = current + step;

      if (next >= target) {
        // Step to target (if not already there), then maybe loop or stop
        if (current < target) {
          setCount(target);
          countRef.current = target;
          loopsRef.current += 1;
        }

        if (Number.isFinite(numLoops) && loopsRef.current >= numLoops) {
          return; // stop at target; do not schedule further ticks
        }

        // Pause at target, then reset to startAt and continue
        schedule(pauseMs, () => {
          setCount(startAt);
          countRef.current = startAt;
          schedule(intervalMs, tick);
        });
      } else {
        // Normal increment
        setCount(next);
        countRef.current = next;
        schedule(intervalMs, tick);
      }
    };

    // Kick off the loop after the first interval
    schedule(intervalMs, tick);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [startAt, step, target, intervalMs, pauseMs, numLoops]);

  return (
    <View
      ref={viewRef}
      style={{
        height: size,
        width: size,
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
      }}
      {...props}
    >
      <QAndADevice
        color={color2}
        height={size * 0.7}
        backgroundColor="transparent"
        isBold
      />
      <DefaultText
        style={{
          marginTop: -3,
          fontSize: 7,
          backgroundColor: color2,
          color: color1,
          borderRadius: 999,
          width: '100%',
          fontWeight: 700,
          textAlign: 'center',
        }}
      >
        {count}
      </DefaultText>
    </View>
  );
};

const QAndA200  = () =>
  <QAndA numLoops={3} target={200}  step={100} />

const QAndA500  = () =>
  <QAndA numLoops={3} target={500}  step={250} color2="orange" />

const QAndA1000 = () =>
  <QAndA numLoops={3} target={1000} step={500} color2="black" color1="white" />

const OneWeek = () => {
  const { viewRef, props } = useTooltip(`Member for a week`);

  return (
    <View
      ref={viewRef}
      style={{
        width: 0,
        height: 0,
        backgroundColor: 'transparent',
        borderStyle: 'solid',
        borderLeftWidth: size / 2,
        borderRightWidth: size / 2,
        borderBottomWidth: size,
        borderLeftColor: 'transparent',
        borderRightColor: 'transparent',
        borderBottomColor: durationColor,
      }}
      {...props}
    />
  );
};


const OneMonth = () => {
  const { viewRef, props } = useTooltip(`Member for a month`);

  const inner = size / Math.SQRT2; // tip-to-tip box of a 45° square

  return (
    <View
      ref={viewRef}
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'visible',
      }}
      {...props}
    >
      <View
        style={{
          width: inner,
          height: inner,
          backgroundColor: durationColor,
          transform: [{ rotate: '45deg' }],
        }}
      />
    </View>
  );
}

const OneYear = ({
  orientation = 'pointy',
}) => {
  const { viewRef, props } = useTooltip(`Member for a year`);

  const SQRT3 = Math.sqrt(3);

  // Flat-top hex viewBox is 2 : √3; Pointy-top is √3 : 2
  let viewBox, points;
  if (orientation === 'pointy') {
    // width = √3, height = 2
    viewBox = `0 0 ${SQRT3} 2`;
    points = [
      [SQRT3 / 2, 0],
      [SQRT3, 0.5],
      [SQRT3, 1.5],
      [SQRT3 / 2, 2],
      [0, 1.5],
      [0, 0.5],
    ]
      .map(([x, y]) => `${x},${y}`)
      .join(' ');
  } else {
    // flat-top (default): width = 2, height = √3
    viewBox = `0 0 2 ${SQRT3}`;
    points = [
      [0.5, 0],
      [1.5, 0],
      [2, SQRT3 / 2],
      [1.5, SQRT3],
      [0.5, SQRT3],
      [0, SQRT3 / 2],
    ]
      .map(([x, y]) => `${x},${y}`)
      .join(' ');
  }

  return (
    <View
      ref={viewRef}
      style={{
        height: size,
        width: size,
        alignItems: 'center',
        justifyContent: 'center',
      }}
      {...props}
    >
      <Svg
        width={size}
        height={size}
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet" // keep it regular; never distort
      >
        <Polygon points={points} fill={durationColor} />
      </Svg>
    </View>
  );
};

const BaseLongBio = ({ numLoops = Infinity }) => {
  const { viewRef, props } = useTooltip(`Has a long bio`);

  const iconSize = 14;
  const stepDuration = 200;

  const x = useSharedValue(0);
  const rot = useSharedValue(0);

  // A tiny “writing” path (all points are within 0..max)
  const path = [
    { x: 0, rot:   0 },
    { x: 0, rot: -10 },
    { x: 2, rot: -10 },
    { x: 0, rot: -10 },
    { x: 2, rot: -10 },
    { x: 0, rot: -10 },
    { x: 2, rot: -10 },
    { x: 0, rot:   0 },
    // Adds a delay before looping
    ...new Array(10).fill({ x: 0, rot: 0 })
  ];

  useEffect(() => {
    const reps = Number.isFinite(numLoops) ? numLoops : -1;

    // Move along the path, then repeat
    x.value = withRepeat(
      withSequence(
        ...path.map(p =>
          withTiming(p.x, { duration: stepDuration, easing: Easing.inOut(Easing.quad) })
        )
      ),
      reps,
      true,
    );

    // Subtle “write” tilt: tip forward, back past center a bit, then settle
    rot.value = withRepeat(
      withSequence(
        ...path.map(p =>
          withTiming(p.rot, { duration: stepDuration, easing: Easing.inOut(Easing.quad) })
        )
      ),
      reps,
      true,
    );
  }, [x, rot, path, stepDuration, numLoops]);

  const penStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value },
      { rotateZ: `${rot.value}deg` },
    ],
  }));

  return (
    <View
      ref={viewRef}
      style={{
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
      }}
      {...props}
    >
      <Animated.View
        style={[
          {
            position: 'absolute',
            alignItems: 'center',
            justifyContent: 'center',
            left: 0,
            top: 0,
            bottom: 0,
            right: 0,
          },
          penStyle
        ]}
      >
        <FontAwesomeIcon
          icon={faPen}
          size={iconSize}
          style={{ color: '#373990' }}
        />
      </Animated.View>
    </View>
  );
};

const LongBio = () => <BaseLongBio numLoops={3} />;

const EarlyAdopter = () => {
  const { viewRef, props } = useTooltip(
    `Joined Duolicious in its first year`
  );

  return (
    <View
      ref={viewRef}
      style={{
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
      }}
      {...props}
    >
      <FontAwesomeIcon
        icon={faSeedling}
        size={14}
        style={{color: '#3ba55d'}}
      />
    </View>
  );
};

const VoiceBio = () => {
  const { viewRef, props } = useTooltip(`Has a voice bio`);

  return (
    <View
      ref={viewRef}
      style={{
        height: size,
        width: size,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 999,
        backgroundColor: '#d10000',
      }}
      {...props}
    >
      <Ionicons
        disabled={true}
        style={{
          fontSize: size - 6,
          color: 'white',
          marginRight: -2,
        }}
        name="play"
      />
    </View>
  );
};

const Gif = () => {
  const { viewRef, props } = useTooltip(`Has an animated profile pic`);

  return (
    <View style={{ height: size, width: size }}>
      <WithDeferredMount randomDelay={{ min: 500, max: 1500 }}>
        <Animated.View
          ref={viewRef}
          style={{
            height: size,
            width: size,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 2,
            backgroundColor: '#28afff',
          }}
          entering={PinwheelIn}
          {...props}
        >
          <DefaultText
            style={{
              fontSize: 9,
              fontWeight: 600,
              textAlign: 'center',
              color: '#dff2ff',
            }}
          >
            GIF
          </DefaultText>
        </Animated.View>
      </WithDeferredMount>
    </View>
  );
};

const Flair = ({
  flair
}: {
  flair: string[]
}) => {
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: 3,
        flexWrap: 'wrap',
        minHeight: size,
      }}
    >
      {flair.map((f) =>
        <Fragment key={f}>
          {f === 'admin'         && <Admin />}
          {f === 'mod'           && <Mod />}
          {f === 'bot'           && <Bot />}
          {f === 'gold'          && <Gold />}
          {f === 'q-and-a-200'   && <QAndA200 />}
          {f === 'q-and-a-500'   && <QAndA500 />}
          {f === 'q-and-a-1000'  && <QAndA1000 />}
          {f === 'one-week'      && <OneWeek />}
          {f === 'one-month'     && <OneMonth />}
          {f === 'one-year'      && <OneYear />}
          {f === 'long-bio'      && <LongBio />}
          {f === 'early-adopter' && <EarlyAdopter />}
          {f === 'voice-bio'     && <VoiceBio />}
          {f === 'gif'           && <Gif />}
        </Fragment>
      )}
    </View>
  );
};

export {
  Flair,
  Gold,
};
