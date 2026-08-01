import { StyleSheet } from 'react-native';
import { DefaultText } from '../default-text';
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

  return (
    <CrossFadeText triggerKey={contentKey(content)} style={styles.container}>
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
});

export {
  MessageReceipt,
};
