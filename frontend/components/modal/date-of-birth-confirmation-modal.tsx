import { useCallback, useEffect, useState } from 'react';
import { ChoiceModal } from './choice-modal';
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
    <ChoiceModal
      visible={visible}
      title={`You’re ${age} ${pluralize('year', age ?? 0)} old`}
      message="Your matches are based on this. It can’t be easily changed after signup. Is this right?"
      primaryLabel={`Yes, I’m ${age}`}
      onPressPrimary={onConfirm}
      secondaryLabel="No, let me fix it"
      onPressSecondary={close}
    />
  );
};

export {
  showDateOfBirthConfirmation,
  DateOfBirthConfirmationModal,
};
