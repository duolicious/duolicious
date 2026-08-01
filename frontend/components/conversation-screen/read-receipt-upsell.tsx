import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { DefaultText } from '../default-text';
import { showPointOfSale } from '../modal/point-of-sale-modal';
import { useAppTheme } from '../../app-theme/app-theme';
import { useReadReceiptUpsell } from '../../chat/application-layer/hooks/read-receipt';

const ReadReceiptUpsell = ({ personUuid }: { personUuid: string }) => {
  const { appTheme } = useAppTheme();
  const showUpsell = useReadReceiptUpsell(personUuid);

  const upsellGesture = useMemo(
    () => Gesture.Tap().onEnd(() => runOnJS(showPointOfSale)(true)),
    []
  );

  if (!showUpsell) {
    return null;
  }

  return (
    <GestureDetector gesture={upsellGesture}>
      <View style={styles.container}>
        <DefaultText
          disableTheme={true}
          style={{
            ...styles.text,
            ...{
              color: appTheme.brandColor,
              fontSize: appTheme.timestampFontSize,
            }
          }}
        >
          Get read receipts
        </DefaultText>
      </View>
    </GestureDetector>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingRight: 10,
    justifyContent: 'flex-end',
  },
  text: {
    textAlign: 'right',
    fontWeight: '700',
    cursor: 'pointer',
  },
});

export {
  ReadReceiptUpsell,
};
