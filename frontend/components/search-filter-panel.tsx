import { ReactNode, useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as _ from 'lodash';
import { DefaultText } from './default-text';
import { DefaultTextInput } from './default-text-input';
import { CheckChip, CheckChips } from './check-chip';
import { Slider, SliderValue, rangeSliderLabel, sliderLabel } from './slider';
import { Toggle } from './toggle';
import { VerticalButtonGroup } from './vertical-button-group';
import { LogoActivityIndicator } from './logo/logo-activity-indicator';
import { ButtonWithCenteredText } from './button/centered-text';
import { ButtonForOption } from './button/option';
import { SidePanelCard, SidePanelHeading } from './navigation/side-panel';
import { useAppTheme } from '../app-theme/app-theme';
import { useIsWebLoggedOut, useSignedInUser } from '../events/signed-in-user';
import { setPublicSearchFilters } from '../events/public-search-filters';
import { showSignUp } from './modal/sign-up-modal';
import {
  SearchFilters,
  useHasUnsearchedChanges,
} from '../events/search-filters';
import {
  OptionGroup,
  OptionGroupButtons,
  OptionGroupCheckChips,
  OptionGroupInputs,
  OptionGroupRangeSlider,
  OptionGroupSlider,
  isOptionGroupButtons,
  isOptionGroupCheckChips,
  isOptionGroupRangeSlider,
  isOptionGroupSlider,
  searchBasicsOptionGroups,
} from '../data/option-groups';
import {
  QAndAFilterResults,
  SearchFilterList,
  TwoWayFilterToggles,
  advancedSearchFilterOptionGroups,
  countChangedAdvancedFilters,
  useColdStartSearchFilters,
  useQAndAFilters,
  withCurrentValue,
} from './search-filter-screen';
import { requestSearch, useIsSearching } from '../events/search-requests';

const ADVANCED_FILTERS = 'Advanced filters';
const Q_AND_A_ANSWERS = 'Q&A Answers';
const TWO_WAY_FILTERS = 'Two-way Filters';

const PanelHeading = ({ og, children }: {
  og: OptionGroup<OptionGroupInputs>
  children?: ReactNode
}) => {
  const { appTheme } = useAppTheme();
  const { Icon } = og;

  return (
    <View style={styles.heading}>
      {Icon &&
        <View style={styles.headingIcon}>
          <Icon color={appTheme.secondaryColor} />
        </View>
      }
      <View style={styles.headingTitle}>
        <DefaultText style={styles.headingText}>{og.title}</DefaultText>
        {children}
      </View>
    </View>
  );
};

const PanelCheckChips = ({ input }: { input: OptionGroupCheckChips }) => {
  const [isInvalid, setIsInvalid] = useState(false);
  const checked = useRef(new Set(
    input.checkChips.values.flatMap((v) => v.checked ? [v.label] : [])));

  const onChange = async (label: string, isChecked: boolean) => {
    if (isChecked) {
      checked.current.add(label);
    } else {
      checked.current.delete(label);
    }
    setIsInvalid(!(await input.checkChips.submit([...checked.current])));
  };

  return (
    <>
      <CheckChips>
        {input.checkChips.values.map((v) =>
          <CheckChip
            key={v.label}
            compact={true}
            label={v.label}
            initialCheckedState={v.checked}
            onChange={(isChecked) => onChange(v.label, isChecked)}
          />
        )}
      </CheckChips>
      {isInvalid &&
        <DefaultText style={styles.invalid}>
          You need to select at least one option
        </DefaultText>
      }
    </>
  );
};

const PanelButtons = ({ input }: { input: OptionGroupButtons }) => {
  const { values, currentValue, submit } = input.buttons;
  const [value, setValue] = useState(currentValue ?? '');

  const onPress = (index: number) => {
    setValue(values[index]);
    submit(values[index]);
  };

  return (
    <VerticalButtonGroup
      buttons={values}
      selectedIndex={values.indexOf(value)}
      onPress={onPress}
      containerStyle={styles.buttons}
    />
  );
};

const PanelRangeSlider = ({ og, input, isBasic }: {
  og: OptionGroup<OptionGroupInputs>
  input: OptionGroupRangeSlider
  isBasic: boolean
}) => {
  const { sliderMin, sliderMax, currentMin, currentMax, scale, submit } =
    input.rangeSlider;
  const [values, setValues] = useState([
    currentMin ?? sliderMin,
    currentMax ?? sliderMax,
  ]);
  const label = rangeSliderLabel(og.title, input.rangeSlider, values);

  return (
    <>
      {isBasic &&
        <PanelHeading og={og}>
          <SliderValue label={label} inHeading={true} />
        </PanelHeading>
      }
      {!isBasic && <SliderValue label={label} />}
      <View style={styles.slider}>
        <Slider
          minimumValue={sliderMin}
          maximumValue={sliderMax}
          values={values}
          hollow={[values[0] === sliderMin, values[1] === sliderMax]}
          onValuesChange={setValues}
          onSlidingComplete={([min, max]) => submit(
            min === sliderMin ? null : min,
            max === sliderMax ? null : max,
          )}
          scale={scale}
        />
      </View>
    </>
  );
};

const PanelSlider = ({ og, input }: {
  og: OptionGroup<OptionGroupInputs>
  input: OptionGroupSlider
}) => {
  const { slider } = input;
  const [value, setValue] = useState(slider.currentValue ?? slider.defaultValue);

  const isUnlimited = (v: number) =>
    !!slider.unlimitedLabel && v === slider.sliderMax;

  return (
    <>
      <PanelHeading og={og}>
        <SliderValue label={sliderLabel(slider, value)} inHeading={true} />
      </PanelHeading>
      <View style={styles.slider}>
        <Slider
          minimumValue={slider.sliderMin}
          maximumValue={slider.sliderMax}
          values={[value]}
          hollow={[isUnlimited(value)]}
          onValuesChange={([v]) => setValue(v)}
          onSlidingComplete={([v]) => slider.submit(isUnlimited(v) ? null : v)}
          scale={slider.scale}
        />
      </View>
      {slider.toggle &&
        <View style={styles.toggleRow}>
          <DefaultText>{slider.toggle.label}</DefaultText>
          <Toggle
            value={slider.toggle.currentValue ?? false}
            onValueChange={slider.toggle.submit}
          />
        </View>
      }
    </>
  );
};

const PanelInput = ({ og, isBasic = false }: {
  og: OptionGroup<OptionGroupInputs>
  isBasic?: boolean
}) => {
  const { input } = og;

  if (isOptionGroupCheckChips(input)) {
    return (
      <>
        {isBasic && <PanelHeading og={og} />}
        <PanelCheckChips input={input} />
      </>
    );
  }
  if (isOptionGroupButtons(input)) {
    return <PanelButtons input={input} />;
  }
  if (isOptionGroupRangeSlider(input)) {
    return <PanelRangeSlider og={og} input={input} isBasic={isBasic} />;
  }
  if (isOptionGroupSlider(input)) {
    return <PanelSlider og={og} input={input} />;
  }
  return null;
};

const promptSignUp = () =>
  showSignUp(true, 'Join or sign in to filter matches');

const submitPublicGender = async (gender: string[]) => {
  if (!gender.length) return false;
  setPublicSearchFilters({ gender });
  return true;
};

const submitPublicAge = async (min_age: number | null, max_age: number | null) => {
  setPublicSearchFilters({ age: { min_age, max_age } });
  return true;
};

const withPublicSubmit = (
  og: OptionGroup<OptionGroupInputs>,
): OptionGroup<OptionGroupInputs> => {
  const { input } = og;

  if (isOptionGroupCheckChips(input)) {
    return {
      ...og,
      input: { checkChips: { ...input.checkChips, submit: submitPublicGender } },
    };
  }
  if (isOptionGroupRangeSlider(input)) {
    return {
      ...og,
      input: { rangeSlider: { ...input.rangeSlider, submit: submitPublicAge } },
    };
  }
  return og;
};

const LockedSlider = ({ og }: { og: OptionGroup<OptionGroupInputs> }) => {
  const { appTheme } = useAppTheme();

  return (
    <Pressable onPress={promptSignUp}>
      <PanelHeading og={og}>
        <DefaultText style={{ color: appTheme.hintColor }}>Members only</DefaultText>
      </PanelHeading>
      <View style={[styles.slider, styles.lockedSlider]}>
        <View
          style={[
            styles.lockedTrack,
            { backgroundColor: appTheme.interactiveBorderColor },
          ]}
        />
        <View
          style={[styles.lockedThumb, { backgroundColor: appTheme.hintColor }]}
        />
      </View>
    </Pressable>
  );
};

const JoinBox = () =>
  <View style={styles.joinBox}>
    <DefaultText style={styles.joinText}>Join to use 20+ more filters</DefaultText>
    <ButtonWithCenteredText
      onPress={() => showSignUp(true)}
      containerStyle={styles.joinButton}
    >
      Join or sign in
    </ButtonWithCenteredText>
  </View>;

const BasicFilters = ({ data, isSignedOut }: {
  data: SearchFilters
  isSignedOut: boolean
}) => {
  const { appTheme } = useAppTheme();
  const [signedInUser] = useSignedInUser();

  return (
    <>
      {searchBasicsOptionGroups.map((og, i) =>
        <View
          key={og.title}
          style={[
            styles.section,
            { borderTopColor: appTheme.interactiveBorderColor },
            i === searchBasicsOptionGroups.length - 1 && styles.lastSection,
          ]}
        >
          {isSignedOut && isOptionGroupSlider(og.input) ?
            <LockedSlider og={og} /> :
            <PanelInput
              og={withCurrentValue(
                isSignedOut ? withPublicSubmit(og) : og,
                data,
                signedInUser,
              )}
              isBasic={true}
            />
          }
        </View>
      )}
    </>
  );
};

const FilterEditor = ({ title, data }: { title: string, data: SearchFilters }) => {
  const [signedInUser] = useSignedInUser();
  const og = advancedSearchFilterOptionGroups.find((og) => og.title === title);

  if (!og) {
    return null;
  }

  const current = withCurrentValue(og, data, signedInUser);
  const Description = current.description;

  return (
    <View style={styles.editor}>
      {typeof Description === 'string' &&
        <DefaultText style={styles.editorDescription}>{Description}</DefaultText>
      }
      {typeof Description !== 'string' && <Description />}
      <PanelInput og={current} />
    </View>
  );
};

const QAndAFilters = () => {
  const { appTheme } = useAppTheme();
  const qAndAFilters = useQAndAFilters();
  const {
    searchText,
    isLoading,
    clearSearchText,
    onChangeSearchText,
  } = qAndAFilters;

  return (
    <>
      <View>
        <DefaultTextInput
          placeholder="Search questions..."
          value={searchText}
          onChangeText={onChangeSearchText}
          autoFocus={true}
          style={styles.searchInput}
        />
        {searchText !== '' &&
          <Pressable
            aria-label="Clear search"
            onPress={clearSearchText}
            style={styles.clearSearch}
          >
            <Ionicons
              style={{ fontSize: 20, color: appTheme.secondaryColor }}
              name="close"
            />
          </Pressable>
        }
      </View>
      {isLoading &&
        <LogoActivityIndicator
          style={styles.qAndALoading}
          size="large"
          color={appTheme.brandColor}
        />
      }
      {!isLoading && <QAndAFilterResults {...qAndAFilters} />}
    </>
  );
};

const PanelBody = ({ title, data, isSignedOut, open }: {
  title: string | undefined
  data: SearchFilters
  isSignedOut: boolean
  open: (title: string) => void
}) => {
  const openOrJoin = isSignedOut ? promptSignUp : open;

  const OptionButton = useCallback(
    ({ optionGroups, setting }: {
      optionGroups: OptionGroup<OptionGroupInputs>[]
      setting?: string
    }) =>
      <ButtonForOption
        optionGroups={optionGroups}
        setting={setting}
        noSettingText="Any"
        onPress={() => openOrJoin(optionGroups[0].title)}
      />,
    [openOrJoin],
  );

  if (title === undefined) {
    return <BasicFilters data={data} isSignedOut={isSignedOut} />;
  }
  if (title === ADVANCED_FILTERS) {
    return (
      <>
        {isSignedOut && <JoinBox />}
        <SearchFilterList
          OptionButton={OptionButton}
          onPressTwoWayFilters={() => openOrJoin(TWO_WAY_FILTERS)}
          onPressQAndAAnswers={() => openOrJoin(Q_AND_A_ANSWERS)}
        />
      </>
    );
  }
  if (title === Q_AND_A_ANSWERS) {
    return <QAndAFilters />;
  }
  if (title === TWO_WAY_FILTERS) {
    return <TwoWayFilterToggles />;
  }
  return <FilterEditor title={title} data={data} />;
};

const SearchFilterPanel = () => {
  const { appTheme } = useAppTheme();
  const [signedInUser] = useSignedInUser();
  const isSignedOut = useIsWebLoggedOut();
  const data = useColdStartSearchFilters();
  const hasUnsearchedChanges = useHasUnsearchedChanges();
  const isSearching = useIsSearching();
  const [path, setPath] = useState<string[]>([]);

  const open = useCallback(
    (title: string) => setPath((path) => [...path, title]),
    [],
  );

  const back = useCallback(() => setPath((path) => path.slice(0, -1)), []);

  const title = _.last(path);
  const isBasics = title === undefined;
  const numAdvancedFilters = data && !isSignedOut ?
    countChangedAdvancedFilters(data, signedInUser) : 0;

  return (
    <SidePanelCard style={isBasics ? styles.fitCard : styles.fullCard}>
      {isBasics &&
        <View style={styles.basicsHeading}>
          <SidePanelHeading isFirst={true}>Search filters</SidePanelHeading>
        </View>
      }
      {!isBasics &&
        <View style={styles.drilledHeading}>
          <Pressable aria-label="Back" onPress={back} style={styles.back}>
            <Ionicons
              style={{ fontSize: 24, color: appTheme.secondaryColor }}
              name="arrow-back"
            />
          </Pressable>
          <DefaultText style={styles.drilledTitle}>{title}</DefaultText>
        </View>
      }
      <ScrollView
        key={title}
        style={isBasics ? styles.fitScroll : styles.fullScroll}
        contentContainerStyle={
          isBasics ?
            undefined :
            [
              styles.drilledContent,
              { borderTopColor: appTheme.interactiveBorderColor },
            ]
        }
      >
        {!data &&
          <LogoActivityIndicator
            style={styles.loading}
            size="large"
            color={appTheme.brandColor}
          />
        }
        {data &&
          <PanelBody
            title={title}
            data={data}
            isSignedOut={isSignedOut}
            open={open}
          />
        }
      </ScrollView>
      <View
        style={[
          styles.footer,
          { borderTopColor: appTheme.interactiveBorderColor },
        ]}
      >
        {hasUnsearchedChanges &&
          <View style={styles.noticeRow} pointerEvents="none">
            <DefaultText
              style={[
                styles.notice,
                {
                  color: appTheme.brandColor,
                  backgroundColor: appTheme.primaryColor,
                },
              ]}
            >
              Search to apply your changes
            </DefaultText>
          </View>
        }
        {isBasics &&
          <ButtonWithCenteredText
            secondary={true}
            onPress={() => open(ADVANCED_FILTERS)}
            icon={
              <Ionicons
                style={{ fontSize: 18, color: appTheme.secondaryColor }}
                name="options-outline"
              />
            }
            containerStyle={styles.footerButton}
          >
            {ADVANCED_FILTERS}
            {isSignedOut &&
              <>
                {'  '}
                <Ionicons
                  style={[styles.lock, { color: appTheme.hintColor }]}
                  name="lock-closed"
                />
              </>
            }
            {numAdvancedFilters > 0 &&
              <>
                {'  '}
                <DefaultText style={styles.badge}>
                  {numAdvancedFilters}
                </DefaultText>
              </>
            }
          </ButtonWithCenteredText>
        }
        <ButtonWithCenteredText
          onPress={requestSearch}
          loading={isSearching}
          icon={<Ionicons style={styles.searchIcon} name="search" />}
          containerStyle={styles.footerButton}
        >
          Search
        </ButtonWithCenteredText>
      </View>
    </SidePanelCard>
  );
};

const styles = StyleSheet.create({
  fitCard: {
    flexShrink: 1,
  },
  fullCard: {
    flex: 1,
  },
  fitScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  fullScroll: {
    flex: 1,
  },
  loading: {
    margin: 20,
  },
  basicsHeading: {
    paddingBottom: 6,
  },
  drilledHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 4,
    paddingLeft: 4,
    paddingRight: 16,
  },
  back: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  drilledTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '900',
  },
  drilledContent: {
    paddingTop: 14,
    paddingHorizontal: 16,
    paddingBottom: 20,
    borderTopWidth: 1,
  },
  section: {
    paddingTop: 14,
    paddingBottom: 14,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    gap: 4,
  },
  lastSection: {
    paddingBottom: 20,
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 2,
  },
  headingIcon: {
    height: 19,
    justifyContent: 'center',
  },
  headingTitle: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    columnGap: 8,
  },
  headingText: {
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 19,
  },
  slider: {
    marginTop: 5,
    marginHorizontal: 10,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
    marginHorizontal: 10,
  },
  invalid: {
    textAlign: 'center',
    color: 'red',
  },
  editor: {
    gap: 14,
  },
  editorDescription: {
    textAlign: 'center',
  },
  buttons: {
    borderRadius: 10,
  },
  searchInput: {
    marginLeft: 0,
    marginRight: 0,
    height: 44,
    paddingRight: 40,
    fontSize: 15,
  },
  clearSearch: {
    position: 'absolute',
    right: 4,
    top: 4,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qAndALoading: {
    marginTop: 40,
  },
  footer: {
    paddingTop: 20,
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderTopWidth: 1,
    gap: 10,
  },
  noticeRow: {
    position: 'absolute',
    top: -9,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  notice: {
    paddingHorizontal: 10,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '600',
  },
  footerButton: {
    marginTop: 0,
    marginBottom: 0,
  },
  badge: {
    fontSize: 12,
    fontWeight: '700',
    color: 'white',
    backgroundColor: '#70f',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  lock: {
    fontSize: 16,
  },
  lockedSlider: {
    height: 40,
    justifyContent: 'center',
    opacity: 0.5,
  },
  lockedTrack: {
    height: 4,
    borderRadius: 2,
    marginHorizontal: 16,
  },
  lockedThumb: {
    position: 'absolute',
    left: '55%',
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  joinBox: {
    marginBottom: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: 'rgb(228, 204, 255)',
    alignItems: 'center',
    gap: 10,
  },
  joinText: {
    color: 'black',
    fontWeight: '700',
    textAlign: 'center',
  },
  joinButton: {
    width: '100%',
    height: 44,
    marginTop: 0,
    marginBottom: 0,
  },
  searchIcon: {
    fontSize: 18,
    color: 'white',
  },
});

export {
  SearchFilterPanel,
};
