import {
  Pressable,
  ScrollView,
  View,
  StyleSheet,
} from 'react-native';
import { LogoActivityIndicator } from './logo/logo-activity-indicator';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useCallback,
  useEffect,
  useState,
} from 'react';
import { DefaultText } from './default-text';
import { TopNavBar } from './top-nav-bar';
import { ButtonForOption, ButtonForOptionProps } from './button/option';
import { Title } from './title';
import {
  OptionGroup,
  OptionGroupInputs,
  searchBasicsOptionGroups,
  searchTwoWayBasicsOptionGroups,
  searchOtherBasicsOptionGroups,
  searchInteractionsOptionGroups,
  defaultSearchFilters,
  getCurrentValue,
  isOptionGroupCheckChips,
  isOptionGroupRangeSlider,
  isOptionGroupSlider,
} from '../data/option-groups';
import { FIRST_ONE_WAY_FILTER_PERSON_ID } from '../constants/constants';
import {
  NativeStackScreenProps,
  createNativeStackNavigator,
} from '@react-navigation/native-stack';
import type { SearchFilterParamList } from '../navigation/linking';
import { OptionScreen } from './option-screen';
import Ionicons from '@expo/vector-icons/Ionicons';
import { DefaultTextInput } from './default-text-input';
import { SearchQuizCard } from './quiz-card';
import { api } from '../api/api';
import * as _ from "lodash";
import {
  useSignedInUser,
  useIsWebLoggedOut,
  type SignedInUser,
} from '../events/signed-in-user';
import { showSignUp } from './modal/sign-up-modal';
import {
  cmToFeetInchesStr,
} from '../units/units';
import {
  distanceLabel,
  distanceSliderMaxKm,
  distanceValueText,
  normalizeMaxDistanceKm,
} from '../units/distance';
import { TopNavBarButton } from './top-nav-bar-button';
import { QAndADevice } from './q-and-a-device';
import { useAppTheme } from '../app-theme/app-theme';
import { listen } from '../events/events';
import {
  SearchFilterAnswer,
  setSearchFilterAnswers,
  getSearchFilterAnswers,
} from '../navigation/search-filter-state';
import {
  SearchFilters,
  patchSearchFilters,
  setSearchFilters,
  useSearchFilters,
} from '../events/search-filters';

const getCurrentValueAsLabel = (
  og: OptionGroup<OptionGroupInputs> | undefined,
  signedInUser: SignedInUser | undefined,
): string | undefined => {
  if (!og) return undefined;

  const currentValue = getCurrentValue(og.input);

  if (
    isOptionGroupCheckChips(og.input) &&
    _.isArray(currentValue) &&
    _.every(currentValue, _.isString)
  ) {
    if (currentValue.length === og.input.checkChips.values.length) {
      return undefined;
    } else {
      return currentValue.join(', ');
    }
  } else if (isOptionGroupSlider(og.input)) {
    const currentValue = og.input.slider.currentValue;

    if (currentValue === undefined) {
      return undefined;
    } else if (og.title === 'Furthest Distance') {
      return distanceLabel(currentValue, signedInUser?.units);
    } else {
      return `${currentValue}`;
    }
  } else if (
    isOptionGroupRangeSlider(og.input) &&
    typeof currentValue === 'object' &&
    'sliderMin' in currentValue &&
    'sliderMax' in currentValue
  ) {
    const currentMin = og.input.rangeSlider.currentMin;
    const currentMax = og.input.rangeSlider.currentMax;

    if (_.isNil(currentMin) && _.isNil(currentMax)) {
      return undefined;
    } else if (og.title === 'Age') {
      return `${currentMin ?? 'any'}–${currentMax ?? 'any'} years`;
    } else if (og.title === 'Height') {
      const _currentMin = _.isNil(currentMin) ? 'any' :
        signedInUser?.units === 'Imperial' ?
        cmToFeetInchesStr(currentMin) :
        `${currentMin} cm`;

      const _currentMax = _.isNil(currentMax) ? 'any' :
        signedInUser?.units === 'Imperial' ?
        cmToFeetInchesStr(currentMax) :
        `${currentMax} cm`;

      return `${_currentMin}–${_currentMax}`;
    } else {
      return `${currentMin ?? 'any'}–${currentMax ?? 'any'}`;
    }
  } else {
    return typeof currentValue === 'string' ? currentValue : undefined;
  }
};

const optionGroupToDataKey = (og: OptionGroup<OptionGroupInputs>) =>
  og.title.toLowerCase().replaceAll(' ', '_');

type AnswerItem = SearchFilterAnswer;

const fetchQuestionSearch = async (q: string): Promise<AnswerItem[]> => {
  const resultsPerPage = 25;
  const offset = 0;

  const response = await api<SearchFilterAnswer[]>(
    'get',
    `/search-filter-questions` +
    `?q=${encodeURIComponent(q)}&n=${resultsPerPage}&o=${offset}`,
  );

  return response.ok ? response.json : [];
};

const Stack = createNativeStackNavigator();

const SearchFilterScreen = () => {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen
        name="Search Filter Tab"
        component={SearchFilterScreen_}
        options={{ title: 'Search filters' }}
      />
      <Stack.Screen
        name="Search Filter Option Screen"
        component={OptionScreen}
        options={{ title: 'Edit search filter' }}
      />
      <Stack.Screen
        name="Q&A Filter Screen"
        component={QandQFilterScreen}
        options={{ title: 'Q&A filters' }}
      />
    </Stack.Navigator>
  );
};

const SearchFilterScreen_ = ({navigation}: NativeStackScreenProps<SearchFilterParamList, 'Search Filter Tab'>) => {
  const { appTheme } = useAppTheme();
  const [signedInUser] = useSignedInUser();
  const isLocked = useIsWebLoggedOut();
  const insets = useSafeAreaInsets();

  const data = useSearchFilters();

  const answers: AnswerItem[] = data?.answer ?? [];

  const promptSignUp = useCallback(() => {
    showSignUp(true, 'Join or sign in to filter matches');
  }, []);

  const onPressQAndAAnswers = useCallback(() => {
    if (isLocked) {
      promptSignUp();
      return;
    }
    setSearchFilterAnswers(answers);
    navigation.navigate("Q&A Filter Screen");
  }, [navigation, answers, isLocked, promptSignUp]);

  useEffect(() => {
    return listen<AnswerItem[]>('search-filter-answers-updated', (next) => {
      if (!next) return;
      patchSearchFilters({ answer: next });
    });
  }, []);

  const Button_ = useCallback((props: ButtonForOptionProps) => {
    if (isLocked) {
      return <ButtonForOption
        onPress={promptSignUp}
        showSkipButton={false}
        noSettingText="Any"
        {...props}
      />;
    }
    return <ButtonForOption
      navigation={navigation}
      navigationScreen="Search Filter Option Screen"
      showSkipButton={false}
      noSettingText="Any"
      {...props}
    />;
  }, [navigation, isLocked, promptSignUp]);

  const withCurrent = (
    og: OptionGroup<OptionGroupInputs>,
  ): OptionGroup<OptionGroupInputs> => {
    const value = data?.[optionGroupToDataKey(og)];
    const isImperial = signedInUser?.units === 'Imperial';

    if (isOptionGroupCheckChips(og.input)) {
      const checked: string[] = Array.isArray(value) ? value : [];
      return _.merge({}, og, { input: { checkChips: {
        values: og.input.checkChips.values.map((v) => ({
          ...v,
          checked: checked.includes(v.label),
        })),
      } } });
    }
    if (og.title === 'Furthest Distance' && isOptionGroupSlider(og.input)) {
      const distanceMaxKm = distanceSliderMaxKm(signedInUser?.units);
      const normalizedValue = normalizeMaxDistanceKm(
        value,
        signedInUser?.units,
      );
      const currentValue =
        isImperial && typeof normalizedValue === 'number' ?
        Math.min(normalizedValue, distanceMaxKm) :
        normalizedValue;

      return _.merge({}, og, { input: { slider: {
        currentValue,
        sliderMax: isImperial ? distanceMaxKm : og.input.slider.sliderMax,
        defaultValue: isImperial ? distanceMaxKm : og.input.slider.defaultValue,
        unitsLabel: isImperial ? "mi." : 'km',
        valueRewriter: isImperial ? (km: number) => distanceValueText(km, 'Imperial') : undefined,
      } } });
    }
    if (og.title === 'Age' && isOptionGroupRangeSlider(og.input)) {
      const ageValue: { min_age?: unknown; max_age?: unknown } =
        value && typeof value === 'object' ? value : {};
      return _.merge({}, og, { input: { rangeSlider: {
        currentMin: ageValue.min_age,
        currentMax: ageValue.max_age,
      } } });
    }
    if (og.title === 'Height' && isOptionGroupRangeSlider(og.input)) {
      const heightValue: { min_height_cm?: unknown; max_height_cm?: unknown } =
        value && typeof value === 'object' ? value : {};
      return _.merge({}, og, { input: { rangeSlider: {
        currentMin: heightValue.min_height_cm,
        currentMax: heightValue.max_height_cm,
        unitsLabel: isImperial ? "ft'in\"" : 'cm',
        valueRewriter: isImperial ? cmToFeetInchesStr : undefined,
      } } });
    }
    if (value === undefined) return og;
    const inputKey = Object.keys(og.input)[0];
    return _.merge({}, og, { input: { [inputKey]: { currentValue: value } } });
  };

  useEffect(() => {
    if (isLocked) {
      setSearchFilters(defaultSearchFilters());
      return;
    }
    (async () => {
      const response = await api<SearchFilters>('get', '/search-filters');
      if (response.json) {
        setSearchFilters(response.json);
      }
    })();
  }, [isLocked]);

  // People who signed up while the basics filters were two-way keep the
  // legacy screen structure, including its two-way messaging, even though
  // their filters are only two-way against other grandfathered users now
  const hasLegacyTwoWayFilters =
    !!signedInUser && signedInUser.personId < FIRST_ONE_WAY_FILTER_PERSON_ID;

  const _searchBasicsOptionGroups = searchBasicsOptionGroups.map(withCurrent);
  const _searchTwoWayBasicsOptionGroups = searchTwoWayBasicsOptionGroups.map(withCurrent);
  const _searchOtherBasicsOptionGroups = searchOtherBasicsOptionGroups.map(withCurrent);
  const _searchInteractionsOptionGroups = searchInteractionsOptionGroups.map(withCurrent);

  const goBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  return (
    <View style={styles.safeAreaView}>
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
          Search Filters
        </DefaultText>
      </TopNavBar>

      {data &&
        <ScrollView
          contentContainerStyle={{
            maxWidth: 600,
            width: '100%',
            alignSelf: 'center',
            alignItems: 'stretch',
            padding: 10,
            paddingBottom: 50 + insets.bottom,
          }}
        >
          <Title>Q&A Answers</Title>
          <ButtonForOption
            label="Q&A Answers"
            setting={
              (answers === undefined || answers.length === 0) ?
              undefined :
              (`${answers.length} Answer` + (answers.length === 1 ? '' : 's'))
            }
            noSettingText="Any"
            onPress={onPressQAndAAnswers}
            icon={
              () => <QAndADevice
                color={appTheme.secondaryColor}
                backgroundColor={appTheme.primaryColor}
                isBold={true}
                height={16}
              />
            }
          />
          <DefaultText
            style={{
              color: '#999',
              textAlign: 'center',
              marginRight: 10,
              marginLeft: 10,
            }}
          >
            Set the Q&A answers you’ll accept from your matches
          </DefaultText>

          {hasLegacyTwoWayFilters &&
            <>
              <Title style={{marginTop: 40}}>Basics (Two-way Filters)</Title>
              {
                _searchTwoWayBasicsOptionGroups.map((og, i) =>
                  <Button_
                    key={i}
                    setting={getCurrentValueAsLabel(og, signedInUser)}
                    optionGroups={_searchTwoWayBasicsOptionGroups.slice(i)}
                  />
                )
              }
              <DefaultText
                style={{
                  color: '#999',
                  textAlign: 'center',
                  marginRight: 10,
                  marginLeft: 10,
                }}
              >
                Anyone you filter with your two-way search settings won’t see
                you in their searches either, unless searching a mutual club
              </DefaultText>

              <Title style={{marginTop: 40}}>Basics (Other Filters)</Title>
              {
                _searchOtherBasicsOptionGroups.map((og, i) =>
                  <Button_
                    key={i}
                    setting={getCurrentValueAsLabel(og, signedInUser)}
                    optionGroups={_searchOtherBasicsOptionGroups.slice(i)}
                  />
                )
              }
            </>
          }
          {!hasLegacyTwoWayFilters &&
            <>
              <Title style={{marginTop: 40}}>Basics</Title>
              {
                _searchBasicsOptionGroups.map((og, i) =>
                  <Button_
                    key={i}
                    setting={getCurrentValueAsLabel(og, signedInUser)}
                    optionGroups={_searchBasicsOptionGroups.slice(i)}
                  />
                )
              }
            </>
          }
          <Title style={{marginTop: 40}}>Interactions</Title>
          {
            _searchInteractionsOptionGroups.map((og, i) =>
              <Button_
                key={i}
                setting={getCurrentValueAsLabel(og, signedInUser)}
                optionGroups={_searchInteractionsOptionGroups.slice(i)}
              />
            )
          }
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

const QandQFilterScreen = ({navigation}: NativeStackScreenProps<SearchFilterParamList, 'Q&A Filter Screen'>) => {
  const { appTheme } = useAppTheme();
  const insets = useSafeAreaInsets();

  // Source of truth for the current filter answers lives in a module-level
  // store so this screen doesn't need a mutable object handed through
  // route.params.
  const [answers, setLocalAnswers] = useState<AnswerItem[]>(
    () => getSearchFilterAnswers());

  // Cold-start cases (direct deep link / page refresh) bypass the parent
  // `Search Filter Tab` and therefore the module-level store is empty.
  // Fetch the saved answers once on mount when that's the case so the screen
  // isn't permanently blank.
  useEffect(() => {
    if (getSearchFilterAnswers().length > 0) return;
    let cancelled = false;
    (async () => {
      const response = await api<{ answer?: SearchFilterAnswer[] }>(
        'get', '/search-filters');
      const fetched: AnswerItem[] = response?.json?.answer ?? [];
      if (cancelled || fetched.length === 0) return;
      setSearchFilterAnswers(fetched);
      setLocalAnswers(fetched);
    })();
    return () => { cancelled = true; };
  }, []);

  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState<AnswerItem[] | null>();
  const [isLoading, setIsLoading] = useState(false);

  const clearSearchText = useCallback(() => setSearchText(""), []);

  const _fetchQuestionSearch = useCallback(_.debounce(async (q: string) => {
    const results = await fetchQuestionSearch(q);

    setSearchResults(results);
    setIsLoading(false);
  }, 500), []);

  const onChangeTextDebounced = useCallback(async (q: string) => {
    setSearchText(q);
    setSearchResults(null);
    setIsLoading(true);
    await _fetchQuestionSearch(q);
  }, [_fetchQuestionSearch]);

  const onAnswerChange = useCallback((newAnswers: AnswerItem[]) => {
    setSearchFilterAnswers(newAnswers);
    setLocalAnswers([...newAnswers]);
  }, []);

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
          placeholder="Search questions..."
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
      {isLoading &&
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
      {!isLoading &&
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
          {searchText === "" && _.isEmpty(answers) &&
            <DefaultText
              style={{
                fontFamily: 'Trueno',
                margin: '20%',
                textAlign: 'center'
              }}
            >
              You haven’t added any Q&A filters
            </DefaultText>
          }
          {searchText !== "" && _.isEmpty(searchResults) &&
            <DefaultText
              style={{
                fontFamily: 'Trueno',
                margin: '20%',
                textAlign: 'center'
              }}
            >
              Your search didn't match any Q&A questions
            </DefaultText>
          }
          {searchText === "" && !_.isEmpty(answers) &&
            <>
              <Title>Q&A Answers You’ll Accept ({(answers ?? []).length})</Title>
              {(answers ?? []).map((a) =>
                <SearchQuizCard
                  key={JSON.stringify(a)}
                  questionNumber={a.question_id}
                  topic={a.topic}
                  answer={a.answer}
                  initialCheckBoxValue={a.accept_unanswered}
                  onAnswerChange={onAnswerChange}
                >
                  {a.question}
                </SearchQuizCard>
              )}
              <DefaultText style={{
                fontFamily: 'TruenoBold',
                color: '#000',
                fontSize: 16,
                textAlign: 'center',
                alignSelf: 'center',
                marginTop: 30,
                marginBottom: 80,
                marginLeft: '15%',
                marginRight: '15%',
              }}>
                You haven’t got any other Q&A filters
              </DefaultText>
            </>
          }
          {searchText !== "" && !_.isEmpty(searchResults) &&
            <>
              <Title>Search Results</Title>
              {(searchResults ?? []).map((a) =>
                <SearchQuizCard
                  key={JSON.stringify(a)}
                  questionNumber={a.question_id}
                  topic={a.topic}
                  answer={a.answer}
                  initialCheckBoxValue={a.accept_unanswered}
                  onAnswerChange={onAnswerChange}
                >
                  {a.question}
                </SearchQuizCard>
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
                No more search results to show
              </DefaultText>
            </>
          }
        </ScrollView>
      }
    </View>
  );
};

const styles = StyleSheet.create({
  safeAreaView: {
    flex: 1
  }
});

export {
  SearchFilterScreen,
}
