import {
  Pressable,
} from 'react-native';
import { FC } from 'react';
import { NavigationProp, ParamListBase } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LogoActivityIndicator } from '../logo/logo-activity-indicator';
import { DefaultText } from '../default-text';
import { useAppTheme } from '../../app-theme/app-theme';
import { usePressableAnimation } from '../../animation/animation';
import { hoverTransition } from '../hover';
import { setOptionScreenPayload } from '../../navigation/option-screen-store';
import { OptionGroup, OptionGroupInputs } from '../../data/option-groups';
import Animated from 'react-native-reanimated';

type ButtonForOptionProps = {
  onPress?: () => void;
  onSubmitSuccess?: () => void;
  label?: string;
  icon?: FC<{ color?: string }>;
  optionGroups?: OptionGroup<OptionGroupInputs>[];
  setting?: string;
  noSettingText?: string;
  showSkipButton?: boolean;
  navigationScreen?: string;
  navigation?: NavigationProp<ParamListBase>;
  loading?: boolean;
};

const ButtonForOption = (props: ButtonForOptionProps) => {
  const {
    onPress,
    onSubmitSuccess,
    label,
    icon,
    optionGroups,
    setting,
    noSettingText = 'Unanswered',
    showSkipButton,
    navigationScreen,
    navigation,
    loading = false,
  } = props;

  if ((label === undefined) === (optionGroups === undefined)) {
    throw Error("Exactly one of `label` and `optionGroups` must be set");
  }

  if ((onPress === undefined) === (navigationScreen === undefined)) {
    throw Error("Exactly one of `onPress` and `navigationScreen` must be set");
  }

  if ((navigation === undefined) !== (navigationScreen === undefined)) {
    throw Error("`navigation` and `navigationScreen` must be set together");
  }

  const Icon_ = icon ?? (optionGroups ? optionGroups[0]?.Icon : undefined);
  const label_ = label ?? optionGroups?.[0]?.title

  const { appTheme } = useAppTheme();
  const {
    backgroundStyle,
    onPressIn,
    onPressOut,
    hovered,
    hoverProps,
  } = usePressableAnimation();

  // Built fresh each render so the captured `optionGroups` reflect the latest
  // store-derived values; memoizing would freeze them at first-render values
  // and re-clicking a button would push stale data into the OptionScreen.
  const onPress_ = onPress ?? (() => {
    if (!navigation || !navigationScreen || !optionGroups) {
      return;
    }
    // Stash the non-serializable payload (option-group definitions, callbacks)
    // in an in-memory store so navigation params stay URL-safe. The target
    // OptionScreen reads the payload using its own route name as the key.
    setOptionScreenPayload(navigationScreen, {
      optionGroups,
      ...(onSubmitSuccess !== undefined ? { onSubmitSuccess } : {}),
      ...(showSkipButton !== undefined ? { showSkipButton } : {}),
    });
    navigation.navigate(navigationScreen);
  });

  return (
    <Pressable
      style={{
        marginTop: 5,
        marginBottom: 5,
        height: 40,
      }}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      onPress={onPress_}
      {...hoverProps}
    >
      <Animated.View
        style={[{
          width: '100%',
          height: '100%',
          borderColor: appTheme.interactiveBorderColor,
          borderWidth: 1,
          borderBottomWidth: 2,
          borderRadius: 999,
          paddingLeft: 10,
          paddingRight: 20,
          alignItems: 'center',
          flexDirection: 'row',
          justifyContent: 'space-between',
        }, backgroundStyle]}
      >
        {Icon_ &&
          <Icon_ color={appTheme.secondaryColor} />
        }
        <DefaultText
          style={{
            marginLeft: Icon_ ? 5 : 15,
            fontSize: 16,
          }}
        >
          {label_}
        </DefaultText>
        <DefaultText
          style={{
            paddingLeft: 20,
            paddingRight: 10,
            ...((setting ?? noSettingText) === noSettingText ? {
              color: '#888888',
              fontStyle: 'italic',
            } : {
            }),
            textAlign: 'right',
            flex: 1,
          }}
          numberOfLines={1}
        >
          {setting ?? noSettingText}
        </DefaultText>
        {loading &&
          <LogoActivityIndicator
            style={{
              position: 'absolute',
              right: 15,
            }}
            size="small"
            color={appTheme.brandColor}
          />
        }
        {!loading &&
          <Animated.View
            style={[
              { position: 'absolute', right: hovered ? 2 : 5 },
              hoverTransition(['right']),
            ]}
          >
            <Ionicons
              style={{
                fontSize: 20,
                color: appTheme.secondaryColor,
              }}
              name="chevron-forward"
            />
          </Animated.View>
        }
      </Animated.View>
    </Pressable>
  );
}

export {
  ButtonForOption,
  ButtonForOptionProps,
};
