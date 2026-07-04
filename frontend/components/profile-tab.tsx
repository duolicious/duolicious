import {
  Linking,
  Platform,
  ScrollView,
  View,
  StyleSheet,
} from 'react-native';
import { LogoActivityIndicator } from './logo/logo-activity-indicator';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  ProfileInfo,
  getProfileInfo,
  patchProfileInfo,
  setProfileInfo,
  useProfileInfo,
} from '../events/profile-info';
import {
  NativeStackScreenProps,
  createNativeStackNavigator,
} from '@react-navigation/native-stack';
import { CompositeScreenProps } from '@react-navigation/native';
import type { ProfileParamList, RootParamList } from '../navigation/linking';
import { navigationContainerRef } from '../App';
import { ButtonForOption, ButtonForOptionProps } from './button/option';
import { DuoliciousTopNavBar } from './top-nav-bar';
import { OptionScreen } from './option-screen';
import { Title } from './title';
import { DefaultLongTextInput } from './default-long-text-input';
import { DefaultTextInput } from './default-text-input';
import {
  OptionGroup,
  OptionGroupInputs,
  OptionGroupPhotos,
  basicsOptionGroups,
  deactivationOptionGroups,
  deletionOptionGroups,
  generalSettingsOptionGroups,
  getCurrentValue,
  isOptionGroupButtons,
  isOptionGroupSlider,
  isOptionGroupThemePicker,
  notificationSettingsOptionGroups,
  privacySettingsOptionGroups,
  themePickerOptionGroups,
  verificationOptionGroups,
} from '../data/option-groups';
import { Images } from './images/images';
import { DefaultText } from './default-text';
import { sessionToken, sessionPersonUuid } from '../kv-storage/session-token';
import { lastPath } from '../kv-storage/last-path';
import { resetUserScopedClientState } from '../navigation/reset-client-state';
import { api, japi, ApiResponse } from '../api/api';
import { useSignedInUser, setSignedInUser, getSignedInUser } from '../events/signed-in-user';
import { cmToFeetInchesStr } from '../units/units';
import { IMAGES_URL } from '../env/env';
import * as _ from "lodash";
import { aboutQueue, nameQueue } from '../api/queue';
import { ClubSelector } from './club-selector';
import { ClubItem } from '../club/club';
import { listen, notify } from '../events/events';
import { ButtonWithCenteredText } from './button/centered-text';
import Ionicons from '@expo/vector-icons/Ionicons';
import { logout } from '../chat/application-layer';
import { DetailedVerificationBadges } from './verification-badge';
import {
  notifyUpdatedVerification,
  listenUpdatedVerification,
} from '../verification/verification';
import { InviteEntrypoint } from './invite';
import { InvitePicker } from './invite';
import { AudioBio } from './audio-bio';
import { useScrollbar } from './navigation/scroll-bar-hooks';
import { WEB_VERSION } from '../env/env';
import { photoQueue } from '../api/queue';
import { showPointOfSale } from './modal/point-of-sale-modal';
import { useAppTheme } from '../app-theme/app-theme';
import { faRightFromBracket } from '@fortawesome/free-solid-svg-icons/faRightFromBracket'
import { faDownload } from '@fortawesome/free-solid-svg-icons/faDownload'
import { faUserGroup } from '@fortawesome/free-solid-svg-icons/faUserGroup'
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { INVITE_URL } from '../env/env';

type ProfileInfoResponse = {
  photo_verification: { [position: string]: boolean }
  name: string
  flair: string
};

type ProfileInfoPatchResponse = {
  url_slug?: string
  is_random?: boolean
};

type ExportDataTokenResponse = {
  token?: string
};

const formatHeight = (og: OptionGroup<OptionGroupInputs>): string | undefined => {
  if (!isOptionGroupSlider(og.input)) return '';

  const currentValue = getCurrentValue(og.input);
  const signedInUser = getSignedInUser();

  if (_.isNumber(currentValue)) {
    return signedInUser?.units === 'Imperial' ?
      cmToFeetInchesStr(currentValue) :
      `${currentValue} cm`;
  }
};

const asSettingLabel = (
  value: ReturnType<typeof getCurrentValue>,
): string | undefined =>
  typeof value === 'string' ? value : undefined;

const enqueueAbout = async (about: string, cb: (response: ApiResponse<ProfileInfoPatchResponse>) => void) => {
  aboutQueue.addTask(
    async () => cb(await japi<ProfileInfoPatchResponse>('patch', '/profile-info', { about }))
  );
};

const enqueueName = async (name: string, cb: (response: ApiResponse<ProfileInfoPatchResponse>) => void) => {
  nameQueue.addTask(
    async () => cb(await japi<ProfileInfoPatchResponse>('patch', '/profile-info', { name }))
  );
};

const Stack = createNativeStackNavigator();

const ProfileTab = () => {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen
        name="Profile Tab"
        component={ProfileTab_}
        options={{ title: 'Profile' }}
      />
      <Stack.Screen
        name="Profile Option Screen"
        component={OptionScreen}
        options={{ title: 'Settings' }}
      />
      <Stack.Screen
        name="Club Selector"
        component={ClubSelector}
        options={{ title: 'Clubs' }}
      />
      <Stack.Screen
        name="Invite Picker"
        component={InvitePicker}
        options={{ title: 'Invite friends' }}
      />
    </Stack.Navigator>
  );
};

const Images_ = ({data}: {data: ProfileInfo}) => {
  const input: OptionGroupPhotos = useMemo(() => {
    return {
      photos: {
        submit: async (position, cropperOutput) => {
          const requester = async () => await japi(
            'patch',
            '/profile-info',
            {
              base64_file: {
                position,
                base64: cropperOutput.originalBase64,
                top: cropperOutput.top,
                left: cropperOutput.left,
              },
            },
            {
              timeout: 2 * 60 * 1000, // 2 minutes
              showValidationToast: true,
            }
          );

          const response = await photoQueue.addTask(requester);

          return response.ok;
        },
        delete: async (filename) => (await japi(
          'delete',
          '/profile-info',
          { files: [filename] }
        )).ok,
        getUri: (position: string, resolution: string) => {
          const photoUuid: string | null = (
            data?.photo ?? {})[position] ?? null;

          const extraExts: string[] = (
            data?.photo_extra_exts ?? {})[position] ?? [];

          const ext = extraExts[0] ?? 'jpg';

          const prefix = extraExts.length ? '' : `${resolution}-`;

          if (photoUuid) {
            return `${IMAGES_URL}/${prefix}${photoUuid}.${ext}`
          } else {
            return null;
          }
        },
        getBlurhash: (position: string) => {
          const photoBlurhash = (data?.photo_blurhash ?? {})[position] ?? null;
          if (photoBlurhash) {
            return photoBlurhash;
          } else {
            return null;
          }
        },
      }
    };
  }, [data]);

  return (
    <>
      <Images input={input} style={{ zIndex: 999 }}/>
      <DefaultText
        style={{
          color: '#999',
          textAlign: 'center',
          marginRight: 10,
          marginLeft: 10,
        }}
      >
        Hold and drag photos to change their order
      </DefaultText>
    </>
  );
};

type ProfileTabScreenProps = CompositeScreenProps<
  NativeStackScreenProps<ProfileParamList, 'Profile Tab'>,
  NativeStackScreenProps<RootParamList>
>;

const ProfileTab_ = ({navigation}: ProfileTabScreenProps) => {
  const { appTheme } = useAppTheme();
  const [signedInUser] = useSignedInUser();
  const data = useProfileInfo();

  useEffect(() => {
    (async () => {
      const response = await api<ProfileInfoResponse>('get', '/profile-info');
      if (!response.json) {
        return;
      }

      setProfileInfo(response.json);

      notifyUpdatedVerification({ photos: response.json.photo_verification });

      notify<string>('updated-name', response.json.name);
      notify<string>('updated-flair', response.json.flair);
    })();
  }, [signedInUser?.hasGold === true]);

  const {
    onLayout,
    onContentSizeChange,
    onScroll,
    showsVerticalScrollIndicator,
    observeListRef,
  } = useScrollbar('profile');

  return (
    <View style={styles.safeAreaView}>
      <DuoliciousTopNavBar/>
      {data &&
        <ScrollView
          ref={observeListRef}
          contentContainerStyle={{
            paddingLeft: 10,
            paddingRight: 10,
            paddingBottom: 20,
            maxWidth: 600,
            width: '100%',
            alignSelf: 'center',
          }}
          onLayout={onLayout}
          onContentSizeChange={onContentSizeChange}
          onScroll={onScroll}
          showsVerticalScrollIndicator={showsVerticalScrollIndicator}
        >
          <Images_ data={data}/>
          <Options navigation={navigation} data={data}/>
          <AboutDuolicious/>
        </ScrollView>
      }
      {!data &&
        <View
          style={{
            alignItems: 'center',
            justifyContent: 'center',
            flexGrow: 1,
          }}
        >
          <LogoActivityIndicator size="large" color={appTheme.brandColor} />
        </View>
      }
    </View>
  );
};

const DisplayNameAndAboutPerson = ({data}: {data: ProfileInfo}) => {
  const [name, setName] = useState<string>(data.name ?? '');
  const { appTheme } = useAppTheme();

  type State
    = 'unchanged'
    | 'saving...'
    | 'saved'
    | 'error'
    | 'too rude'
    | 'needs gold'
    | 'spam'
    | 'too short'
    | 'too long';

  const [nameState, setNameState] = useState<State>('unchanged');

  const [nameSlug, setNameSlug] = useState<string | null>(data?.url_slug ?? null);

  // Whether the current slug needed a random suffix because the name collided.
  // Tracked separately from `nameState` because a successful rename is always
  // `'saved'` (r.ok), so the random case can't be a state of its own.
  const [nameSlugTaken, setNameSlugTaken] = useState<boolean>(false);

  const [aboutState, setAboutState] = useState<State>('unchanged');

  const errorStates: State[] = [
    'error',
    'too short',
    'too long',
    'too rude',
    'needs gold',
    'spam',
  ];

  const responseHandler =
    (stateSetter: (state: State) => void) =>
    (r: ApiResponse<ProfileInfoPatchResponse>): boolean =>
  {
    if (r.json?.url_slug) {
      setNameSlug(r.json.url_slug);
      setNameSlugTaken(!!r.json.is_random);
    }

    if (r.ok && r.validationErrors === null) {
      stateSetter('saved');
      return true;
    } else if (r.validationErrors === null) {
      stateSetter('error');
    } else if (r.validationErrors[0] === 'Too rude') {
      stateSetter('too rude');
    } else if (r.validationErrors[0] === 'Spam') {
      stateSetter('spam');
    } else if (r.text === 'Requires gold') {
      showPointOfSale(true);
      stateSetter('needs gold');
    } else {
      stateSetter('error');
    }

    return false;
  };

  const debouncedOnChangeNameText = useCallback(
    _.debounce(enqueueName, 1000),
    []
  );

  const debouncedOnChangeAboutText = useCallback(
    _.debounce(enqueueAbout, 1000),
    []
  );

  const onChangeNameText = useCallback(async (name: string) => {
    setNameState('saving...');

    const handleResponse = (r: ApiResponse<ProfileInfoPatchResponse>) => {
      if (name.length <  1) { setNameState('too short'); return; }
      if (name.length > 64) { setNameState('too long'); return; }

      if (responseHandler(setNameState)(r)) {
        setName(name);
        notify<string>('updated-name', name);
      }
    };

    await debouncedOnChangeNameText(name, handleResponse);
  }, []);

  const onChangeAboutText = useCallback(async (about: string) => {
    setAboutState('saving...');

    const handleResponse = responseHandler(setAboutState);

    await debouncedOnChangeAboutText(about, handleResponse);
  }, []);

  return (
    <View>
      <Title>
        Display Name {}
        {nameState !== 'unchanged' &&
          <DefaultText
            style={{
              fontSize: 14,
              fontWeight: (
                errorStates.includes(nameState) ? '700' : '400'),
              color: (
                errorStates.includes(nameState) ? 'red' : '#777'),
            }}
          >
            ({nameState})
          </DefaultText>
        }
      </Title>
      <DefaultTextInput
        defaultValue={data?.name ?? ''}
        onChangeText={onChangeNameText}
        style={{
          borderWidth: 0,
          marginLeft: 0,
          marginRight: 0,
        }}
      />
      {!!nameSlug &&
        <DefaultText
          style={{
            fontSize: 14,
            color: appTheme.hintColor,
            marginTop: 10,
            textAlign: 'center',
          }}
        >
          {`Changing your display name changes your profile link\xa0–\xa0Your `}
          link is {}
          <DefaultText style={{ fontWeight: 700 }} disableTheme={true}>
            {INVITE_URL}/p/{nameSlug}
          </DefaultText>
          {nameSlugTaken && ` (${name} is taken)`}
        </DefaultText>
      }

      <Title>
        About {name} {}
        {aboutState !== 'unchanged' &&
          <DefaultText
            style={{
              fontSize: 14,
              fontWeight: (
                errorStates.includes(aboutState) ? '700' : '400'),
              color: (
                errorStates.includes(aboutState) ? 'red' : '#777'),
            }}
          >
            ({aboutState})
          </DefaultText>
        }
      </Title>
      <DefaultLongTextInput
        defaultValue={data?.about ?? ''}
        onChangeText={onChangeAboutText}
        numberOfLines={8}
        style={{
          borderWidth: 0,
          height: 200,
        }}
      />
    </View>
  );
};

const optionGroupToDataKey = (og: OptionGroup<OptionGroupInputs>) =>
  og.title.toLowerCase().replaceAll(' ', '_');

const Options = ({ navigation, data }: {
  navigation: ProfileTabScreenProps['navigation'],
  data: ProfileInfo,
}) => {
  const [isLoadingSignOut, setIsLoadingSignOut] = useState(false);
  const [dataExportStatus, setDataExportStatus] = useState<
    'error' | 'loading' | 'ok'
  >('ok');
  const [signedInUser] = useSignedInUser();
  const { appThemeName } = useAppTheme();

  const withCurrent = (
    og: OptionGroup<OptionGroupInputs>,
  ): OptionGroup<OptionGroupInputs> => {
    if (isOptionGroupThemePicker(og.input)) {
      return _.merge({}, og, { input: { themePicker: {
        currentTitleColor: data?.theme?.title_color,
        currentBodyColor: data?.theme?.body_color,
        currentBackgroundColor: data?.theme?.background_color,
      } } });
    }
    if (og.title === 'Dark Mode' && isOptionGroupButtons(og.input)) {
      return _.merge({}, og, { input: { buttons: {
        currentValue: appThemeName === 'dark' ? 'On' : 'Off',
      } } });
    }
    if (og.title === 'Height' && isOptionGroupSlider(og.input)) {
      const isImperial = signedInUser?.units === 'Imperial';
      return _.merge({}, og, { input: { slider: {
        currentValue: data?.height,
        unitsLabel: isImperial ? "ft'in\"" : 'cm',
        valueRewriter: isImperial ? cmToFeetInchesStr : undefined,
      } } });
    }
    const value = data?.[optionGroupToDataKey(og)];
    if (value === undefined) return og;
    const inputKey = Object.keys(og.input)[0];
    return _.merge({}, og, { input: { [inputKey]: { currentValue: value } } });
  };

  const _basicsOptionGroups = basicsOptionGroups.map(withCurrent);
  const _generalSettingsOptionGroups = generalSettingsOptionGroups.map(withCurrent);
  const _notificationSettingsOptionGroups = notificationSettingsOptionGroups.map(withCurrent);
  const _privacySettingsOptionGroups = privacySettingsOptionGroups.map(withCurrent);
  const _themePickerOptionGroups = themePickerOptionGroups.map(withCurrent);

  const _visiblePrivacySettingsOptionGroups =
    data?.public_profile === 'Yes'
      ? _privacySettingsOptionGroups.filter(
          (og) =>
            og.title !== 'Verification Level' &&
            og.title !== 'Hide Me From Strangers')
      : _privacySettingsOptionGroups;

  useEffect(() => {
    return listen<ClubItem[]>(
      'updated-clubs',
      (newClubs) => {
        if (newClubs && getProfileInfo()) patchProfileInfo({ clubs: newClubs });
      },
    );
  }, []);

  useEffect(() => {
    return listenUpdatedVerification((v) => {
      if (!v) return;

      const prev = getProfileInfo();
      if (!prev) return;

      const patch: Record<string, unknown> = {};

      if (v.photos !== undefined)
        patch.photo_verification = {
          ...prev.photo_verification,
          ...v.photos,
        };

      if (v.gender !== undefined) patch.verified_gender = v.gender;
      if (v.age !== undefined) patch.verified_age = v.age;
      if (v.ethnicity !== undefined) patch.verified_ethnicity = v.ethnicity;

      if (Object.keys(patch).length > 0) patchProfileInfo(patch);
    });
  }, []);

  const Button_ = useCallback((props: ButtonForOptionProps) => {
    return <ButtonForOption
      navigation={navigation}
      navigationScreen="Profile Option Screen"
      {...props}
    />;
  }, [navigation]);

  const signOut = useCallback(async () => {
    setIsLoadingSignOut(true);
    await logout();
    if ((await api('post', '/sign-out')).ok) {
      await sessionPersonUuid(null);
      await sessionToken(null);
      // Drop the persisted route so the next sign-in (potentially as a
      // different user on the same browser) starts at the default screen
      // rather than wherever this user happened to be.
      await lastPath(null);
      resetUserScopedClientState();
      setSignedInUser(undefined);
      navigationContainerRef.reset({ routes: [ { name: 'Welcome' } ] });
    }
    setIsLoadingSignOut(false);
  }, []);

  const exportData = useCallback(async () => {
    setDataExportStatus('loading');

    const token: string | undefined = (
      await api<ExportDataTokenResponse>('get', '/export-data-token'))?.json?.token;


    if (!token) {
      setDataExportStatus('error');
      return;
    }

    await Linking.openURL(`https://duolicious.app/export-data/?token=${token}`);

    setDataExportStatus('ok');
  }, []);

  const goToClubSelector = useCallback(() => {
    // `Club Selector` reads the current clubs from the `updated-clubs` event,
    // so there's no reason to pass them as (non-serializable) route params.
    navigation.navigate("Club Selector");
  }, [navigation]);

  const clubsSetting = (() => {
    if (data?.clubs?.length === undefined) return undefined;
    if (data.clubs.length === 0) return undefined;
    return data.clubs.map((clubItem: ClubItem) => clubItem.name).join(', ')
  })();

  const isCompletelyVerified = (
    Object.values(data?.photo_verification ?? {}).every(Boolean) &&
    (data?.verified_gender ?? false) &&
    (data?.verified_age ?? false) &&
    (data?.verified_ethnicity ?? false)
  );

  return (
    <View>
      <Title>Verification</Title>
      <DetailedVerificationBadges
        photos={Object.values(data?.photo_verification ?? {}).some(Boolean)}
        gender={data?.verified_gender ?? false}
        age={data?.verified_age ?? false}
        ethnicity={data?.verified_ethnicity ?? false}
        style={{ marginBottom: 10 }}
      />
      {!isCompletelyVerified && <>
          <Button_
            setting=""
            optionGroups={verificationOptionGroups}
            showSkipButton={false}
          />
          <DefaultText
            style={{
              color: '#999',
              textAlign: 'center',
              marginRight: 10,
              marginLeft: 10,
            }}
          >
            Pro tip: If you want to verify your photos, make sure they show your
            face before starting
          </DefaultText>
        </>
      }

      <DisplayNameAndAboutPerson data={data} />

      <Title>Voice Bio</Title>
      {data.audio_bio_max_seconds !== undefined &&
        <AudioBio
          initialSavedRecordingUuid={data.audio_bio ?? null}
          maxDuration={data.audio_bio_max_seconds}
        />
      }

      <Title>Basics</Title>
      {
        _basicsOptionGroups.map((og, i) =>
          <Button_
            key={i}
            setting={
              og.title === 'Height' ?
                formatHeight(og) :
                asSettingLabel(getCurrentValue(_basicsOptionGroups[i].input))
            }
            optionGroups={_basicsOptionGroups.slice(i)}
          />
        )
      }

      <Title>Clubs</Title>
      <ButtonForOption
        onPress={goToClubSelector}
        label="Clubs"
        setting={clubsSetting}
        noSettingText="None"
        icon={
          ({ color = 'black' }) => (
            <FontAwesomeIcon
              icon={faUserGroup}
              size={14}
              style={{ color }}
            />
          )
        }
      />
      <InviteEntrypoint navigation={navigation}/>

      <Title>Themes</Title>
      {
        _themePickerOptionGroups.map((og, i) =>
          <Button_
            key={i}
            setting={
              og.title === 'Profile Theme'
                ? ""
                : asSettingLabel(getCurrentValue(og.input))
            }
            showSkipButton={og.title !== 'Profile Theme'}
            optionGroups={_themePickerOptionGroups.slice(i)}
          />
        )
      }

      <ButtonWithCenteredText
        onPress={() => {
          const personUuid = data?.url_slug ?? signedInUser?.personUuid;
          if (!personUuid) return;
          navigation.navigate(
            'Prospect Profile Screen',
            {
              screen: 'Prospect Profile',
              params: { personUuid },
            }
          );
        }}
        containerStyle={{
          marginTop: 30,
        }}
        extraChildren={
         <View style={{
           position: 'absolute',
           top: 0,
           right: 15,
           height: '100%',
           justifyContent: 'center',
           }}>
          <Ionicons style={{
              fontSize: 20,
              color: 'white',
          }} name="chevron-forward"/>
        </View>
        }
      >
        Preview Your Profile
      </ButtonWithCenteredText>

      <Title style={{ marginTop: 70 }}>Notification Settings</Title>
      {
        _notificationSettingsOptionGroups.map((og, i) =>
          <Button_
            key={i}
            setting={asSettingLabel(getCurrentValue(og.input))}
            optionGroups={_notificationSettingsOptionGroups.slice(i)}
          />
        )
      }
      <Title>Privacy Settings</Title>
      {
        _visiblePrivacySettingsOptionGroups.map((og, i) =>
          <Button_
            key={i}
            setting={asSettingLabel(getCurrentValue(og.input))}
            // Pass the FULL privacy list (not the filtered visible one) so the
            // wizard cascade after submitting Public Profile can include or
            // skip Verification Level / Hide Me From Strangers based on the
            // just-submitted value. OptionScreen._onSubmitSuccess does the
            // conditional filtering at advance time.
            optionGroups={_privacySettingsOptionGroups.slice(
              _privacySettingsOptionGroups.indexOf(og))}
          />
        )
      }

      <Title>General Settings</Title>
      {
        _generalSettingsOptionGroups.map((og, i) =>
          <Button_
            key={i}
            setting={asSettingLabel(getCurrentValue(og.input))}
            optionGroups={_generalSettingsOptionGroups.slice(i)}
          />
        )
      }

      <Title style={{ marginTop: 70 }}>Sign Out</Title>
      <ButtonForOption
        onPress={signOut}
        label="Sign Out"
        setting=""
        loading={isLoadingSignOut}
        icon={
          ({ color = 'black' }) => (
            <FontAwesomeIcon
              icon={faRightFromBracket}
              size={14}
              style={{ color }}
            />
          )
        }
      />

      <Title style={{ marginTop: 70 }}>Deactivate My Account</Title>
      <Button_ optionGroups={deactivationOptionGroups} setting="" showSkipButton={false}/>

      <Title>Delete My Account</Title>
      <Button_ optionGroups={deletionOptionGroups} setting=""/>

      <Title style={{ marginTop: 70 }}>Export My Data</Title>
      <ButtonForOption
        onPress={exportData}
        label="Export My Data"
        setting={dataExportStatus === 'error' ? 'Try again later' : ''}
        loading={dataExportStatus === 'loading'}
        icon={
          ({ color = 'black' }) => (
            <FontAwesomeIcon
              icon={faDownload}
              size={14}
              style={{ color }}
            />
          )
        }
      />
    </View>
  );
};

const AboutDuolicious = () => {
  return (
    <View
      style={{
        marginBottom: 60,
      }}
    >
      <Title style={{
        marginTop: 60,
        textAlign: 'center',
        color: '#999'
      }}>
        About
      </Title>
      <DefaultText
        onPress={() => Linking.openURL('https://github.com/duolicious/duolicious')}
        style={{
          textAlign: 'center',
          color: '#999',
        }}
      >
        Duolicious is free software licensed under the AGPLv3. The source code
        used to make Duolicious is available {}
        <DefaultText style={{fontWeight: '600', color: '#37f'}}>
          here
        </DefaultText>
        .
      </DefaultText>
      <DefaultText
        onPress={() => Linking.openURL('mailto:support@duolicious.app')}
        style={{
          marginTop: 25,
          textAlign: 'center',
          color: '#999',
        }}
      >
        You can contact us at {}
        <DefaultText style={{fontWeight: '600', color: '#37f'}}>
          support@duolicious.app
        </DefaultText>
        {} to provide feedback, report abuse, or submit any other concerns or
        queries you have.
      </DefaultText>

      {Platform.OS === 'web' &&
        <DefaultText
          style={{
            marginTop: 25,
            textAlign: 'center',
            color: '#999',
          }}
        >
          Duolicious Web Version {WEB_VERSION}
        </DefaultText>
      }
    </View>
  );
};

const styles = StyleSheet.create({
  safeAreaView: {
    flex: 1,
  }
});

export {
  ProfileTab,
};
