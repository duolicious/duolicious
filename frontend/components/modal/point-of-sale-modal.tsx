import { useCallback, useEffect, useState } from 'react';
import { Platform, View, useWindowDimensions } from 'react-native';
import { DefaultText } from '../default-text';
import { DefaultModal } from './default-modal';
import { backgroundColors } from './background-colors';
import { ButtonWithCenteredText } from '../button/centered-text';
import { Logo14 } from '../logo';
import { LogoActivityIndicator } from '../logo/logo-activity-indicator';
import { Close } from '../button/close';
import Purchases, { PurchasesOffering } from 'react-native-purchases';
import * as _ from 'lodash';
import { AppStoreBadges } from '../badges/app-store/app-store';
import { listen, notify } from '../../events/events';
import { setSignedInUser } from '../../events/signed-in-user';
import { getCurrentOfferingCached } from '../../purchases/purchases';
import { pluralize, isMobileWeb } from '../../util/util';

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
  onPress: () => void,
}) => {
  const [loading, setLoading] = useState(false);

  const _onPress = useCallback(async () => {
    setLoading(true);
    await onPress();
    setLoading(false);
  }, []);

  if (Platform.OS === 'ios' || Platform.OS === 'android') {
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
  } else {
    return (
      <View
        style={{
          width: '100%',
          alignItems: 'center',
        }}
      >
        <DefaultText
          style={{
            color: 'white',
            textAlign: 'center',
            fontWeight: 500,
            maxWidth: 300,
          }}
        >
          Purchase via the mobile app to get these features on web
        </DefaultText>
        <View
          style={{
            maxWidth: isMobileWeb() ? 176 : 250,
          }}
        >
          <AppStoreBadges/>
        </View>
      </View>
    );
  }
};

const Offering = ({
  onPressClose,
}: {
  onPressClose: () => void,
}) => {
  const [hasError, setHasError] = useState(false);
  const [currentOffering, setCurrentOffering] = useState<PurchasesOffering | null>();
  const { height: windowHeight } = useWindowDimensions();

  useEffect(() => {
    (async () => {
      const offering = await getCurrentOfferingCached();
      setCurrentOffering(offering);
    })();
  }, []);

  const currentPackage = currentOffering?.availablePackages.at(0);

  if (!currentOffering || !currentPackage) {
    return (
      <>
        <View
          style={{
            width: 100,
            aspectRatio: 1,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <LogoActivityIndicator size="large" color="#70f"/>
        </View>
        <Close onPress={onPressClose} />
      </>
    );
  }

  const productName = currentOffering.serverDescription;

  const buttonCta = (() => {
    if (!currentPackage.product.introPrice) {
      return `Get ${productName.toUpperCase()}`;
    }

    const numUnits = currentPackage.product.introPrice.periodNumberOfUnits;

    const formattedUnits = _.capitalize(
      pluralize(
        currentPackage.product.introPrice.periodUnit,
        currentPackage.product.introPrice.periodNumberOfUnits
      )
    );

    return `Try ${numUnits} ${formattedUnits} Free`
  })();

  const subtitle = `You’re gonna need ${productName} for that...`;

  const onPress = async () => {
    setHasError(false);

    try {
      const { customerInfo } = await Purchases.purchasePackage(currentPackage);
      if (!customerInfo.allPurchasedProductIdentifiers.includes(currentPackage.product.identifier)) {
        throw new Error('Purchase failed');
      }
    } catch (e) {
      if (!e?.userCancelled) {
        setHasError(true);
        console.error(e);
      }
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
              {currentPackage.product.priceString} {currentPackage.product.currencyCode}
            </DefaultText>
            {} / {currentPackage.packageType.toLowerCase().replace(/ly$/, '')}
          </DefaultText>

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

          <DefaultText
            style={{
              color: 'white',
              paddingVertical: 14,
            }}
          >
            {String(currentOffering.metadata.description)}
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
            <Offering
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
