import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { DefaultText } from '../default-text';
import { showPointOfSale } from '../modal/point-of-sale-modal';
import { useAppTheme } from '../../app-theme/app-theme';
import { CrossFadeText } from '../cross-fade';
import {
  contentKey,
  contentText,
  receiptContent,
  useIsDelayElapsed,
} from './message-receipt-logic';

const MessageReceipt = ({
  deliveredAt,
  readAt,
  hasGold,
  isPressed,
}: {
  deliveredAt: Date | null
  readAt: Date | null
  hasGold: boolean
  isPressed: boolean
}) => {
  const { appTheme } = useAppTheme();
  const isDelayElapsed = useIsDelayElapsed(deliveredAt, isPressed);

  const content = receiptContent({
    deliveredAt,
    readAt,
    hasGold,
    isDelayElapsed,
    isPressed,
  });

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
