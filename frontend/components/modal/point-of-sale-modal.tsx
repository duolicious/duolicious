import { useCallback, useEffect, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { DefaultText } from '../default-text';
import { DefaultModal } from './default-modal';
import { backgroundColors } from './background-colors';
import { ButtonWithCenteredText } from '../button/centered-text';
import { Logo14 } from '../logo';
import { LogoActivityIndicator } from '../logo/logo-activity-indicator';
import { Close } from '../button/close';
import { listen, notify } from '../../events/events';
import { setSignedInUser } from '../../events/signed-in-user';
import { getPurchasable } from '../../purchases/purchases';
import { Purchasable } from '../../purchases/offering';
import { isMobileWeb, pluralize } from '../../util/util';
import * as _ from 'lodash';

const cardPadding = 20;

const showPointOfSale = (isVisible: boolean) => {
  notify<boolean>('show-point-of-sale', isVisible);
};

const useShowPointOfSale = () => {
  const [isVisible, setIsVisible] = useState<boolean>(false);

  useEffect(() => {
    return listen<boolean>(
      'show-point-of-sale',
      (x) => {
        if (x === undefined) {
          return;
        }

        setIsVisible(x);
      }
    );
  }, []);

  return isVisible;
};

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
      secondary={true}
      loading={loading}
    >
      {label}
    </ButtonWithCenteredText>
  );
};

const OfferingCard = ({
  onPressClose,
}: {
  onPressClose: () => void,
}) => {
  const [hasError, setHasError] = useState(false);
  const [purchasable, setPurchasable] = useState<Purchasable | null>();
  const { height: windowHeight } = useWindowDimensions();

  useEffect(() => {
    getPurchasable().then(setPurchasable, () => setPurchasable(null));
  }, []);

  if (!purchasable) {
    return (
      <>
        {purchasable === null
          ? <DefaultText style={{ textAlign: 'center', fontWeight: 500 }}>
              Something went wrong
            </DefaultText>
          : <View
              style={{
                width: 100,
                aspectRatio: 1,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <LogoActivityIndicator size="large" color="#70f"/>
            </View>
        }
        <Close onPress={onPressClose} />
      </>
    );
  }

  const { offering, purchase } = purchasable;

  const productName = offering.product_name;

  const subtitle = `You’re gonna need ${productName} for that...`;

  const buttonCta = offering.trial
    ? `Try ${offering.trial.units} ${_.capitalize(pluralize(offering.trial.unit, offering.trial.units))} Free`
    : `Get ${productName.toUpperCase()}`;

  const onPress = async () => {
    setHasError(false);

    const result = await purchase();

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

    onPressClose();
  };

  const isCompact = isMobileWeb() && windowHeight < 620;

  return (
    <>
      <View
        style={{
          gap: 10,
        }}
      >
        <View>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 3,
            }}
          >
            <Logo14 size={14 * 2} color="black" rectSize={0.3} />
            <DefaultText
              style={{
                fontFamily: 'TruenoBold',
                fontSize: 16,
              }}
            >
              Duolicious
            </DefaultText>
          </View>
          {!isCompact &&
            <DefaultText
              style={{
                fontSize: 42,
                fontWeight: 900,
                textAlign: 'center',
              }}
            >
              {productName.toUpperCase()}
            </DefaultText>
          }
        </View>
        <DefaultText
          style={{
            textAlign: 'center',
          }}
        >
          {subtitle}
        </DefaultText>
      </View>
      <View
        style={{
          backgroundColor: '#70f',
          borderRadius: 10,
          overflow: 'hidden',
          borderWidth: 3,
        }}
      >
        <View
          style={{
            margin: cardPadding,
            gap: 8,
          }}
        >
          <View
            style={{
              position: 'absolute',
              top: -cardPadding,
              right: 0,
            }}
          >
            <Logo14
              size={80}
              color="#ffd700"
            />
          </View>
          <DefaultText
            style={{
              fontWeight: 900,
              fontSize: 28,
              color: '#ffd700',
            }}
          >
            {productName.toUpperCase()}
          </DefaultText>

          <DefaultText
            style={{
              color: 'white',
            }}
          >
            <DefaultText
              disableTheme
              style={{
                fontWeight: 700,
              }}
            >
              {offering.price} {offering.currency}
            </DefaultText>
            {} / {offering.cycle.units === 1
              ? offering.cycle.unit
              : `${offering.cycle.units} ${pluralize(offering.cycle.unit, offering.cycle.units)}`}
          </DefaultText>

          {offering.trial &&
            <DefaultText
              style={{
                color: '#70f',
                fontWeight: 700,
                fontSize: 12,
                paddingHorizontal: 7,
                paddingVertical: 3,
                backgroundColor: 'white',
                borderRadius: 999,
                alignSelf: 'flex-start',
              }}
            >
              FREE TRIAL
            </DefaultText>
          }

          <DefaultText
            style={{
              color: 'white',
              paddingVertical: 14,
            }}
          >
            {offering.description}
          </DefaultText>

          <PurchaseButton
            label={buttonCta}
            onPress={onPress}
          />
          {hasError &&
            <DefaultText
              style={{
                color: 'red',
                textAlign: 'center',
                fontWeight: 700,
              }}
            >
              Something went wrong
            </DefaultText>
          }
        </View>

        {!isCompact &&
          <DefaultText
            style={{
              fontSize: 12,
              color: 'white',
              backgroundColor: 'black',
              paddingHorizontal: cardPadding,
              paddingVertical: cardPadding / 2,
            }}
          >
            Subscription renews automatically. Cancel anytime.
          </DefaultText>
        }
      </View>
      <Close onPress={onPressClose} />
    </>
  );
};

const PointOfSaleModal = () => {
  const isVisible = useShowPointOfSale();

  const onPressClose = useCallback(() => showPointOfSale(false), []);

  return (
    <DefaultModal
      transparent={true}
      visible={isVisible}
      onRequestClose={onPressClose}
    >
      <View
        style={{
          width: '100%',
          height: '100%',
          justifyContent: 'center',
          alignItems: 'center',
          flexDirection: 'row',
          padding: 10,
          ...backgroundColors.dark,
        }}
      >
        <View
          style={{
            maxWidth: '100%',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View
            style={{
              maxWidth: 600,
              padding: 20,
              gap: 20,
              backgroundColor: 'white',
              borderRadius: 5,
              flexDirection: 'column',
              overflow: 'hidden',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <OfferingCard
              onPressClose={onPressClose}
            />
          </View>
        </View>
      </View>
    </DefaultModal>
  );
};

export {
  showPointOfSale,
  PointOfSaleModal,
};
