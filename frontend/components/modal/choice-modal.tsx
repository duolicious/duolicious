import { View } from 'react-native';
import { DefaultText } from '../default-text';
import { DefaultModal } from './default-modal';
import { backgroundColors } from './background-colors';
import { ButtonWithCenteredText } from '../button/centered-text';
import { useAppTheme } from '../../app-theme/app-theme';

const ChoiceModal = ({
  visible,
  title,
  message,
  primaryLabel,
  onPressPrimary,
  secondaryLabel,
  onPressSecondary,
}: {
  visible: boolean
  title: string
  message: string
  primaryLabel: string
  onPressPrimary: () => void
  secondaryLabel: string
  onPressSecondary: () => void
}) => {
  const { appTheme } = useAppTheme();

  return (
    <DefaultModal
      transparent={true}
      visible={visible}
      onRequestClose={onPressSecondary}
    >
      <View
        style={{
          width: '100%',
          height: '100%',
          justifyContent: 'center',
          alignItems: 'center',
          padding: 20,
          ...backgroundColors.dark,
        }}
      >
        <View
          style={{
            width: '100%',
            maxWidth: 400,
            backgroundColor: appTheme.primaryColor,
            borderRadius: 10,
            padding: 20,
            gap: 15,
          }}
        >
          <DefaultText
            style={{
              fontSize: 22,
              fontWeight: 900,
              textAlign: 'center',
            }}
          >
            {title}
          </DefaultText>
          <DefaultText
            style={{
              fontSize: 15,
              textAlign: 'center',
            }}
          >
            {message}
          </DefaultText>
          <ButtonWithCenteredText
            onPress={onPressPrimary}
            backgroundColor={appTheme.brandColor}
            textStyle={{ color: appTheme.primaryColor, fontWeight: '700' }}
          >
            {primaryLabel}
          </ButtonWithCenteredText>
          <ButtonWithCenteredText
            onPress={onPressSecondary}
            secondary={true}
            textStyle={{ fontWeight: '700' }}
          >
            {secondaryLabel}
          </ButtonWithCenteredText>
        </View>
      </View>
    </DefaultModal>
  );
};

export {
  ChoiceModal,
};
