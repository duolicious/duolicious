import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { DefaultText } from '../default-text';
import { DefaultModal } from './default-modal';
import { backgroundColors } from './background-colors';
import { ButtonWithCenteredText } from '../button/centered-text';
import { listen, notify } from '../../events/events';
import { pluralize } from '../../util/util';

type DateOfBirthConfirmation = {
  age: number
  onConfirm: () => void
} | null;

const showDateOfBirthConfirmation = (data: DateOfBirthConfirmation) => {
  notify<DateOfBirthConfirmation>('show-date-of-birth-confirmation', data);
};

const DateOfBirthConfirmationModal = () => {
  const [visible, setVisible] = useState(false);
  const [data, setData] = useState<DateOfBirthConfirmation>(null);

  useEffect(() => {
    return listen<DateOfBirthConfirmation>(
      'show-date-of-birth-confirmation',
      (x) => {
        if (x) {
          setData(x);
          setVisible(true);
        } else {
          setVisible(false);
        }
      },
    );
  }, []);

  const close = useCallback(() => setVisible(false), []);

  const onConfirm = useCallback(() => {
    setVisible(false);
    data?.onConfirm?.();
  }, [data]);

  const age = data?.age;

  return (
    <DefaultModal
      transparent={true}
      visible={visible}
      onRequestClose={close}
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
            backgroundColor: 'white',
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
            You’re {age} {pluralize('year', age ?? 0)} old
          </DefaultText>
          <DefaultText
            style={{
              fontSize: 15,
              textAlign: 'center',
              color: '#333',
            }}
          >
            Your matches are based on this. It can’t be easily changed after
            signup. Is this right?
          </DefaultText>
          <ButtonWithCenteredText
            onPress={onConfirm}
            backgroundColor="#7700ff"
            textStyle={{ color: 'white', fontWeight: '700' }}
          >
            Yes, I’m {age}
          </ButtonWithCenteredText>
          <ButtonWithCenteredText
            onPress={close}
            secondary={true}
            textStyle={{ fontWeight: '700' }}
          >
            No, let me fix it
          </ButtonWithCenteredText>
        </View>
      </View>
    </DefaultModal>
  );
};

export {
  showDateOfBirthConfirmation,
  DateOfBirthConfirmationModal,
};
