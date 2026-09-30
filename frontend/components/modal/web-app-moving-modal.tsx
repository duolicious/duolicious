import { useCallback, useState } from 'react';
import { Platform } from 'react-native';
import { ChoiceModal } from './choice-modal';
import { goToApex } from '../../kv-storage/session-bridge';

const WebAppMovingModal = () => {
  const [visible, setVisible] = useState(
    Platform.OS === 'web' && window.location.hostname === 'web.duolicious.app'
  );

  const close = useCallback(() => setVisible(false), []);

  return (
    <ChoiceModal
      visible={visible}
      title="Duolicious is moving"
      message="The Duolicious web app is moving from web.duolicious.app to duolicious.app."
      primaryLabel="Go to duolicious.app"
      onPressPrimary={goToApex}
      secondaryLabel="Stay here"
      onPressSecondary={close}
    />
  );
};

export {
  WebAppMovingModal,
};
