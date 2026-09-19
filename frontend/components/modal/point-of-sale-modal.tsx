import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import Animated, {
  SharedValue,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { X } from 'react-native-feather';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faHeart } from '@fortawesome/free-solid-svg-icons';
import { DefaultText } from '../default-text';
import { DefaultModal } from './default-modal';
import { backgroundColors } from './background-colors';
import { ButtonWithCenteredText } from '../button/centered-text';
import { LogoActivityIndicator } from '../logo/logo-activity-indicator';
import { listen, notify } from '../../events/events';
import { setSignedInUser } from '../../events/signed-in-user';
import { getOffering } from '../../purchases/purchases';
import {
  Offering,
  Purchasable,
  byCycleLength,
  intervalText,
  monthsIn,
  renewalText,
} from '../../purchases/offering';
import {
  FEATURES,
  PointOfSaleFeature,
  brandColor,
  goldColor,
} from './point-of-sale-features';
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
        }
      }
    );
  }, []);

  return { feature, isVisible };
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
  onPress,
}: {
  purchasable: Purchasable
  isSelected: boolean
  compact: boolean
  onPress: () => void
}) => {
  const { cycle, price, pricePerMonth, trial } = purchasable;
  const selected = useSharedValue(isSelected ? 1 : 0);

  useEffect(() => {
    selected.value = withTiming(isSelected ? 1 : 0, { duration: 180 });
  }, [isSelected, selected]);

  const cardStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      selected.value, [0, 1], ['rgba(255, 255, 255, 0.12)', '#ffffff']),
    transform: [{ scale: 1 + 0.06 * selected.value }],
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
            height: compact ? 110 : 132,
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
        <DefaultText
          animated
          animatedStyle={accentStyle}
          disableTheme
          style={{
            fontSize: compact ? 12 : 13,
            lineHeight: compact ? 16 : 18,
            fontWeight: 800,
          }}
        >
          {pluralize(cycle.unit, cycle.units).toUpperCase()}
        </DefaultText>
        <DefaultText
          animated
          animatedStyle={inkStyle}
          disableTheme
          style={{
            marginTop: compact ? 6 : 10,
            fontSize: compact ? 13 : 14,
            lineHeight: compact ? 16 : 18,
            fontWeight: 700,
          }}
        >
          {price}
        </DefaultText>
        {monthsIn(cycle) !== 1 && pricePerMonth !== null &&
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
            {pricePerMonth}/mo
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
              style={{ color: 'black', fontSize: 11, fontWeight: 800 }}
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
  compact,
}: {
  feature: PointOfSaleFeature
  compact: boolean
}) => {
  const [offering, setOffering] = useState<Offering | null>();
  const [picked, setPicked] = useState<Purchasable | null>(null);
  const [hasError, setHasError] = useState(false);
  const { headline, subtitle, cta, Illustration } = FEATURES[feature];

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
      <View
        style={{
          marginTop: compact ? 8 : 16,
          height: compact ? 96 : 150,
          alignItems: 'center',
        }}
      >
        <View
          style={{
            width: 240,
            height: 150,
            transform: [{ scale: compact ? 0.64 : 1 }],
            transformOrigin: 'top',
          }}
        >
          <Illustration />
        </View>
      </View>
      <View style={{ marginTop: compact ? 12 : 20, paddingHorizontal: 24 }}>
        {headline.map((line, i) =>
          <DefaultText
            key={line}
            disableTheme
            style={{
              fontSize: compact ? 28 : 34,
              lineHeight: compact ? 32 : 38,
              fontWeight: 900,
              color: i === 0 ? 'white' : goldColor,
            }}
          >
            {line}
          </DefaultText>
        )}
      </View>
      <DefaultText
        disableTheme
        style={{
          marginTop: compact ? 8 : 10,
          paddingHorizontal: 24,
          fontSize: compact ? 15 : 16,
          lineHeight: compact ? 21 : 22,
          color: 'white',
        }}
      >
        {subtitle}
      </DefaultText>
      <View
        style={{
          marginTop: compact ? 22 : 24,
          height: compact ? 120 : 144,
          paddingHorizontal: 24,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        }}
      >
        {purchasables.map((purchasable) =>
          <PlanCard
            key={monthsIn(purchasable.cycle)}
            purchasable={purchasable}
            isSelected={purchasable === chosen}
            compact={compact}
            onPress={() => setPicked(purchasable)}
          />
        )}
      </View>
      <View
        style={{
          marginTop: compact ? 16 : 18,
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
      <View style={{ flex: 1, minHeight: 16 }} />
      <View
        style={{
          paddingHorizontal: 16,
          paddingBottom: compact ? 14 : trial ? 22 : 36,
          gap: trial ? 16 : 8,
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
          label={trial ? `Try ${intervalText(trial)} free` : cta}
          compact={compact}
          onPress={onPress}
        />
        <DefaultText
          disableTheme
          style={{
            textAlign: 'center',
            fontSize: compact ? 11 : 12,
            lineHeight: trial ? 16 : 18,
            fontWeight: 500,
            color: fadedWhite,
          }}
        >
          {trial &&
            <DefaultText disableTheme style={{ fontWeight: 800, color: 'white' }}>
              {intervalText(trial)} free, then {renewalText(chosen)}.{'\n'}
            </DefaultText>
          }
          Subscription renews automatically. Cancel anytime.
        </DefaultText>
      </View>
    </>
  );
};

const PointOfSaleModal = () => {
  const { feature, isVisible } = usePointOfSale();
  const { width, height } = useWindowDimensions();
  const isFullScreen = width < 600;
  const cardHeight = isFullScreen ? height : Math.min(height - 40, 844);
  const compact = cardHeight < 760;

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
          padding: isFullScreen ? 0 : 20,
          ...backgroundColors.dark,
        }}
      >
        <View
          style={{
            width: '100%',
            height: '100%',
            maxWidth: isFullScreen ? undefined : 390,
            maxHeight: isFullScreen ? undefined : 844,
            borderRadius: isFullScreen ? 0 : 16,
            overflow: 'hidden',
            backgroundColor: brandColor,
          }}
        >
          <View
            style={{
              height: 44,
              marginTop: compact ? 20 : 50,
              paddingHorizontal: 8,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'flex-end',
            }}
          >
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
            <Pressable
              onPress={hidePointOfSale}
              style={{
                width: 44,
                height: 44,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <X stroke="white" strokeWidth={3} width={24} height={24} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
            <OfferingCard feature={feature} compact={compact} />
          </ScrollView>
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
