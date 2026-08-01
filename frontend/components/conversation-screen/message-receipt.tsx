import { Pressable, StyleSheet } from 'react-native';
import { DefaultText } from '../default-text';
import { showPointOfSale } from '../modal/point-of-sale-modal';
import { useAppTheme } from '../../app-theme/app-theme';
import { CrossFadeText } from '../cross-fade';
import { useReadReceipt } from '../../chat/application-layer/hooks/read-receipt';
import {
  Content,
  contentKey,
  contentParts,
  receiptContent,
  useReceiptSide,
} from './message-receipt-logic';

const ReceiptText = ({ content }: { content: Content }) => {
  const { label, detail } = contentParts(content);

  return (
    <>
      {label !== '' &&
        <DefaultText disableTheme={true} style={styles.labelText}>
          {label}
        </DefaultText>
      }
      {detail}
    </>
  );
};

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
  const side = useReceiptSide(deliveredAt, readAt, hasGold, pressToggle);

  const content = receiptContent({ deliveredAt, readAt, hasGold, side });

  return (
    <CrossFadeText triggerKey={contentKey(content)} style={styles.container}>
      {content.kind === 'upsell' ?
        <Pressable
          onPress={() => showPointOfSale(true)}
          hitSlop={{ top: 5, bottom: 10, left: 10, right: 10 }}
          style={styles.upsellTarget}
        >
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
            <ReceiptText content={content} />
          </DefaultText>
        </Pressable>
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
          <ReceiptText content={content} />
        </DefaultText>
      }
    </CrossFadeText>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    marginTop: 5,
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
  labelText: {
    fontWeight: '700',
  },
});

export {
  MessageReceipt,
  ReceiptText,
};
