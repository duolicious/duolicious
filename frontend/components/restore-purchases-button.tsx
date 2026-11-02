import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faClockRotateLeft } from '@fortawesome/free-solid-svg-icons/faClockRotateLeft';
import { ButtonForOption } from './button/option';
import { notifyGoldToast } from './gold-toast';
import { setSignedInUser } from '../events/signed-in-user';
import { RestoreResult } from '../purchases/offering';

const RestorePurchasesButton = ({ restorePurchases }: {
  restorePurchases: () => Promise<RestoreResult>
}) => {
  const [status, setStatus] = useState<RestoreResult | 'idle' | 'loading'>('idle');

  const restore = async () => {
    setStatus('loading');

    const result = await restorePurchases();
    setStatus(result);

    if (result === 'restored') {
      setSignedInUser((u) => u && { ...u, hasGold: true });
      notifyGoldToast('Your Gold subscription is now on this account');
    }
  };

  return (
    <ButtonForOption
      onPress={restore}
      label="Restore Purchases"
      setting={
        status === 'none' ? 'Nothing to restore' :
        status === 'failed' ? 'Try again later' : ''
      }
      loading={status === 'loading'}
      showChevron={false}
      icon={
        ({ color = 'black' }) => (
          <FontAwesomeIcon
            icon={faClockRotateLeft}
            size={14}
            style={{ color }}
          />
        )
      }
    />
  );
};

export {
  RestorePurchasesButton,
};
