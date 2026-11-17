import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { Pressable } from '../pressable';
import { IconButton } from '../button/icon-button';
import Animated, {
  SharedValue,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'react-native-feather';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faHeart } from '@fortawesome/free-solid-svg-icons';
import { DefaultText } from '../default-text';
import { DefaultModal } from './default-modal';
import { backgroundColors } from './background-colors';
import { ButtonWithCenteredText } from '../button/centered-text';
import { LogoActivityIndicator } from '../logo/logo-activity-indicator';
import { listen, notify } from '../../events/events';
import { setSignedInUser, useSignedInUser } from '../../events/signed-in-user';
import { getOffering } from '../../purchases/purchases';
import {
  Offering,
  Purchasable,
  byCycleLength,
  intervalText,
  renewalText,
  weeksIn,
} from '../../purchases/offering';
import {
  FEATURES,
  PointOfSaleFeature,
  brandColor,
  goldColor,
} from './point-of-sale-features';
import { Arm, armOf } from './point-of-sale-arms';
import { pluralize } from '../../util/util';

const fadedWhite = 'rgba(255, 255, 255, 0.85)';

const showPointOfSale = (feature: PointOfSaleFeature) => {
  notify<PointOfSaleFeature | null>('show-point-of-sale', feature);
};

const hidePointOfSale = () => {
  notify<PointOfSaleFeature | null>('show-point-of-sale', null);
};

const usePointOfSale = () => {
  const [feature, setFeature] = useState<PointOfSaleFeature>('read-receipts');
  const [openings, setOpenings] = useState(0);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    return listen<PointOfSaleFeature | null>(
      'show-point-of-sale',
      (x) => {
        if (x === undefined) {
          return;
        }

        setIsVisible(x !== null);

        if (x !== null) {
          setFeature(x);
          setOpenings((n) => n + 1);
        }
      }
    );
  }, []);

  return { feature, openings, isVisible };
};

const PurchaseButton = ({
  label,
  compact,
  onPress,
}: {
  label: string
  compact: boolean
  onPress: () => Promise<void>,
}) => {
  const [loading, setLoading] = useState(false);

  const _onPress = useCallback(async () => {
    setLoading(true);
    await onPress();
    setLoading(false);
  }, [onPress]);

  return (
    <ButtonWithCenteredText
      onPress={_onPress}
      textStyle={{ fontWeight: 800 }}
      containerStyle={{ marginTop: 0, marginBottom: 0, height: compact ? 48 : 50 }}
      backgroundColor={goldColor}
      borderColor="black"
      borderWidth={3}
      textColor="black"
      loading={loading}
    >
      {label}
    </ButtonWithCenteredText>
  );
};

const useSelectedColor = (selected: SharedValue<number>, from: string, to: string) =>
  useAnimatedStyle(() => ({
    color: interpolateColor(selected.value, [0, 1], [from, to]),
  }));

const PlanCard = ({
  purchasable,
  isSelected,
  compact,
  slim,
  onPress,
}: {
  purchasable: Purchasable
  isSelected: boolean
  compact: boolean
  slim: boolean
  onPress: () => void
}) => {
  const { cycle, price, pricePerWeek, trial } = purchasable;
  const selected = useSharedValue(isSelected ? 1 : 0);

  useEffect(() => {
    selected.value = withTiming(isSelected ? 1 : 0, { duration: 180 });
  }, [isSelected, selected]);

  const cardStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      selected.value, [0, 1], ['rgba(255, 255, 255, 0.12)', '#ffffff']),
    transform: [{ scale: 1 + (slim ? 0 : 0.06) * selected.value }],
  }));
  const ringStyle = useAnimatedStyle(() => ({ opacity: selected.value }));
  const accentStyle = useSelectedColor(selected, '#ffffff', brandColor);
  const inkStyle = useSelectedColor(selected, '#ffffff', '#000000');
  const subStyle = useSelectedColor(selected, 'rgba(255, 255, 255, 0.9)', '#666666');

  return (
    <Pressable
      onPress={onPress}
      style={{ flex: 1, zIndex: trial ? 2 : 1 }}
    >
      <Animated.View
        style={[
          {
            height: slim ? (compact ? 64 : 68) : (compact ? 110 : 132),
            borderRadius: 10,
            borderWidth: 1,
            borderColor: 'rgba(255, 255, 255, 0.35)',
            alignItems: 'center',
            justifyContent: 'center',
          },
          cardStyle,
        ]}
      >
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: -3,
              left: -3,
              right: -3,
              bottom: -3,
              borderRadius: 12,
              borderWidth: 3,
              borderColor: 'black',
            },
            ringStyle,
          ]}
        />
        {!slim &&
          <DefaultText
            animated
            animatedStyle={accentStyle}
            disableTheme
            style={{
              fontSize: compact ? 22 : 26,
              lineHeight: compact ? 26 : 30,
              fontWeight: 900,
            }}
          >
            {cycle.units}
          </DefaultText>
        }
        <DefaultText
          animated
          animatedStyle={accentStyle}
          disableTheme
          style={{
            fontSize: compact || slim ? 12 : 13,
            lineHeight: compact || slim ? 16 : 18,
            fontWeight: 800,
          }}
        >
          {slim && `${cycle.units} `}{pluralize(cycle.unit, cycle.units).toUpperCase()}
        </DefaultText>
        <DefaultText
          animated
          animatedStyle={inkStyle}
          disableTheme
          style={{
            marginTop: slim ? 0 : (compact ? 6 : 10),
            fontSize: slim ? (compact ? 14 : 15) : (compact ? 13 : 14),
            lineHeight: slim ? (compact ? 18 : 20) : (compact ? 16 : 18),
            fontWeight: 700,
          }}
        >
          {price}
        </DefaultText>
        {weeksIn(cycle) !== 1 && pricePerWeek !== null &&
          <DefaultText
            animated
            animatedStyle={subStyle}
            disableTheme
            style={{
              fontSize: 11,
              lineHeight: 14,
              fontWeight: 500,
            }}
          >
            {pricePerWeek}/wk
          </DefaultText>
        }
        {trial &&
          <View
            style={{
              position: 'absolute',
              top: -14,
              right: -8,
              backgroundColor: goldColor,
              paddingVertical: 4,
              paddingHorizontal: 8,
              borderRadius: 999,
              borderWidth: 2,
              borderColor: 'black',
              transform: [{ rotate: '8deg' }],
            }}
          >
            <DefaultText
              disableTheme
              style={{ color: 'black', fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' }}
            >
              FREE TRIAL
            </DefaultText>
          </View>
        }
      </Animated.View>
    </Pressable>
  );
};

const OfferingCard = ({
  feature,
  arm,
  compact,
}: {
  feature: PointOfSaleFeature
  arm: Arm
  compact: boolean
}) => {
  const [offering, setOffering] = useState<Offering | null>();
  const [picked, setPicked] = useState<Purchasable | null>(null);
  const [hasError, setHasError] = useState(false);
  const [active, setActive] = useState(
    () => FEATURES.findIndex((f) => f.key === feature));

  useEffect(() => {
    getOffering().then(setOffering, () => setOffering(null));
  }, []);

  if (!offering) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        {offering === null
          ? <DefaultText
              disableTheme
              style={{ color: 'white', textAlign: 'center', fontWeight: 500 }}
            >
              Something went wrong
            </DefaultText>
          : <LogoActivityIndicator size="large" color="white" />
        }
      </View>
    );
  }

  const purchasables = byCycleLength(offering.purchasables);
  const withTrial = purchasables.find((p) => p.trial);
  const middle = purchasables[Math.floor(purchasables.length / 2)];
  const chosen = picked ?? withTrial ?? middle;
  const trial = chosen.trial;
  const missionMarginTop = arm.missionMarginTop(compact);

  const onPress = async () => {
    setHasError(false);

    const result = await chosen.purchase();

    if (result === 'failed') {
      setHasError(true);
      return;
    }

    if (result === 'cancelled') {
      return;
    }

    setSignedInUser((u) => {
      if (!u) {
        return u;
      }

      return {
        ...u,
        hasGold: true,
      };
    });

    hidePointOfSale();
  };

  return (
    <>
      <ScrollView>
        <arm.Above active={active} setActive={setActive} compact={compact} />
        <View
          style={{
            marginTop: arm.plansMarginTop(compact),
            height: arm.hasSlimPlans ? undefined : (compact ? 120 : 144),
            paddingHorizontal: 24,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {purchasables.map((purchasable) =>
            <PlanCard
              key={weeksIn(purchasable.cycle)}
              purchasable={purchasable}
              isSelected={purchasable === chosen}
              compact={compact}
              slim={arm.hasSlimPlans}
              onPress={() => setPicked(purchasable)}
            />
          )}
        </View>
        {arm.Below && <arm.Below active={active} setActive={setActive} compact={compact} />}
        {missionMarginTop !== null &&
          <View
            style={{
              marginTop: missionMarginTop,
              paddingHorizontal: 24,
              flexDirection: 'row',
              gap: 5,
            }}
          >
            <FontAwesomeIcon
              icon={faHeart}
              size={12}
              color={goldColor}
              style={{ marginTop: 2 }}
            />
            <DefaultText
              disableTheme
              style={{
                flex: 1,
                fontSize: 12,
                lineHeight: compact ? 16 : 17,
                fontWeight: 500,
                color: fadedWhite,
              }}
            >
              <DefaultText disableTheme style={{ fontWeight: 700, color: 'white' }}>
                Gold keeps Duolicious going.
              </DefaultText>
              {} It covers the servers, so the core app stays free and open source.
            </DefaultText>
          </View>
        }
      </ScrollView>
      <View
        style={{
          paddingTop: 16,
          paddingHorizontal: 16,
          paddingBottom: compact ? 14 : 22,
          gap: 16,
        }}
      >
        {hasError &&
          <DefaultText
            disableTheme
            style={{ color: 'white', textAlign: 'center', fontWeight: 700 }}
          >
            Something went wrong
          </DefaultText>
        }
        <PurchaseButton
          label={trial ? `Try ${intervalText(trial)} free` : arm.cta(FEATURES[active])}
          compact={compact}
          onPress={onPress}
        />
        <DefaultText
          disableTheme
          style={{
            textAlign: 'center',
            fontSize: compact ? 11 : 12,
            lineHeight: 16,
            fontWeight: 500,
            color: fadedWhite,
          }}
        >
          <DefaultText
            disableTheme
            style={{ fontWeight: 800, color: trial ? 'white' : 'transparent' }}
          >
            {trial && `${intervalText(trial)} free, then ${renewalText(chosen)}.`}{'\n'}
          </DefaultText>
          Subscription renews automatically. Cancel anytime.
        </DefaultText>
      </View>
    </>
  );
};

const PointOfSaleModal = () => {
  const { feature, openings, isVisible } = usePointOfSale();
  const [signedInUser] = useSignedInUser();
  const arm = armOf(signedInUser?.personId);
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isFullScreen = width < 600;
  const cardInsets = isFullScreen ? insets : { top: 0, bottom: 0, left: 0, right: 0 };
  const cardMargin = (inset: number) => isFullScreen ? 0 : 20 + inset;
  const availableHeight = isFullScreen
    ? height - insets.bottom
    : Math.min(height - cardMargin(insets.top) - cardMargin(insets.bottom), 844);
  const compact = availableHeight < 760;
  const cardWidth = isFullScreen ? width : 390;

  return (
    <DefaultModal
      transparent={true}
      visible={isVisible}
      onRequestClose={hidePointOfSale}
    >
      <View
        style={{
          width: '100%',
          height: '100%',
          justifyContent: 'center',
          alignItems: 'center',
          paddingTop: cardMargin(insets.top),
          paddingBottom: cardMargin(insets.bottom),
          paddingLeft: cardMargin(insets.left),
          paddingRight: cardMargin(insets.right),
          ...backgroundColors.dark,
        }}
      >
        <View
          style={{
            width: cardWidth,
            height: '100%',
            maxHeight: isFullScreen ? undefined : 844,
            borderRadius: isFullScreen ? 0 : 16,
            overflow: 'hidden',
            backgroundColor: brandColor,
            paddingBottom: cardInsets.bottom,
            paddingLeft: cardInsets.left,
            paddingRight: cardInsets.right,
          }}
        >
          <View
            style={{
              height: 44,
              marginTop: Math.max(compact ? 20 : 50, cardInsets.top),
              paddingHorizontal: 8,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'flex-end',
            }}
          >
            {arm.hasTitle &&
              <DefaultText
                disableTheme
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  textAlign: 'center',
                  fontSize: 17,
                  fontWeight: 700,
                  color: 'white',
                }}
              >
                Get Gold
              </DefaultText>
            }
            <IconButton label="Close" onPress={hidePointOfSale} padding={10}>
              <X stroke="white" strokeWidth={3} width={24} height={24} />
            </IconButton>
          </View>
          <OfferingCard
            key={openings}
            feature={feature}
            arm={arm}
            compact={compact}
          />
        </View>
      </View>
    </DefaultModal>
  );
};

export {
  PointOfSaleFeature,
  showPointOfSale,
  PointOfSaleModal,
};
