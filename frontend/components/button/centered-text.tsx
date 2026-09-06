import {
  Animated,
  Pressable,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import {
  ReactNode,
  RefObject,
  useRef,
} from 'react';
import { LogoActivityIndicator } from '../logo/logo-activity-indicator';
import { DefaultText } from '../default-text';
import { useAppTheme } from '../../app-theme/app-theme';

type ButtonWithCenteredTextApi = {
  isEnabled: (value: boolean) => void
  doPressAnimation: () => void
};

type ButtonWithCenteredTextProps = {
  children?: ReactNode
  extraChildren?: ReactNode
  icon?: ReactNode
  innerRef?: RefObject<ButtonWithCenteredTextApi | undefined>
  backgroundColor?: string
  borderColor?: string
  borderWidth?: number
  containerStyle?: ViewStyle
  textStyle?: TextStyle
  onPress?: () => void
  secondary?: boolean
  textColor?: string
  fontSize?: number
  loading?: boolean
};

const ButtonWithCenteredText = (props: ButtonWithCenteredTextProps) => {
  const {
    children,
    extraChildren,
    icon,
    innerRef,
    backgroundColor,
    borderColor,
    borderWidth,
    containerStyle,
    textStyle,
    onPress,
    secondary,
    textColor,
    fontSize,
    loading = false,
  } = props;

  const { appTheme } = useAppTheme();
  const isEnabledRef = useRef(true);

  const opacityLo = 0.2;
  const opacityHi = 1.0;

  const animatedOpacity = useRef(new Animated.Value(1)).current;

  const fade = (callback?: () => void) => {
    Animated.timing(animatedOpacity, {
      toValue: opacityLo,
      duration: 0,
      useNativeDriver: true,
    }).start((result) => result.finished && callback?.())
  };

  const unfade = (callback?: () => void) => {
    Animated.timing(animatedOpacity, {
      toValue: opacityHi,
      duration: 1000,
      useNativeDriver: true,
    }).start((result) => result.finished && callback?.())
  };

  class Api {
    isEnabled(value: boolean) {
      if (value === isEnabledRef.current) {
        ;
      } else if (value) {
        unfade();
      } else {
        fade();
      }

      isEnabledRef.current = value;
    }

    doPressAnimation() {
      fade(() => unfade());
    }
  };

  if (innerRef !== undefined) {
    innerRef.current = new Api();
  }

  return (
    <Pressable
      style={{
        // @ts-ignore – 'outline' is a web-only style prop
        outline: 'none',
        marginTop: 10,
        marginBottom: 10,
        height: 50,
        ...containerStyle,
      }}
      onPressIn={() => isEnabledRef.current && fade()}
      onPressOut={() => isEnabledRef.current && unfade()}
      onPress={() => isEnabledRef.current && !loading && onPress?.()}
    >
      <Animated.View
        style={{
          width: '100%',
          height: (
            'height' in (containerStyle ?? {}) &&
            containerStyle?.height === undefined
          ) ? undefined : '100%',
          borderRadius: 999,
          borderColor: borderColor === undefined ? 'black' : borderColor,
          borderWidth: borderWidth === undefined ? (secondary ? 1 : 0) : borderWidth,
          backgroundColor: backgroundColor || (secondary ? appTheme.primaryColor : '#70f'),
          opacity: animatedOpacity,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {loading &&
          <LogoActivityIndicator
            size="large"
            color={textColor || (secondary ? "#70f" : appTheme.primaryColor)}
          />
        }
        {!loading && children &&
          <DefaultText
            style={{
              color: textColor || (secondary ? appTheme.secondaryColor : 'white'),
              fontSize: fontSize || 16,
              textAlign: 'center',
              ...textStyle,
            }}
          >
            {children}
          </DefaultText>
        }
        {!loading && extraChildren}
        {!loading && icon &&
          <View
            style={{
              position: 'absolute',
              left: 18,
              top: 0,
              bottom: 0,
              justifyContent: 'center',
            }}
            pointerEvents="none"
          >
            {icon}
          </View>
        }
      </Animated.View>
    </Pressable>
  );
}

export {
  ButtonWithCenteredText,
  ButtonWithCenteredTextApi,
}
