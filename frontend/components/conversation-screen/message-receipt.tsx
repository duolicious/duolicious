import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { DefaultText } from '../default-text';
import { showPointOfSale } from '../modal/point-of-sale-modal';
import { useAppTheme } from '../../app-theme/app-theme';
import { CrossFadeText } from '../cross-fade';
import { useReadReceipt } from '../../chat/application-layer/hooks/read-receipt';
import {
  contentKey,
  contentText,
  receiptContent,
  useReceiptSide,
} from './message-receipt-logic';

const MessageReceipt = ({
  personUuid,
  deliveredAt,
  hasGold,
  pressToggle,
}: {
  personUuid: string
  deliveredAt: Date | null
  hasGold: boolean
  pressToggle: boolean
}) => {
  const { appTheme } = useAppTheme();
  const readAt = useReadReceipt(personUuid, deliveredAt);
  const side = useReceiptSide(deliveredAt, readAt, pressToggle);

  const content = receiptContent({ deliveredAt, readAt, hasGold, side });

  const upsellGesture = useMemo(
    () => Gesture.Tap().onEnd(() => runOnJS(showPointOfSale)(true)),
    []
  );

  return (
    <CrossFadeText triggerKey={contentKey(content)} style={styles.container}>
      {content.kind === 'upsell' ?
        <GestureDetector gesture={upsellGesture}>
          <View style={styles.upsellTarget}>
            <DefaultText
              disableTheme={true}
              style={{
                ...styles.upsellText,
                ...{
                  color: appTheme.brandColor,
                  fontSize: appTheme.timestampFontSize,
                }
              }}
            >
              {contentText(content)}
            </DefaultText>
          </View>
        </GestureDetector>
      :
        <DefaultText
          disableTheme={true}
          style={{
            ...styles.text,
            ...{
              color: appTheme.hintColor,
              fontSize: appTheme.timestampFontSize,
            }
          }}
        >
          {contentText(content)}
        </DefaultText>
      }
    </CrossFadeText>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    marginTop: 3,
  },
  text: {
    textAlign: 'right',
  },
  upsellTarget: {
    alignSelf: 'flex-end',
  },
  upsellText: {
    textAlign: 'right',
    fontWeight: '700',
    cursor: 'pointer',
  },
});

export {
  MessageReceipt,
};
