import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
} from 'react';
import {
  StyleSheet,
  View,
} from 'react-native';
import {
  HuePicker,
  HuePickerRef,
} from './hue-picker';
import {
  SaturationValuePicker,
  SaturationValuePickerRef,
} from './saturation-value-picker';
import {
  Hsv,
} from './util';

type HsvColorPickerProps = {
  onDragMove?: () => void;
}

type HsvColorPickerRef = {
  getHsv: () => Hsv;
  setHsv: (hsv: Hsv) => void;
};

const HsvColorPicker = forwardRef<
  HsvColorPickerRef,
  HsvColorPickerProps
>((props: HsvColorPickerProps, ref) => {
  const saturationValuePickerRef = useRef<SaturationValuePickerRef>(null);
  const huePickerRef = useRef<HuePickerRef>(null);

  const onHuePickerDragMove = useCallback(() => {
    const hue = huePickerRef.current?.getHue() ?? 0;
    saturationValuePickerRef.current?.setHue(hue);

    props.onDragMove && props.onDragMove();
  }, [props.onDragMove]);

  const getHsv = useCallback((): Hsv => [
    huePickerRef.current?.getHue() ?? 0,
    saturationValuePickerRef.current?.getSaturation() ?? 0,
    saturationValuePickerRef.current?.getValue() ?? 0,
  ], []);

  const setHsv = useCallback(([h, s, v]: Hsv) => {
    huePickerRef.current?.setHue(h);
    saturationValuePickerRef.current?.setHue(h);
    saturationValuePickerRef.current?.setSaturation(s);
    saturationValuePickerRef.current?.setValue(v);
  }, []);

  useImperativeHandle(ref, () => ({ getHsv, setHsv }), [getHsv, setHsv]);

  return (
    <View style={styles.container}>
      <SaturationValuePicker
        size={200}
        sliderSize={24}
        onDragMove={props.onDragMove}
        ref={saturationValuePickerRef}
      />
      <HuePicker
        barWidth={12}
        barHeight={200}
        sliderSize={24}
        onDragMove={onHuePickerDragMove}
        ref={huePickerRef}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export {
  HsvColorPicker,
  HsvColorPickerRef,
};
