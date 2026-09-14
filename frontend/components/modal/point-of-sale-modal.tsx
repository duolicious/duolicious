import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { DefaultText } from '../default-text';
import { DefaultModal } from './default-modal';
import { backgroundColors } from './background-colors';
import { ButtonWithCenteredText } from '../button/centered-text';
import { Logo14 } from '../logo';
import { LogoActivityIndicator } from '../logo/logo-activity-indicator';
import { Close } from '../button/close';
import { listen, notify } from '../../events/events';
import { setSignedInUser } from '../../events/signed-in-user';
import { getOffering } from '../../purchases/purchases';
import {
  Offering,
  OfferingInterval,
  Purchasable,
  bestValue,
  byCycleLength,
  savings,
} from '../../purchases/offering';
import { pluralize } from '../../util/util';
import * as _ from 'lodash';

const brandColor = '#70f';

const showPointOfSale = (feature: string) => {
  notify<string | null>('show-point-of-sale', feature);
};

const hidePointOfSale = () => {
  notify<string | null>('show-point-of-sale', null);
};

const usePointOfSale = () => {
  const [feature, setFeature] = useState('');
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    return listen<string | null>(
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

const intervalLabel = ({ units, unit }: OfferingInterval) =>
  `${units} ${pluralize(unit, units)}`;

const PurchaseButton = ({
  label,
  onPress,
}: {
  label: string
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
      textStyle={{
        fontWeight: 700,
      }}
      containerStyle={{
        marginTop: 0,
        marginBottom: 0,
      }}
      backgroundColor="white"
      textColor={brandColor}
      loading={loading}
    >
      {label}
    </ButtonWithCenteredText>
  );
};

const PriceOption = ({
  purchasable,
  isSelected,
  saving,
  onPress,
}: {
  purchasable: Purchasable
  isSelected: boolean
  saving: number
  onPress: () => void
}) => {
  const color = isSelected ? brandColor : 'white';
  const { cycle, trial, price } = purchasable;

  return (
    <Pressable
      onPress={onPress}
      style={{
        borderRadius: 14,
        borderWidth: 2,
        borderColor: isSelected ? 'white' : 'rgba(255, 255, 255, 0.5)',
        backgroundColor: isSelected ? 'white' : 'transparent',
        paddingHorizontal: 18,
        paddingVertical: 14,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
      }}
    >
      <View style={{ flexShrink: 1 }}>
        <DefaultText
          disableTheme
          style={{ color, fontWeight: 700, fontSize: 18 }}
        >
          {intervalLabel(cycle)}
        </DefaultText>
        {trial &&
          <DefaultText disableTheme style={{ color, fontSize: 13 }}>
            {intervalLabel(trial)} free, then
          </DefaultText>
        }
      </View>
      <DefaultText
        disableTheme
        style={{ color, fontWeight: 700, fontSize: 18 }}
      >
        {price}
        <DefaultText
          disableTheme
          style={{ color, fontWeight: 400, fontSize: 14 }}
        >
          {} / {cycle.units === 1 ? cycle.unit : intervalLabel(cycle)}
        </DefaultText>
      </DefaultText>
      {saving > 0 &&
        <View
          style={{
            position: 'absolute',
            top: -12,
            right: 14,
            backgroundColor: '#ffd700',
            borderRadius: 999,
            paddingHorizontal: 10,
            paddingVertical: 3,
          }}
        >
          <DefaultText
            disableTheme
            style={{ color: 'black', fontWeight: 900, fontSize: 12 }}
          >
            SAVE {saving}%
          </DefaultText>
        </View>
      }
    </Pressable>
  );
};

const OfferingCard = ({ feature }: { feature: string }) => {
  const [offering, setOffering] = useState<Offering | null>();
  const [selected, setSelected] = useState<Purchasable | null>(null);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    getOffering().then(setOffering, () => setOffering(null));
  }, []);

  if (offering === undefined) {
    return (
      <View style={{ alignItems: 'center' }}>
        <LogoActivityIndicator size="large" color="white" />
      </View>
    );
  }

  if (offering === null) {
    return (
      <DefaultText
        disableTheme
        style={{ color: 'white', textAlign: 'center', fontWeight: 500 }}
      >
        Something went wrong
      </DefaultText>
    );
  }

  const purchasables = byCycleLength(offering.purchasables);
  const chosen = selected ?? bestValue(purchasables);

  const buttonCta = chosen.trial
    ? `Try ${chosen.trial.units} ${_.capitalize(pluralize(chosen.trial.unit, chosen.trial.units))} Free`
    : `Get ${offering.product_name}`;

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
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
        }}
      >
        <Logo14 size={28} color="white" rectSize={0.3} />
        <DefaultText
          disableTheme
          style={{ fontFamily: 'TruenoBold', fontSize: 16, color: 'white' }}
        >
          Duolicious
        </DefaultText>
      </View>
      <View style={{ gap: 8 }}>
        <DefaultText
          disableTheme
          style={{
            fontSize: 30,
            fontWeight: 900,
            color: 'white',
            textAlign: 'center',
          }}
        >
          {feature}
        </DefaultText>
        <DefaultText
          disableTheme
          style={{ color: 'white', textAlign: 'center' }}
        >
          Here’s everything you get with {offering.product_name}:
        </DefaultText>
      </View>
      <DefaultText
        disableTheme
        style={{ color: 'white', lineHeight: 22, alignSelf: 'center' }}
      >
        {offering.description}
      </DefaultText>
      <View style={{ gap: 14 }}>
        {purchasables.map((purchasable) =>
          <PriceOption
            key={intervalLabel(purchasable.cycle)}
            purchasable={purchasable}
            isSelected={purchasable === chosen}
            saving={savings(purchasable, purchasables)}
            onPress={() => setSelected(purchasable)}
          />
        )}
      </View>
      <View style={{ gap: 10 }}>
        <PurchaseButton label={buttonCta} onPress={onPress} />
        {hasError &&
          <DefaultText
            disableTheme
            style={{ color: 'white', textAlign: 'center', fontWeight: 700 }}
          >
            Something went wrong
          </DefaultText>
        }
        <DefaultText
          disableTheme
          style={{
            fontSize: 12,
            color: 'rgba(255, 255, 255, 0.8)',
            textAlign: 'center',
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
  const { width } = useWindowDimensions();
  const isFullScreen = width < 600;

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
            maxWidth: isFullScreen ? undefined : 480,
            maxHeight: isFullScreen ? undefined : 800,
            borderRadius: isFullScreen ? 0 : 16,
            overflow: 'hidden',
            backgroundColor: brandColor,
          }}
        >
          <Close
            onPress={hidePointOfSale}
            color="white"
            style={{ top: 16, left: 16 }}
          />
          <ScrollView
            contentContainerStyle={{
              flexGrow: 1,
              justifyContent: 'center',
              padding: 20,
              paddingTop: 48,
              gap: 18,
            }}
          >
            <OfferingCard feature={feature} />
          </ScrollView>
        </View>
      </View>
    </DefaultModal>
  );
};

export {
  showPointOfSale,
  PointOfSaleModal,
};
