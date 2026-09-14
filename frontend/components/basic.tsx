import {
  Animated,
  Pressable,
  StyleProp,
  StyleSheet,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { ComponentProps, ReactNode } from 'react';
import { DefaultText } from './default-text';
import Ionicons from '@expo/vector-icons/Ionicons';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome'
import { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { useShake } from '../animation/animation';
import { showPointOfSale } from './modal/point-of-sale-modal';
import { useSignedInUser } from '../events/signed-in-user';
import { useAppTheme } from '../app-theme/app-theme';
import { themedSurface } from '../app-theme/surface';

type IoniconsName = ComponentProps<typeof Ionicons>['name'];
type BasicIcon = IconDefinition | IoniconsName;

const isIconDefinition = (x: any): x is IconDefinition => { // eslint-disable-line @typescript-eslint/no-explicit-any
  return x.iconName !== undefined;
};

const Icon = ({icon, textStyle}: {
  icon: BasicIcon,
  textStyle?: StyleProp<TextStyle>,
}) => {
  if (isIconDefinition(icon)) {
    const color = StyleSheet.flatten(textStyle)?.color;
    return <FontAwesomeIcon
      icon={icon}
      size={16}
      color={typeof color === 'string' ? color : undefined}
      style={{
        marginRight: 6,
      }}
    />
  } else {
    return <Ionicons
      style={[
        {
          fontSize: 16,
          marginRight: 6,
        },
        textStyle,
      ]}
      name={icon}
    />
  }
};

const Basic = ({children, ...rest}: {
  children?: ReactNode,
  icon?: BasicIcon,
  style?: StyleProp<ViewStyle>,
  textStyle?: StyleProp<TextStyle>,
  onPress?: () => boolean | void,
}) => {
  const {
    icon,
    style = {},
    textStyle = {},
    onPress,
  } = rest;

  const [shakeAnimation, startShake] = useShake();
  const [signedInUser] = useSignedInUser();
  const { appThemeName, appTheme } = useAppTheme();

  const chrome = themedSurface(
    appThemeName,
    appTheme.surface,
    StyleSheet.flatten(textStyle)?.color,
  );

  return (
    <Animated.View
      style={[
        {
          borderColor: chrome.borderColor,
          borderWidth: 1,
          borderRadius: 999,
          justifyContent: 'center',
          backgroundColor: chrome.backgroundColor,
          transform: [{ translateX: shakeAnimation }],
          flexShrink: 1,
        },
        style
      ]}
    >
      <Pressable
        disabled={!onPress}
        onPress={
          () => {
            if (!onPress) {
              return;
            }

            const success = onPress();
            if (success === false && signedInUser?.hasGold) {
              startShake();
            } else if (success === false && !signedInUser?.hasGold) {
              startShake();
              showPointOfSale('More clubs');
            }
          }
        }
        style={{
          paddingHorizontal: 12,
          paddingVertical: 6,
          alignItems: 'center',
          flexDirection: 'row',
          flexShrink: 1,
        }}
      >
        {icon && <Icon icon={icon} textStyle={textStyle} />}
        <DefaultText style={textStyle}>{children}</DefaultText>
      </Pressable>
    </Animated.View>
  );
};

const Basics = ({children}: {children?: ReactNode}) => {
  return (
    <View
      style={{
        zIndex: 999,
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 7,
      }}
    >
      {children}
    </View>
  );
};

export {
  Basic,
  Basics,
};
