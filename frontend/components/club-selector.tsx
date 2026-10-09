import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { LogoActivityIndicator } from './logo/logo-activity-indicator';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ProfileParamList } from '../navigation/linking';
import {
  useCallback,
  useState,
} from 'react';
import Animated from 'react-native-reanimated';
import { DefaultText } from './default-text';
import { TopNavBar } from './top-nav-bar';
import { Title } from './title';
import Ionicons from '@expo/vector-icons/Ionicons';
import { DefaultTextInput } from './default-text-input';
import * as _ from "lodash";
import { Basic } from './basic';
import {
  ClubItem,
  clubQuota,
  fetchClubItems,
  joinClub,
  leaveClub,
  sortClubs,
  useJoinedClubs,
} from '../club/club';
import { useShake } from '../animation/animation';
import { useSignedInUser } from '../events/signed-in-user';
import { showPointOfSale } from './modal/point-of-sale-modal';
import { useAppTheme } from '../app-theme/app-theme';

const SelectedClub = ({
  name,
  onPress,
}: {
  name: string
  onPress?: (name: string) => void
}) => {
  const { appThemeName } = useAppTheme();

  const textColor = appThemeName === 'dark' ? '#ffffff' : '#7700ff';

  return (
    <Pressable
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        flexShrink: 1,
      }}
      disabled={!onPress}
      onPress={onPress && (() => onPress(name))}
    >
      <Basic
        // Styled like the prospect profile's mutual clubs: bold, with the
        // border taking the chip's text color
        style={{
          backgroundColor: appThemeName === 'dark'
            ? 'rgba(119, 0, 255, 1.0)'
            : 'rgba(119, 0, 255, 0.1)',
          flexShrink: 1,
          borderBottomWidth: 3,
          borderColor: textColor,
        }}
        textStyle={{
          color: textColor,
          fontFamily: 'TruenoBold',
          fontWeight: '900',
        }}
      >
        {name}
      </Basic>
    </Pressable>
  );
};

const UnselectedClub = ({
  clubItem,
  onPress,
  isAtQuota,
}: {
  clubItem: ClubItem
  onPress: (clubItem: ClubItem) => void
  isAtQuota: boolean
}) => {
  const { shakeStyle, startShake } = useShake();
  const [signedInUser] = useSignedInUser();

  const _onPress = useCallback(() => {
    if (isAtQuota) {
      startShake();
      if (!signedInUser?.hasGold) {
        showPointOfSale('clubs');
      }
    } else {
      onPress(clubItem)
    }
  }, [isAtQuota, onPress, clubItem, startShake, signedInUser?.hasGold]);

  return (
    <Animated.View
      style={[
        {
          opacity: isAtQuota && signedInUser?.hasGold ? 0.3 : 1,
          transitionProperty: 'opacity',
          transitionDuration: 300,
        },
        shakeStyle,
      ]}
    >
      <Pressable
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 5,
        }}
        onPress={_onPress}
      >
        <Basic
          style={{
            marginTop: 5,
            marginBottom: 5,
            flexWrap: 'wrap',
            flexShrink: 1,
            borderBottomWidth: 3,
          }}
        >
          {clubItem.name}
        </Basic>
        <DefaultText style={{fontWeight: '700'}}>
          {clubItem.count_members}
          {' '}
          {clubItem.count_members === 1 ? 'person' : 'people'}
        </DefaultText>
      </Pressable>
    </Animated.View>
  );
};

const ClubSelector = ({navigation}: NativeStackScreenProps<ProfileParamList, 'Club Selector'>) => {
  const { appTheme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const selectedClubs = sortClubs(useJoinedClubs() ?? []);

  const [searchResults, setSearchResults] = useState<ClubItem[]>([]);

  const [searchText, setSearchText] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [signedInUser] = useSignedInUser();

  const clearSearchText = useCallback(() => setSearchText(""), []);

  const _fetchClubItems = useCallback(_.debounce(async (q: string) => {
    const results = await fetchClubItems(q);

    setSearchResults(results);
    setIsLoading(false);
  }, 500), []);

  const onChangeTextDebounced = useCallback(async (q: string) => {
    setSearchText(q);
    setSearchResults([]);
    setIsLoading(true);
    await _fetchClubItems(q);
  }, [_fetchClubItems]);

  const onSelectClub = useCallback((club: ClubItem) => {
    joinClub(club.name);
  }, []);

  const clubsToFilter = new Set(selectedClubs);

  const filteredSearchResults = searchResults
    .filter(club => !clubsToFilter.has(club.name));

  return (
    <View style={styles.safeAreaView}>
      <TopNavBar
        style={{
          alignItems: 'stretch',
        }}
      >
        <Pressable
          onPress={() => navigation.goBack()}
          style={{
            zIndex: 999,
            position: 'absolute',
            bottom: 0,
            left: 0,
            height: '100%',
            aspectRatio: 1,
            justifyContent: 'center',
            alignItems: 'center',
            marginLeft: 10,
          }}
        >
          <Ionicons
            style={{
              fontSize: 20,
              color: appTheme.secondaryColor,
              marginBottom: 10,
            }}
            name="arrow-back"
          />
        </Pressable>
        <DefaultTextInput
          placeholder="Search clubs..."
          style={{
            marginLeft: 50,
            marginRight: 50,
            borderWidth: 0,
            height: '100%',
            marginBottom: 10,
          }}
          value={searchText}
          onChangeText={onChangeTextDebounced}
          autoFocus={true}
        />
        {searchText !== "" &&
          <Pressable
            onPress={clearSearchText}
            style={{
              zIndex: 999,
              position: 'absolute',
              bottom: 0,
              right: 0,
              height: '100%',
              aspectRatio: 1,
              justifyContent: 'center',
              alignItems: 'center',
              marginRight: 10,
            }}
          >
            <Ionicons
              style={{
                fontSize: 20,
                color: appTheme.secondaryColor,
                marginBottom: 10,
              }}
              name="close"
            />
          </Pressable>
        }
      </TopNavBar>
      <ScrollView
        contentContainerStyle={{
          paddingTop: 0,
          paddingLeft: 10,
          paddingRight: 10,
          paddingBottom: insets.bottom,
          maxWidth: 600,
          width: '100%',
          alignSelf: 'center',
        }}
      >
        {!_.isEmpty(selectedClubs) &&
          <>
            <Title>Clubs you’re in ({selectedClubs.length}/{clubQuota(signedInUser?.hasGold)})</Title>
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: 5,
              }}
            >
              {selectedClubs.map((a, i) =>
                <SelectedClub
                  key={String(i)}
                  name={a}
                  onPress={leaveClub}
                />
              )}
            </View>
          </>
        }
        {!isLoading && searchText === "" && _.isEmpty(selectedClubs) &&
          <DefaultText
            style={{
              fontFamily: 'Trueno',
              margin: '20%',
              textAlign: 'center'
            }}
          >
            Start typing to find clubs to join...
          </DefaultText>
        }

        {searchText !== "" &&
          <Title>Search Results</Title>
        }
        {searchText !== "" && isLoading &&
          <View
            style={{
              alignItems: 'center',
              justifyContent: 'center',
              flexGrow: 1,
            }}
          >
            <LogoActivityIndicator size="large" color={appTheme.brandColor}/>
          </View>
        }
        {!isLoading && searchText !== "" && _.isEmpty(filteredSearchResults) &&
          <DefaultText
            style={{
              fontFamily: 'Trueno',
              margin: '20%',
              textAlign: 'center'
            }}
          >
            Your search didn’t match any clubs
          </DefaultText>
        }
        {!isLoading && searchText !== "" && !_.isEmpty(filteredSearchResults) &&
          <>
            {filteredSearchResults.map((a, i) =>
              <UnselectedClub
                key={String(i)}
                clubItem={a}
                onPress={onSelectClub}
                isAtQuota={selectedClubs.length >= clubQuota(signedInUser?.hasGold)}
              />
            )}
            <DefaultText style={{
              fontFamily: 'TruenoBold',
              color: appTheme.secondaryColor,
              fontSize: 16,
              textAlign: 'center',
              alignSelf: 'center',
              marginTop: 30,
              marginBottom: 80,
              marginLeft: '15%',
              marginRight: '15%',
            }}>
              No more clubs to show
            </DefaultText>
          </>
        }
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  safeAreaView: {
    flex: 1
  }
});

export {
  ClubSelector,
  SelectedClub,
};
