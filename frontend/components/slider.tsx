import { useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useAppTheme } from '../app-theme/app-theme';
import { DefaultText } from './default-text';
import { LINEAR_SCALE, Scale } from '../scales/scales';

const THUMB_SIZE = 32;
const PURPLE = '#70f';

type SliderLabel = {
  text: string
  unit?: string
  isAny?: boolean
};

type SliderUnits = {
  unitsLabel: string
  valueRewriter?: (value: number) => string
};

const formatSliderValue = (value: number, { valueRewriter }: SliderUnits) =>
  valueRewriter ? valueRewriter(value) : value.toLocaleString('en');

const sliderLabel = (
  slider: SliderUnits & { sliderMax: number, unlimitedLabel?: string },
  value: number,
): SliderLabel =>
  slider.unlimitedLabel && value === slider.sliderMax ?
    { text: slider.unlimitedLabel, isAny: true } :
    { text: formatSliderValue(value, slider), unit: slider.unitsLabel };

const rangeSliderLabel = (
  title: string,
  slider: SliderUnits & { sliderMin: number, sliderMax: number },
  [min, max]: number[],
): SliderLabel => {
  const format = (value: number) => formatSliderValue(value, slider);

  if (min === slider.sliderMin && max === slider.sliderMax) {
    return { text: `Any ${title.toLowerCase()}`, isAny: true };
  } else if (min === slider.sliderMin) {
    return { text: `Up to ${format(max)}` };
  } else if (max === slider.sliderMax) {
    return { text: `${format(min)} and over` };
  } else {
    return { text: `${format(min)}–${format(max)}`, unit: slider.unitsLabel };
  }
};

const Slider = ({
  minimumValue,
  maximumValue,
  values,
  hollow = [],
  onValuesChange,
  onSlidingComplete,
  scale = LINEAR_SCALE,
}: {
  minimumValue: number
  maximumValue: number
  values: number[]
  hollow?: boolean[]
  onValuesChange: (values: number[]) => void
  onSlidingComplete?: (values: number[]) => void
  scale?: Scale
}) => {
  const { appTheme } = useAppTheme();
  const [trackWidth, setTrackWidth] = useState(0);

  const range = maximumValue - minimumValue;
  const toFraction = (value: number) =>
    (scale.descaleValue(value, minimumValue, maximumValue) - minimumValue) /
    range;
  const toValue = (fraction: number) => Math.round(
    scale.scaleValue(minimumValue + fraction * range, minimumValue, maximumValue));

  const latest = useRef({
    values, trackWidth, toFraction, toValue, onValuesChange, onSlidingComplete,
  });
  latest.current = {
    values, trackWidth, toFraction, toValue, onValuesChange, onSlidingComplete,
  };

  const drag = useRef<{
    index: number | null
    startFraction: number
    values: number[]
  }>({
    index: null,
    startFraction: 0,
    values,
  });

  const gestures = useMemo(() => [0, 1].map((index) =>
    Gesture.Pan()
      .runOnJS(true)
      .minDistance(0)
      .onStart(() => {
        const { values, toFraction } = latest.current;
        drag.current = {
          index: values[0] === values[1] ? null : index,
          startFraction: toFraction(values[index]),
          values,
        };
      })
      .onUpdate((e) => {
        const { values, trackWidth, toValue, onValuesChange } = latest.current;
        if (drag.current.index === null && e.translationX !== 0) {
          drag.current.index = e.translationX < 0 ? 0 : 1;
        }
        const i = drag.current.index ?? index;
        const fraction = Math.min(1, Math.max(0,
          drag.current.startFraction + e.translationX / trackWidth));
        const value = Math.min(
          values[i + 1] ?? maximumValue,
          Math.max(values[i - 1] ?? minimumValue, toValue(fraction)));
        if (value !== values[i]) {
          drag.current.values = values.map((v, j) => j === i ? value : v);
          onValuesChange(drag.current.values);
        }
      })
      .onEnd(() => latest.current.onSlidingComplete?.(drag.current.values)),
  ), [minimumValue, maximumValue]);

  const onLayout = (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width - THUMB_SIZE;
    if (width > 0) {
      setTrackWidth(width);
    }
  };

  const fractions = values.map(toFraction);
  const hasFill = values.length === 2 && !(hollow[0] && hollow[1]);

  return (
    <View
      style={[styles.container, { opacity: trackWidth ? 1 : 0 }]}
      onLayout={onLayout}
    >
      <View
        style={[
          styles.track,
          { backgroundColor: appTheme.interactiveBorderColor },
        ]}
      />
      {hasFill &&
        <View
          style={[
            styles.fill,
            {
              left: THUMB_SIZE / 2 + fractions[0] * trackWidth,
              width: (fractions[1] - fractions[0]) * trackWidth,
            },
          ]}
        />
      }
      {fractions.map((fraction, i) =>
        <GestureDetector key={i} gesture={gestures[i]}>
          <View
            style={[
              styles.thumb,
              {
                left: fraction * trackWidth,
                backgroundColor: hollow[i] ? appTheme.primaryColor : PURPLE,
              },
            ]}
          />
        </GestureDetector>
      )}
    </View>
  );
};

const SliderValue = ({ label, inHeading = false }: {
  label: SliderLabel
  inHeading?: boolean
}) => {
  const { appTheme } = useAppTheme();

  if (inHeading) {
    return (
      <DefaultText
        style={[
          styles.headingValue,
          label.isAny ?
            { color: appTheme.hintColor, fontStyle: 'italic' } :
            { color: appTheme.brandColor, fontWeight: '600' },
        ]}
      >
        {label.unit ? `${label.text} ${label.unit}` : label.text}
      </DefaultText>
    );
  }

  return (
    <View style={styles.largeValue}>
      <DefaultText
        style={
          label.isAny ?
            { color: appTheme.hintColor, fontStyle: 'italic', fontSize: 26 } :
            { color: appTheme.brandColor, fontWeight: '800', fontSize: 32 }
        }
      >
        {label.text}
      </DefaultText>
      {!!label.unit &&
        <DefaultText style={[styles.largeUnit, { color: appTheme.hintColor }]}>
          {label.unit}
        </DefaultText>
      }
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    height: 40,
    justifyContent: 'center',
  },
  track: {
    height: 4,
    borderRadius: 2,
    marginHorizontal: THUMB_SIZE / 2,
  },
  fill: {
    position: 'absolute',
    height: 4,
    backgroundColor: PURPLE,
  },
  thumb: {
    position: 'absolute',
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    borderWidth: 3,
    borderColor: PURPLE,
  },
  headingValue: {
    flex: 1,
    textAlign: 'right',
  },
  largeValue: {
    height: 44,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 8,
  },
  largeUnit: {
    fontSize: 16,
    fontWeight: '500',
  },
});

export {
  Slider,
  SliderValue,
  rangeSliderLabel,
  sliderLabel,
};
