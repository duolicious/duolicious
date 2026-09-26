import {
  Pressable,
  ScrollView,
  View,
  StyleSheet,
} from 'react-native';
import { LogoActivityIndicator } from './logo/logo-activity-indicator';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  FC,
  useCallback,
  useEffect,
  useState,
} from 'react';
import { DefaultText } from './default-text';
import { TopNavBar } from './top-nav-bar';
import { ButtonForOption } from './button/option';
import { Title } from './title';
import {
  OptionGroup,
  OptionGroupInputs,
  searchBasicsOptionGroups,
  searchOtherBasicsOptionGroups,
  searchInteractionsOptionGroups,
  searchOrderOptionGroups,
  defaultSearchFilters,
  getCurrentValue,
  isOptionGroupCheckChips,
  isOptionGroupRangeSlider,
  isOptionGroupSlider,
  twoWayFilterList,
} from '../data/option-groups';
import {
  NativeStackScreenProps,
  createNativeStackNavigator,
} from '@react-navigation/native-stack';
import type { SearchFilterParamList } from '../navigation/linking';
import { OptionScreen } from './option-screen';
import { Toggle } from './toggle';
import { descriptionStyle } from './option-styles';
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
import {
  SearchFilterAnswer,
  SearchFilters,
  flushSearchFilterWrites,
  getSearchFilters,
  setSearchFilters,
  setTwoWayFilter,
  useSearchFilters,
} from '../events/search-filters';
import { getPublicSearchFilters } from '../events/public-search-filters';

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

    if (og.title === 'Furthest Distance') {
      return _.compact([
        distanceLabel(currentValue, signedInUser?.units),
        og.input.slider.toggle?.currentValue ? 'Same country' : undefined,
      ]).join(', ') || undefined;
    } else if (currentValue === undefined) {
      return undefined;
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

const withCurrentValue = (
  og: OptionGroup<OptionGroupInputs>,
  data: SearchFilters | undefined,
  signedInUser: SignedInUser | undefined,
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
      toggle: { currentValue: data?.same_country_only === true },
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
      unitsLabel: isImperial ? '' : 'cm',
      valueRewriter: isImperial ? cmToFeetInchesStr : undefined,
    } } });
  }
  if (value === undefined) return og;
  const inputKey = Object.keys(og.input)[0];
  return _.merge({}, og, { input: { [inputKey]: { currentValue: value } } });
};

const fetchQuestionSearch = async (q: string): Promise<SearchFilterAnswer[]> => {
  const resultsPerPage = 25;
  const offset = 0;

  const response = await api<SearchFilterAnswer[]>(
    'get',
    `/search-filter-questions` +
    `?q=${encodeURIComponent(q)}&n=${resultsPerPage}&o=${offset}`,
  );

  return response.ok ? response.json : [];
};

// Cold-start cases (direct deep link / page refresh) bypass the parent
// `Search Filter Tab`, which normally populates the search filter store.
const useColdStartSearchFilters = () => {
  const isLocked = useIsWebLoggedOut();

  useEffect(() => {
    if (getSearchFilters()) return;
    if (isLocked) {
      setSearchFilters(signedOutSearchFilters());
      return;
    }
    let cancelled = false;
    (async () => {
      const response = await api<SearchFilters>('get', '/search-filters');
      if (!cancelled && response.json) {
        setSearchFilters(response.json);
      }
    })();
    return () => { cancelled = true; };
  }, [isLocked]);

  return useSearchFilters();
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
      <Stack.Screen
        name="Two-way Filters Screen"
        component={TwoWayFilterScreen}
        options={{ title: 'Two-way filters' }}
      />
    </Stack.Navigator>
  );
};

const signedOutSearchFilters = (): SearchFilters => ({
  ...defaultSearchFilters(),
  ...getPublicSearchFilters(),
});

const twoWayFilterSetting = (data: SearchFilters | undefined) => {
  const twoWay = (data?.two_way_filters ?? {}) as Record<string, boolean>;
  const twoWayOn = twoWayFilterList.filter((f) => twoWay[f.key]);
  return (
    twoWayOn.length === twoWayFilterList.length ? 'All' :
    twoWayOn.length ? twoWayOn.map((f) => f.label).join(', ') :
    undefined
  );
};

const advancedSearchFilterOptionGroups = [
  ...searchOtherBasicsOptionGroups,
  ...searchInteractionsOptionGroups,
  ...searchOrderOptionGroups,
];

const countChangedAdvancedFilters = (
  data: SearchFilters,
  signedInUser: SignedInUser | undefined,
): number => {
  const defaults = defaultSearchFilters();
  const label = (og: OptionGroup<OptionGroupInputs>, d: SearchFilters) =>
    getCurrentValueAsLabel(withCurrentValue(og, d, signedInUser), signedInUser);

  return [
    ...advancedSearchFilterOptionGroups.map((og) =>
      label(og, data) !== label(og, defaults)),
    twoWayFilterSetting(data) !== twoWayFilterSetting(defaults),
    !_.isEmpty(data.answer),
  ].filter(Boolean).length;
};

type OptionButtonProps = {
  setting?: string
  optionGroups: OptionGroup<OptionGroupInputs>[]
};

const SearchFilterList = ({
  includeBasics = false,
  OptionButton,
  onPressTwoWayFilters,
  onPressQAndAAnswers,
}: {
  includeBasics?: boolean
  OptionButton: FC<OptionButtonProps>
  onPressTwoWayFilters: () => void
  onPressQAndAAnswers: () => void
}) => {
  const { appTheme } = useAppTheme();
  const [signedInUser] = useSignedInUser();
  const data = useSearchFilters();

  const answers = data?.answer ?? [];

  const optionButtons = (optionGroups: OptionGroup<OptionGroupInputs>[]) => {
    const current = optionGroups.map((og) =>
      withCurrentValue(og, data, signedInUser));

    return current.map((og, i) =>
      <OptionButton
        key={i}
        setting={getCurrentValueAsLabel(og, signedInUser)}
        optionGroups={current.slice(i)}
      />
    );
  };

  return (
    <>
      {includeBasics &&
        <>
          <Title style={{marginTop: 0}}>Basics</Title>
          {optionButtons(searchBasicsOptionGroups)}
        </>
      }

      <Title style={{marginTop: includeBasics ? 40 : 0}}>Other Basics</Title>
      {optionButtons(searchOtherBasicsOptionGroups)}

      <Title style={{marginTop: 40}}>Two-way Filters</Title>
      <ButtonForOption
        label="Two-way Filters"
        setting={twoWayFilterSetting(data)}
        noSettingText="None"
        onPress={onPressTwoWayFilters}
        icon={({ color }) =>
          <Ionicons style={{ fontSize: 16, color }} name="swap-horizontal" />
        }
      />

      <Title style={{marginTop: 40}}>Q&A Answers</Title>
      <ButtonForOption
        label="Q&A Answers"
        setting={
          answers.length === 0 ?
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

      <Title style={{marginTop: 40}}>Interactions</Title>
      {optionButtons(searchInteractionsOptionGroups)}

      <Title style={{marginTop: 40}}>Sorting</Title>
      {optionButtons(searchOrderOptionGroups)}
    </>
  );
};

const SearchFilterScreen_ = ({navigation}: NativeStackScreenProps<SearchFilterParamList, 'Search Filter Tab'>) => {
  const { appTheme } = useAppTheme();
  const isLocked = useIsWebLoggedOut();
  const insets = useSafeAreaInsets();

  const data = useSearchFilters();

  const promptSignUp = useCallback(() => {
    showSignUp(true, 'Join or sign in to filter matches');
  }, []);

  const onPressQAndAAnswers = useCallback(() => {
    if (isLocked) {
      promptSignUp();
      return;
    }
    navigation.navigate("Q&A Filter Screen");
  }, [navigation, isLocked, promptSignUp]);

  const onPressTwoWayFilters = useCallback(() => {
    if (isLocked) {
      promptSignUp();
      return;
    }
    navigation.navigate("Two-way Filters Screen");
  }, [navigation, isLocked, promptSignUp]);

  const Button_ = useCallback((props: OptionButtonProps) => {
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

  useEffect(() => {
    if (isLocked) {
      setSearchFilters(signedOutSearchFilters());
      return;
    }
    (async () => {
      const response = await api<SearchFilters>('get', '/search-filters');
      if (response.json) {
        setSearchFilters(response.json);
      }
    })();
  }, [isLocked]);

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
          <SearchFilterList
            includeBasics={true}
            OptionButton={Button_}
            onPressTwoWayFilters={onPressTwoWayFilters}
            onPressQAndAAnswers={onPressQAndAAnswers}
          />
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

const useQAndAFilters = () => {
  const data = useColdStartSearchFilters();
  const answers = data?.answer ?? [];

  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState<SearchFilterAnswer[] | null>();
  const [isLoading, setIsLoading] = useState(false);

  const clearSearchText = useCallback(() => setSearchText(""), []);

  const _fetchQuestionSearch = useCallback(_.debounce(async (q: string) => {
    const results = await fetchQuestionSearch(q);

    setSearchResults(results);
    setIsLoading(false);
  }, 500), []);

  const onChangeSearchText = useCallback(async (q: string) => {
    setSearchText(q);
    setSearchResults(null);
    setIsLoading(true);
    await _fetchQuestionSearch(q);
  }, [_fetchQuestionSearch]);

  return {
    data,
    answers,
    searchText,
    searchResults,
    isLoading,
    clearSearchText,
    onChangeSearchText,
  };
};

const QAndAFilterResults = ({
  answers,
  searchText,
  searchResults,
}: ReturnType<typeof useQAndAFilters>) => {
  const { appTheme } = useAppTheme();

  return (
    <>
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
          <Title>Q&A Answers You’ll Accept ({answers.length})</Title>
          {answers.map((a) =>
            <SearchQuizCard key={a.question_id} item={a} />
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
            <SearchQuizCard key={a.question_id} item={a} />
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
    </>
  );
};

const QandQFilterScreen = ({navigation}: NativeStackScreenProps<SearchFilterParamList, 'Q&A Filter Screen'>) => {
  const { appTheme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const qAndAFilters = useQAndAFilters();
  const {
    data,
    searchText,
    isLoading,
    clearSearchText,
    onChangeSearchText,
  } = qAndAFilters;

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
          onChangeText={onChangeSearchText}
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
      {(isLoading || !data) &&
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
      {!isLoading && data &&
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
          <QAndAFilterResults {...qAndAFilters} />
        </ScrollView>
      }
    </View>
  );
};

const TwoWayFilterToggles = () => {
  const { appTheme } = useAppTheme();
  const isLocked = useIsWebLoggedOut();
  const data = useSearchFilters();

  const twoWay = (data?.two_way_filters ?? {}) as Record<string, boolean>;

  useEffect(() => {
    return () => { flushSearchFilterWrites(); };
  }, []);

  const onToggle = useCallback((key: string, value: boolean) => {
    if (isLocked) {
      showSignUp(true, 'Join or sign in to filter matches');
      return;
    }
    setTwoWayFilter(key, value);
  }, [isLocked]);

  return (
    <>
      <DefaultText style={{ ...descriptionStyle.style, marginBottom: 10 }}>
        Making a filter two-way means you’ll only see people whose search
        preferences you match. So if you make age two-way, you’ll only see
        people whose preferred age range includes you. Two-way filters don’t
        hide you from other members.
      </DefaultText>
      {twoWayFilterList.map((f) => {
        const Icon = f.Icon;
        return (
          <View key={f.key} style={styles.twoWayRow}>
            {Icon && <Icon color={appTheme.secondaryColor} />}
            <DefaultText style={styles.twoWayLabel}>{f.label}</DefaultText>
            <Toggle
              value={twoWay[f.key] ?? false}
              onValueChange={(v) => onToggle(f.key, v)}
            />
          </View>
        );
      })}
    </>
  );
};

const TwoWayFilterScreen = ({navigation}: NativeStackScreenProps<SearchFilterParamList, 'Two-way Filters Screen'>) => {
  const { appTheme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const data = useColdStartSearchFilters();

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
          Two-way Filters
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
          <TwoWayFilterToggles />
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

const styles = StyleSheet.create({
  safeAreaView: {
    flex: 1
  },
  twoWayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 10,
  },
  twoWayLabel: {
    flex: 1,
    fontSize: 16,
  },
});

export {
  QAndAFilterResults,
  SearchFilterList,
  SearchFilterScreen,
  TwoWayFilterToggles,
  advancedSearchFilterOptionGroups,
  countChangedAdvancedFilters,
  signedOutSearchFilters,
  getCurrentValueAsLabel,
  useColdStartSearchFilters,
  useQAndAFilters,
  withCurrentValue,
}
