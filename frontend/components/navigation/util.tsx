import { Platform, View } from 'react-native';
import { QAndADevice } from '../q-and-a-device';
import { Gold } from '../badges';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSignedInUser } from '../../events/signed-in-user';
import { isMobile } from '../../util/util';
import { DefaultText } from '../default-text';
import { useNumVisitors } from '../../chat/application-layer/hooks/visitors';

const NumberBadge = ({ num, left, borderColor, backgroundColor, color }: {
  num: number
  left: number
  borderColor: string
  backgroundColor: string
  color: string
}) => {
  const cappedNum = Math.min(num, 99);
  const maybePlus = num > 99 ? '+' : '';

  if (num <= 0) {
    return null;
  }

  return (
    <View
      style={{
        position: 'absolute',
        top: -3,
        left,
        flex: 1,
        flexWrap: 'nowrap',
        borderRadius: 8,
        paddingLeft: 6,
        // Android doesn't center the child DefaultText element properly
        // for some reason, so here's a hack.
        paddingRight: Platform.OS === 'android' ? 5 : 6,
        paddingVertical: 1,
        borderWidth: 1,
        borderColor,
        backgroundColor,
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <DefaultText
        style={{
          textAlign: 'center',
          fontFamily: 'TruenoBold',
          fontSize: 12,
          color,
        }}
        ellipsizeMode="clip"
        numberOfLines={1}
      >
        {`${cappedNum}${maybePlus}`}
      </DefaultText>
    </View>
  );
};

const LabelToIcon = ({
  label,
  isFocused,
  numUnread,
  indicatorColor,
  indicatorBackgroundColor,
  indicatorBorderColor,
  color,
  backgroundColor,
  fontSize = 20,
}: {
  label: string
  isFocused: boolean
  numUnread: number
  indicatorColor: string
  indicatorBackgroundColor: string
  indicatorBorderColor: string
  color: string
  backgroundColor: string
  fontSize?: number
}) => {
  const [signedInUser] = useSignedInUser();
  const numVisitors = useNumVisitors();

  const searchIcon =
    isFocused ? 'search' : 'search-outline';
  const inboxIcon =
    isFocused ? 'chatbubbles' : 'chatbubbles-outline';
  const visitorsIcon =
    isFocused ? 'people' : 'people-outline';
  const feedIcon =
    isFocused ? 'planet' : 'planet-outline';
  const profileIcon =
    isFocused ? 'person' : 'person-outline';

  const height = fontSize + 2;

  const iconStyle = {
    fontSize: fontSize,
    color: color,
    height,
  };

  return (
    <>
      {label === 'Q&A' &&
        <QAndADevice
          color={color}
          height={height}
          isBold={isFocused}
          backgroundColor={backgroundColor}
        />
      }
      {label === 'Search' &&
        <Ionicons style={{...iconStyle}} name={searchIcon}/>
      }
      {label === 'Visitors' &&
        <View>
          <Ionicons style={{...iconStyle}} name={visitorsIcon}/>
          {!isFocused &&
            <NumberBadge
              num={numVisitors}
              left={Math.round(fontSize * 0.85)}
              borderColor={indicatorBorderColor}
              backgroundColor={indicatorBackgroundColor}
              color={indicatorColor}
            />
          }
        </View>
      }
      {label === 'Feed' &&
        <Ionicons style={{...iconStyle}} name={feedIcon}/>
      }
      {label === 'Inbox' &&
        <View>
          <Ionicons style={{...iconStyle}} name={inboxIcon}/>
          <NumberBadge
            num={numUnread}
            left={Math.round(fontSize * 0.85)}
            borderColor={indicatorBorderColor}
            backgroundColor={indicatorBackgroundColor}
            color={indicatorColor}
          />
        </View>
      }
      {label === 'Profile' &&
        <View>
          {!!signedInUser?.hasGold &&
            <Gold
              style={{
                position: 'absolute',
                top: -4,
                right: -14,
                backgroundColor: 'transparent',
              }}
              color={color}
              doAnimate={false}
              enableTooltip={!isMobile()}
            />
          }
          <Ionicons style={{...iconStyle}} name={profileIcon}/>
        </View>
      }
    </>
  );
};

export {
  LabelToIcon,
}
