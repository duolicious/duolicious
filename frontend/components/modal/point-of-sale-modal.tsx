import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
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
  savings,
  weeksIn,
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

const PlanCard = ({
  purchasable,
  purchasables,
  isSelected,
  isPopular,
  compact,
  onPress,
}: {
  purchasable: Purchasable
  purchasables: Purchasable[]
  isSelected: boolean
  isPopular: boolean
  compact: boolean
  onPress: () => void
}) => {
  const accent = isSelected ? brandColor : 'white';
  const ink = isSelected ? 'black' : 'white';
  const { cycle, price, pricePerWeek } = purchasable;
  const saving = savings(purchasable, purchasables);

  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        height: compact ? 110 : 132,
        borderRadius: 10,
        borderWidth: isSelected ? 3 : 1,
        borderColor: isSelected ? 'black' : 'rgba(255, 255, 255, 0.35)',
        backgroundColor: isSelected ? 'white' : 'rgba(255, 255, 255, 0.12)',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: isPopular ? 2 : 1,
        transform: [{ scale: isSelected ? 1.06 : 1 }],
      }}
    >
      {isPopular &&
        <DefaultText
          disableTheme
          style={{
            fontSize: 10,
            lineHeight: 14,
            fontWeight: 800,
            letterSpacing: 0.3,
            color: isSelected ? brandColor : goldColor,
            marginBottom: compact ? 2 : 4,
          }}
        >
          MOST POPULAR
        </DefaultText>
      }
      <DefaultText
        disableTheme
        style={{
          fontSize: compact ? 22 : 26,
          lineHeight: compact ? 26 : 30,
          fontWeight: 900,
          color: accent,
        }}
      >
        {cycle.units}
      </DefaultText>
      <DefaultText
        disableTheme
        style={{
          fontSize: compact ? 12 : 13,
          lineHeight: compact ? 16 : 18,
          fontWeight: 800,
          color: accent,
        }}
      >
        {pluralize(cycle.unit, cycle.units).toUpperCase()}
      </DefaultText>
      <DefaultText
        disableTheme
        style={{
          marginTop: compact ? 6 : 10,
          fontSize: compact ? 13 : 14,
          lineHeight: compact ? 16 : 18,
          fontWeight: 700,
          color: ink,
        }}
      >
        {price}
      </DefaultText>
      {weeksIn(cycle) !== 1 && pricePerWeek !== null &&
        <DefaultText
          disableTheme
          style={{
            fontSize: 11,
            lineHeight: 14,
            fontWeight: 500,
            color: isSelected ? '#666666' : 'rgba(255, 255, 255, 0.9)',
          }}
        >
          {pricePerWeek}/wk
        </DefaultText>
      }
      {isPopular && saving > 0 &&
        <View
          style={{
            position: 'absolute',
            top: -10,
            right: -4,
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
            SAVE {saving}%
          </DefaultText>
        </View>
      }
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
  const popular = purchasables[Math.floor(purchasables.length / 2)];
  const chosen = picked ?? popular;

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
            key={weeksIn(purchasable.cycle)}
            purchasable={purchasable}
            purchasables={purchasables}
            isSelected={purchasable === chosen}
            isPopular={purchasable === popular}
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
          paddingBottom: compact ? 14 : 36,
          gap: 8,
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
        <PurchaseButton label={cta} compact={compact} onPress={onPress} />
        <DefaultText
          disableTheme
          style={{
            textAlign: 'center',
            fontSize: compact ? 11 : 12,
            lineHeight: 18,
            fontWeight: 500,
            color: fadedWhite,
          }}
        >
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
