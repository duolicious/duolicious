import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { LogoActivityIndicator } from './logo/logo-activity-indicator';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  NativeStackScreenProps,
} from '@react-navigation/native-stack';
import type { NavigationProp } from '@react-navigation/native';
import type { ProfileParamList } from '../navigation/linking';
import {
  useCallback,
  useRef,
} from 'react';
import {
  DefaultText,
} from './default-text'
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome'
import { faUserPlus } from '@fortawesome/free-solid-svg-icons/faUserPlus'
import { TopNavBar } from './top-nav-bar';
import { TopNavBarButton } from './top-nav-bar-button';
import { SelectedClub } from './club-selector';
import { sortClubs, useJoinedClubs } from '../club/club';
import { ButtonWithCenteredText } from './button/centered-text';
import * as Clipboard from 'expo-clipboard';
import { notifyLinkCopiedToast } from './toast';
import { INVITE_URL } from '../env/env';
import { useAppTheme } from '../app-theme/app-theme';

const onPressInvite = (clubName: string) => async () => {
  const url = `${INVITE_URL}/${encodeURIComponent(clubName)}`;

  await Clipboard.setStringAsync(url);

  notifyLinkCopiedToast('Invite Link Copied!');
};

const InvitePicker = ({navigation}: NativeStackScreenProps<ProfileParamList, 'Invite Picker'>) => {
  const joined = useJoinedClubs();
  const clubs = joined && sortClubs(joined);

  const goBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  return (
    <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.safeAreaView}>
      <TopNavBar
        style={{
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <TopNavBarButton
          onPress={goBack}
          iconName="arrow-back"
          position="left"
          secondary={true}
        />
        <DefaultText
          style={{
            fontWeight: '700',
            fontSize: 20,
          }}
        >
          Invite to Your Clubs
        </DefaultText>
      </TopNavBar>

      <ScrollView
        contentContainerStyle={{
          maxWidth: 600,
          width: '100%',
          alignSelf: 'center',
          alignItems: 'stretch',
          padding: 10,
          paddingBottom: 50,
          gap: 10,
        }}
      >
        {clubs === undefined &&
          <View
            style={{
              alignItems: 'center',
              justifyContent: 'center',
              flexGrow: 1,
            }}
          >
            <LogoActivityIndicator size="large" color="#70f"/>
          </View>
        }
        {clubs !== undefined && clubs.length === 0 &&
          <DefaultText
            style={{
              fontFamily: 'Trueno',
              margin: '20%',
              textAlign: 'center'
            }}
          >
            Join a club to invite people
          </DefaultText>
        }
        {clubs && clubs.map((club, i) =>
          <View
            key={i}
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              width: '100%',
              overflow: 'hidden',
            }}
          >
            <SelectedClub name={club} />
            <ButtonWithCenteredText
              containerStyle={{
                height: 34,
                width: 100,
                paddingHorizontal: 10,
                marginTop: 0,
                marginBottom: 0,
              }}
              secondary={true}
              onPress={onPressInvite(club)}
            >
              Invite
            </ButtonWithCenteredText>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const InviteEntrypoint = ({navigation}: {navigation: NavigationProp<ProfileParamList>}) => {
  const { appTheme } = useAppTheme();

  const opacityLo = 0.2;
  const opacityHi = 1.0;

  const opacity = useRef(new Animated.Value(1)).current;

  const fade = () => {
    opacity.stopAnimation();
    opacity.setValue(opacityLo);
  };

  const unfade = () => {
    opacity.stopAnimation();
    Animated.timing(opacity, {
      toValue: opacityHi,
      duration: 1000,
      useNativeDriver: true,
    }).start();
  };

  const onPress = () => {
    navigation.navigate('Invite Picker');
  };

  return (
    <Pressable
      onPressIn={fade}
      onPressOut={unfade}
      onPress={onPress}
      style={{
        marginTop: 10,
        alignSelf: 'flex-end',
      }}
    >
      <Animated.View
        style={{
          justifyContent: 'center',
          alignItems: 'center',
          flexDirection: 'row',
          paddingHorizontal: 10,
          gap: 10,
          opacity,
        }}
      >
        <DefaultText>
          Invite To Clubs
        </DefaultText>
        <FontAwesomeIcon
          icon={faUserPlus}
          color={appTheme.secondaryColor}
          size={24}
        />
      </Animated.View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  safeAreaView: {
    flex: 1
  }
});

export {
  InviteEntrypoint,
  InvitePicker,
  onPressInvite,
};
