/*
 * Adapted from https://github.com/3DJakob/react-tinder-card at v1.6.2
 *
 */

import {
  JSX,
  ReactNode,
  Ref,
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
} from 'react';
import {
  Dimensions,
  PanResponder,
  PanResponderGestureState,
  Platform,
  ViewStyle,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { noSelect } from '../styles';

type Direction = 'left' | 'right' | 'up' | 'down' | 'none'
type SwipeHandler = (direction: Direction) => void
type CardLeftScreenHandler = (direction: Direction) => void

interface BaseQuizCardRef {
  /**
   * Programmatically trigger a swipe of the card in one of the valid directions `'left'`, `'right'`, `'up'` and `'down'`. This function, `swipe`, can be called on a reference of the BaseQuizCard instance.
   *
   * @param dir The direction in which the card should be swiped. One of: `'left'`, `'right'`, `'up'` and `'down'`.
   */
  swipe(dir?: Direction): Promise<void>

  /**
   * Restore swiped-card state. Use this function if you want to undo a swiped-card (e.g. you have a back button that shows last swiped card or you have a reset button. The promise is resolved once the card is returned
   */
  restoreCard (): Promise<void>
}

interface Props {
  ref?: Ref<BaseQuizCardRef>

  /**
   * Callback that will be executed when a swipe has been completed. It will be called with a single string denoting which direction the swipe was in: `'left'`, `'right'`, `'up'` or `'down'`.
   */
  onSwipe?: SwipeHandler

  /**
   * Callback that will be executed when a `BaseQuizCard` has left the screen. It will be called with a single string denoting which direction the swipe was in: `'left'`, `'right'`, `'up'` or `'down'`.
   */
  onCardLeftScreen?: CardLeftScreenHandler

  /**
   * An array of directions for which to prevent swiping out of screen. Valid arguments are `'left'`, `'right'`, `'up'` and `'down'`.
   *
   * @default []
   */
  preventSwipe?: string[]

  /**
   * Callback executed when the user releases a swipe in a direction listed in `preventSwipe` (i.e. an attempted-but-blocked swipe). The card has snapped back to its position by the time this fires.
   */
  onSwipePrevented?: SwipeHandler

   /**
   * The threshold of which to accept swipes. If swipeRequirementType is set to velocity it is the velocity threshold and if set to position it is the position threshold.
   * On native the default value is 1 as the physics works differently there.
   * If swipeRequirementType is set to position it is recommended to set this based on the screen width so cards can be swiped on all screen sizes.
   *
   * @default 300
   */
  swipeThreshold?: number

  /**
   * Style to add to the container.
   */
  containerStyle?: ViewStyle

  /**
   * The children passed in is what will be rendered as the actual card.
   */
  children?: ReactNode

  initialPosition?: Direction

  leftComponent?: JSX.Element
  rightComponent?: JSX.Element
  downComponent?: JSX.Element
}

const { height, width } = Dimensions.get('window');

const settings = {
  maxTilt: 20, // in deg
  rotationPower: 50,
  swipeThreshold: 0.5 // need to update this threshold for RN (1.5 seems reasonable...?)
}

type SpringConfig = {
  duration?: number;
  friction?: number;
  tension?: number;
};

type SpringStartParams = {
  x?: number;
  y?: number;
  rot?: number;
  config?: SpringConfig;
  immediate?: boolean;
  onResolve?: () => void;
};

type SpringStarter = { start: (args: SpringStartParams) => void };

// physical properties of the spring
const physics = {
  animateOut: {
    friction: 30,
    tension: 400
  },
  animateBack: {
    friction: 20,
    tension: 200
  }
}

const pythagoras = (x: number, y: number) => {
  return Math.sqrt(Math.pow(x, 2) + Math.pow(y, 2))
}

const normalize = (vector: { x: number; y: number }) => {
  const length = Math.sqrt(Math.pow(vector.x, 2) + Math.pow(vector.y, 2))
  return { x: vector.x / length, y: vector.y / length }
}

const rotateByDx = (dx: number) => {
  return Math.max(Math.min(dx * 0.05, settings.maxTilt), -settings.maxTilt)
}

const finalXyrot = (gesture: { x: number; y: number }) => {
  const finalX = diagonal() * normalize(gesture).x
  const finalY = diagonal() * normalize(gesture).y
  const finalRotation = rotateByDx(finalX)

  return {x: finalX, y: finalY, rot: finalRotation};
}

const diagonal = () => pythagoras(height, width)

const animateOut = async (
  gesture: { x: number; y: number },
  setSpringTarget: React.MutableRefObject<SpringStarter>,
  dir?: Direction
) => {
  const normalizedGesture = (() => {
    if (dir === 'right')
      return { x: Math.max( 2, gesture.x), y: gesture.y }
    if (dir === 'left')
      return { x: Math.min(-2, gesture.x), y: gesture.y }
    if (dir === 'up')
      return { x: gesture.x              , y: Math.min(-2, gesture.y) }
    if (dir === 'down')
      return { x: gesture.x              , y: Math.max( 2, gesture.y) }

    return gesture
  })();

  const velocity = pythagoras(normalizedGesture.x, normalizedGesture.y)
  const duration = diagonal() / velocity

  // We use timing for "animateOut" with a computed duration
  return new Promise((resolve) => {
    setSpringTarget.current.start({
      ...finalXyrot(normalizedGesture),
      config: { duration },
      onResolve: () => {
        resolve(undefined);
      },
    });
  });
}

const animateBack = (
  setSpringTarget: React.MutableRefObject<SpringStarter>
) => {
  return new Promise((resolve) => {
    setSpringTarget.current.start({
      x: 0,
      y: 0,
      rot: 0,
      config: physics.animateBack,
      onResolve: () => resolve(undefined),
    });
  });
}

const getSwipeDirection = (
  property: { x: number, y: number },
  swipeThreshold: number,
): Direction => {
  'worklet';

  if (Math.abs(property.x) > Math.abs(property.y)) {
    if (property.x > swipeThreshold) {
      return 'right'
    } else if (property.x < -swipeThreshold) {
      return 'left'
    }
  } else {
    if (property.y > swipeThreshold) {
      return 'down'
    } else if (property.y < -swipeThreshold) {
      return 'up'
    }
  }
  return 'none'
}

/**
 * Reanimated-based "start" function that mimics react-spring's .start() API.
 * - If `config.duration` is specified, we use `withTiming`.
 * - Otherwise we use `withSpring`.
 * - `immediate` updates the shared values instantly, no animation.
 * - `onResolve` is called at the end of the animation.
 */
function createSpringStarter(
  xSV: SharedValue<number>,
  ySV: SharedValue<number>,
  rotSV: SharedValue<number>
) {
  return (params: {
    x?: number;
    y?: number;
    rot?: number;
    config?: SpringConfig;
    immediate?: boolean;
    onResolve?: () => void;
  }) => {
    'worklet';

    const { x, y, rot, config, immediate, onResolve } = params;

    const runAnimation = (
      val: number | undefined,
      sharedVal: SharedValue<number>
    ) => {
      if (val === undefined) return;
      if (immediate) {
        // update instantly
        sharedVal.value = val;
        if (onResolve) {
          scheduleOnRN(onResolve);
        }
        return;
      }
      // If there's a duration, use timing; otherwise spring
      if (config?.duration !== undefined) {
        sharedVal.value = withTiming(
          val,
          { duration: config.duration },
          (isFinished) => {
            if (isFinished && onResolve) {
              scheduleOnRN(onResolve);
            }
          }
        );
      } else {
        // approximate friction/tension with reanimated's damping/stiffness
        sharedVal.value = withSpring(
          val,
          { duration: 750, dampingRatio: 0.7 },
          (isFinished) => {
            if (isFinished && onResolve) {
              scheduleOnRN(onResolve);
            }
          }
        );
      }
    };

    runAnimation(x, xSV);
    runAnimation(y, ySV);
    runAnimation(rot, rotSV);
  };
}

const BaseQuizCard = forwardRef(
  (
    {
      children,
      onSwipe,
      onCardLeftScreen,
      onSwipePrevented,
      preventSwipe = [],
      swipeThreshold = settings.swipeThreshold,
      containerStyle,
      initialPosition,
      leftComponent,
      rightComponent,
      downComponent
    }: Props,
    ref: React.Ref<BaseQuizCardRef>
  ) => {
    // True only while the card is flicked away / leaving the screen. A
    // spring-back to center does NOT set this, so the card can be re-grabbed
    // (and the buttons stay responsive) mid-animation.
    const isSwipingOut = useRef(false);

    const preventSwipeRef = useRef(preventSwipe);
    preventSwipeRef.current = preventSwipe;

    // Compute initial x, y, rot
    const startPosition = (() => {
      if (initialPosition === 'left')  return finalXyrot({x: -1, y:  0})
      if (initialPosition === 'right') return finalXyrot({x:  1, y:  0})
      if (initialPosition === 'up')    return finalXyrot({x:  0, y: -1})
      if (initialPosition === 'down')  return finalXyrot({x:  0, y:  1})
      return {x: 0, y: 0, rot: 0};
    })();

    const x = useSharedValue(startPosition.x);
    const y = useSharedValue(startPosition.y);
    const rot = useSharedValue(startPosition.rot);

    // We'll store an array with a single object that has .start(...) to match your usage
    const setSpringTarget = useRef({ start: createSpringStarter(x, y, rot) });

    useImperativeHandle(ref, () => ({
      async swipe (dir: Direction = 'right') {
        if (isSwipingOut.current) return;
        isSwipingOut.current = true;

        if (onSwipe) onSwipe(dir)
        const power = 2.0
        const disturbance = (Math.random() - 0.5) / 2
        if (dir === 'right') {
          await animateOut({ x:  power, y: disturbance }, setSpringTarget)
        } else if (dir === 'left') {
          await animateOut({ x: -power, y: disturbance }, setSpringTarget)
        } else if (dir === 'up') {
          await animateOut({ x: disturbance, y: -power }, setSpringTarget)
        } else if (dir === 'down') {
          await animateOut({ x: disturbance, y:  power }, setSpringTarget)
        }
        if (onCardLeftScreen) onCardLeftScreen(dir)
      },
      async restoreCard () {
        await animateBack(setSpringTarget)
        isSwipingOut.current = false;
      }
    }));

    const handleSwipeReleased = useCallback(
      async (
        setSpringTarget: React.MutableRefObject<SpringStarter>,
        gesture: PanResponderGestureState
      ) => {
        // Check if this is a swipe
        const dir = getSwipeDirection(
          { x: gesture.dx, y: gesture.dy },
          swipeThreshold
        );

        if (dir === 'none' || preventSwipeRef.current.includes(dir)) {
          // Card was not flicked away, animate back to start
          await animateBack(setSpringTarget)
          if (dir !== 'none' && onSwipePrevented) onSwipePrevented(dir)
        } else {
          isSwipingOut.current = true;
          if (onSwipe) onSwipe(dir)

          await animateOut(
            {x: gesture.vx, y: gesture.vy},
            setSpringTarget,
            dir,
          )

          if (onCardLeftScreen) onCardLeftScreen(dir)
        }
      },
      [onSwipe, onCardLeftScreen, onSwipePrevented]
    );

    const panResponder = useRef(
      PanResponder.create({
        // Ask to be the responder:
        onStartShouldSetPanResponder:
          () => false,
        onStartShouldSetPanResponderCapture:
          () => false,
        onMoveShouldSetPanResponder:
          () => !isSwipingOut.current,
        onMoveShouldSetPanResponderCapture:
          () => !isSwipingOut.current,
        onPanResponderGrant: (evt) => {
          if (Platform.OS === 'web') {
            evt.preventDefault?.();
          }
        },
        onPanResponderMove: (evt, gestureState) => {
          if (Platform.OS === 'web') {
            evt.preventDefault?.();
          }

          // use guestureState.vx / guestureState.vy for velocity calculations
          // translate element
          setSpringTarget.current.start({
            x: gestureState.dx,
            y: gestureState.dy,
            rot: rotateByDx(gestureState.dx),
            immediate: true,
          })
        },
        onPanResponderTerminationRequest: () => {
          return true;
        },
        onPanResponderRelease: (evt, gestureState) => {
          // The user has released all touches while this view is the
          // responder. This typically means a gesture has succeeded
          // enable
          handleSwipeReleased(setSpringTarget, gestureState)
        }
      })
    ).current;

    // Main card style
    const cardStyle = useAnimatedStyle(() => {
      return {
        transform: [
          { translateX: x.value },
          { translateY: y.value },
          { rotate: `${rot.value}deg` },
        ],
      };
    });

    // Left indicator style
    const leftComponentStyle = useAnimatedStyle(() => {
      const dir = getSwipeDirection({ x: x.value, y: y.value }, 0);
      return {
        position: 'absolute',
        width: '100%',
        height: '100%',
        opacity:
          dir === 'left'
            ? Math.max(0.0, -x.value * 0.01 - 0.5)
            : 0.0,
        transform: [{ rotate: `${-rot.value}deg` }],
      };
    });

    // Right indicator style
    const rightComponentStyle = useAnimatedStyle(() => {
      const dir = getSwipeDirection({ x: x.value, y: y.value }, 0);
      return {
        position: 'absolute',
        width: '100%',
        height: '100%',
        opacity:
          dir === 'right'
            ? Math.max(0.0, x.value * 0.01 - 0.5)
            : 0.0,
        transform: [{ rotate: `${-rot.value}deg` }],
      };
    });

    // Down indicator style
    const downComponentStyle = useAnimatedStyle(() => {
      const dir = getSwipeDirection({ x: x.value, y: y.value }, 0);
      return {
        position: 'absolute',
        width: '100%',
        height: '100%',
        opacity:
          dir === 'down'
            ? Math.max(0.0, y.value * 0.01 - 0.5)
            : 0.0,
        transform: [{ rotate: `${-rot.value}deg` }],
      };
    });

    return (
      <Animated.View
        {...panResponder.panHandlers}
        style={[
          noSelect,
          cardStyle,
          containerStyle
        ]}
      >
        {/* Actual card content */}
        {children}

        {/* Left indicator */}
        <Animated.View pointerEvents="none" style={leftComponentStyle}>
          {leftComponent}
        </Animated.View>

        {/* Right indicator */}
        <Animated.View pointerEvents="none" style={rightComponentStyle}>
          {rightComponent}
        </Animated.View>

        {/* Down indicator */}
        <Animated.View pointerEvents="none" style={downComponentStyle}>
          {downComponent}
        </Animated.View>
      </Animated.View>
    )
  }
)

export {
  BaseQuizCard,
  BaseQuizCardRef,
  Direction,
}
