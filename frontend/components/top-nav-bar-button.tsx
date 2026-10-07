import {
  ActivityIndicator,
  Pressable,
  View,
  ViewStyle,
} from 'react-native';
import {
  ComponentProps,
  useCallback,
} from 'react';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import { isMobile } from '../util/util';
import { DefaultText } from '../components/default-text';
import { useAppTheme } from '../app-theme/app-theme';
import { HoverCircle, hoverTransition, useHover } from './hover';

const TopNavBarButton = ({
  onPress,
  iconName,
  secondary,
  position,
  label,
  style,
  loading = false,
  overlayIconName,
}: {
  onPress: () => void
  iconName: ComponentProps<typeof Ionicons>['name']
  secondary: boolean
  position: 'left' | 'right' | null
  label?: string,
  style?: ViewStyle,
  loading?: boolean,
  overlayIconName?: ComponentProps<typeof Ionicons>['name'],
}) => {
  const opacity = useSharedValue(1);
  const opacityStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  const { appTheme } = useAppTheme();
  const { hovered, hoverProps } = useHover();

  const onPressIn = useCallback(() => {
    opacity.value = 0.2;
  }, []);

  const onPressOut = useCallback(() => {
    opacity.value = withTiming(1, { duration: 500 });
  }, []);

  return (
    <Pressable
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      onPress={onPress}
      style={{
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        ...(position === 'left' ? { left: 10 } : { }),
        ...(position === 'right' ? { right: 10 } : { }),
        ...(position === 'left' || position === 'right' ? {
          position: 'absolute',
          top: 0,
        } : { }),
        ...style,
      }}
      {...hoverProps}
    >
      <Animated.View style={[{
        backgroundColor: hovered && !secondary ? appTheme.hoverColor : 'transparent',
        borderColor: secondary || isMobile() ? undefined : appTheme.interactiveBorderColor,
        borderWidth: secondary || isMobile() ? undefined : 1,
        borderRadius: 7,
        padding: secondary || isMobile() ? undefined : 4,
        paddingHorizontal: !isMobile() && label ? 10 : undefined,
        aspectRatio: !isMobile() && label ? undefined : 1,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 5,
      }, hoverTransition(['backgroundColor']), opacityStyle]}>
        <HoverCircle visible={hovered && secondary} />
        {loading ?
          <ActivityIndicator
            size="small"
            color={appTheme.brandColor}
            style={{
              width: secondary || isMobile() ? 28 : 22,
              height: secondary || isMobile() ? 28 : 22,
            }}
          /> :
          <View>
            <Ionicons
              style={{
                color: appTheme.secondaryColor,
                fontSize: secondary || isMobile() ? 28 : 22,
              }}
              name={iconName}
            />
            {overlayIconName &&
              <Ionicons
                style={{
                  position: 'absolute',
                  right: -3,
                  bottom: -1,
                  color: appTheme.secondaryColor,
                  fontSize: secondary || isMobile() ? 16 : 12,
                  backgroundColor: appTheme.primaryColor,
                  borderRadius: 999,
                  overflow: 'hidden',
                }}
                name={overlayIconName}
              />
            }
          </View>
        }
        {!isMobile() && label &&
          <DefaultText style={{ fontWeight: '700' }}>
            {label}
          </DefaultText>
        }
      </Animated.View>
    </Pressable>
  );
};

export {
  TopNavBarButton,
};
