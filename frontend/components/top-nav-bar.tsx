import {
  View,
  ViewStyle,
} from 'react-native';
import { StatusBarSpacer } from './status-bar-spacer';
import { DefaultText } from './default-text';
import { Logo16 } from './logo';
import { isMobile } from '../util/util';
import { useAppTheme } from '../app-theme/app-theme';

const TOP_NAV_BAR_HEIGHT = 40;

const TopNavBar = (props: {
  containerStyle?: ViewStyle,
  style?: ViewStyle,
  backgroundColor?: string,
  children?: React.ReactNode,
}) => {
  const { appTheme } = useAppTheme();

  return (
    <View
      style={{
        backgroundColor: appTheme.primaryColor,
        zIndex: 999,
        width: '100%',
        overflow: 'visible',
        ...props.containerStyle,
      }}
    >
      <StatusBarSpacer/>
      <View
        style={{
          width: '100%',
          maxWidth: 600,
          height: TOP_NAV_BAR_HEIGHT,
          alignSelf: 'center',
          alignItems: 'center',
          justifyContent: 'center',
          ...props.style,
        }}
      >
        {props.children}
      </View>
    </View>
  );
};

const DuoliciousTopNavBar = (props: {
  style?: ViewStyle,
  backgroundColor?: string,
  textColor?: string,
  children?: React.ReactNode,
}) => {
  const {
    style,
    backgroundColor,
    textColor,
    children,
  } = props;

  const { appTheme } = useAppTheme();

  if (!isMobile() && !children) {
    return <View style={{ height: 10 }} />;
  }

  return (
    <TopNavBar
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 1,
        ...style,
      }}
      backgroundColor={backgroundColor}
    >
      {isMobile() && <>
        <Logo16
          size={16 * 2}
          color={appTheme.brandColor}
          rectSize={0.35}
        />
        <DefaultText
          style={{
            fontFamily: 'TruenoBold',
            color: textColor ?? appTheme.brandColor,
            fontSize: 22,
          }}
        >
          Duolicious
        </DefaultText>
        </>
      }
      {children}
    </TopNavBar>
  );
};

export {
  DuoliciousTopNavBar,
  TOP_NAV_BAR_HEIGHT,
  TopNavBar,
};
