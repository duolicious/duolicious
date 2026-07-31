import { useMemo } from 'react';
import { View, PixelRatio, StyleProp, ViewStyle } from 'react-native';
import { useOnline } from '../chat/application-layer/hooks/online';
import { ONLINE_COLOR, ONLINE_RECENTLY_COLOR } from '../constants/constants';
import {
  assertNever,
  friendlyTimeSince,
} from '../util/util';
import { useTimeSinceLabel } from '../util/clock';
import { useAppTheme } from '../app-theme/app-theme';
import { DefaultText } from './default-text';

const LABEL_FONT_SIZE_RATIO = 0.65;
const BADGE_PADDING_RATIO = 0.45;

const OnlineDot = ({
  outerD,
  innerD,
  coreD,
  style,
}: {
  outerD: number,
  innerD: number,
  coreD?: number,
  style?: StyleProp<ViewStyle>,
}) => {
  const { appTheme } = useAppTheme();

  return (
    <View
      // Using explicit width/height instead of "aspectRatio: 1" makes the
      // PixelRatio rounding actually take effect in layout.
      style={[
        {
          backgroundColor: appTheme.primaryColor,
          borderRadius: 999,
          width: outerD,
          height: outerD,
          justifyContent: 'center',
          alignItems: 'center',
        },
        style,
      ]}
    >
      <View
        style={{
          backgroundColor: ONLINE_COLOR,
          borderRadius: 999,
          width: innerD,
          height: innerD,
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        {coreD !== undefined &&
          <View
            style={{
              backgroundColor: appTheme.primaryColor,
              borderRadius: 999,
              width: coreD,
              height: coreD,
            }}
          />
        }
      </View>
    </View>
  );
};

const LastOnlineBadge = ({
  lastOnlineAt,
  outerD,
  innerD,
  ringW,
  fontSize,
  style,
}: {
  lastOnlineAt: number,
  outerD: number,
  innerD: number,
  ringW: number,
  fontSize: number,
  style?: StyleProp<ViewStyle>,
}) => {
  const { appTheme } = useAppTheme();
  const label = useTimeSinceLabel(lastOnlineAt, friendlyTimeSince);

  return (
    <View
      style={[
        {
          backgroundColor: appTheme.primaryColor,
          borderRadius: 999,
          height: outerD,
          paddingHorizontal: ringW,
          justifyContent: 'center',
          alignItems: 'center',
        },
        style,
      ]}
    >
      <View
        style={{
          backgroundColor: ONLINE_RECENTLY_COLOR,
          borderRadius: 999,
          height: innerD,
          minWidth: innerD,
          paddingHorizontal: PixelRatio.roundToNearestPixel(
            fontSize * BADGE_PADDING_RATIO),
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <DefaultText
          disableTheme
          style={{
            color: ONLINE_COLOR,
            fontSize,
            fontWeight: '700',
            includeFontPadding: false,
          }}
        >
          {label}
        </DefaultText>
      </View>
    </View>
  );
};

/**
 * Renders a small presence indicator: a dot while someone is online, or how
 * long ago they were last online (e.g. '3m', '5h', '23h') if that was within
 * the last day.
 *
 * The component historically suffered from sub‑pixel rounding issues on high‑dpi
 * screens that made the green dot appear slightly off‑centre.  The fix is to
 * snap *every* diameter value (outer circle, inner circle, and optional core)
 * to the device pixel‑grid using `PixelRatio.roundToNearestPixel`, so that the
 * layout engine never has to pick half‑pixels.
 *
 * We deliberately keep the three‑View nesting (white → green → white) because a
 * two‑layer solution that relies on `borderWidth` introduces an unwanted faint
 * border caused by antialiasing.
 */
const OnlineIndicator = ({
  personUuid,
  size,
  borderWidth,
  style,
}: {
  personUuid: string | null | undefined;
  /** Total diameter, in logical points. */
  size: number;
  /** Thickness of the white ring, in logical points. */
  borderWidth: number;
  /** Extra container styles. */
  style?: StyleProp<ViewStyle>,
}) => {
  const presence = useOnline(personUuid);

  /**
   * Snap all dimensions to the physical pixel‑grid.
   *
   * Rounding every value avoids half‑pixel placement that makes the dot look
   * visually off‑centre or blurry on some devices (especially Android phones
   * with odd device‑pixel‑ratio numbers).
   */
  const { outerD, innerD, coreD, ringW, fontSize } = useMemo(() => {
    const outer = PixelRatio.roundToNearestPixel(size);
    const ring  = PixelRatio.roundToNearestPixel(borderWidth);
    const inner = PixelRatio.roundToNearestPixel(outer - 2 * ring);

    return {
      outerD: outer,
      innerD: inner,
      coreD: PixelRatio.roundToNearestPixel(inner / 2),
      ringW: ring,
      fontSize: PixelRatio.roundToNearestPixel(
        inner * LABEL_FONT_SIZE_RATIO),
    };
  }, [size, borderWidth]);

  if (presence.status === 'offline') {
    return null;
  } else if (presence.status === 'online') {
    return <OnlineDot outerD={outerD} innerD={innerD} style={style} />;
  } else if (presence.status === 'online-recently') {
    // Servers predating `@seconds_ago` report the sighting without its age.
    return presence.lastOnlineAt === null ? (
      <OnlineDot
        outerD={outerD}
        innerD={innerD}
        coreD={coreD}
        style={style}
      />
    ) : (
      <LastOnlineBadge
        lastOnlineAt={presence.lastOnlineAt}
        outerD={outerD}
        innerD={innerD}
        ringW={ringW}
        fontSize={fontSize}
        style={style}
      />
    );
  } else {
    return assertNever(presence);
  }
};

export {
  OnlineIndicator,
};
