import {
  useEffect,
  useState,
  useRef,
} from 'react';
import { japi } from '../api/api';
import { listen, notify, lastEvent } from '../events/events';
import { setConversationArchived } from '../chat/application-layer';
import * as _ from 'lodash';

type SkippedNetworkState
  = 'fetching'
  | 'posting'
  | 'settled'

type SkippedState = {
  isSkipped: boolean
  wasPostSkipFiredInThisSession: boolean
  networkState: SkippedNetworkState
};

const INITIAL_STATE: SkippedState = {
  isSkipped: false,
  wasPostSkipFiredInThisSession: false,
  networkState: 'settled',
};

const eventKey = (personUuid: string) =>
  `skipped-state-${personUuid}`;

const lastState = (personUuid: string | null | undefined) => {
  const _lastEvent = personUuid
    ? lastEvent<SkippedState>(eventKey(personUuid))
    : INITIAL_STATE;

  return {
    ...INITIAL_STATE,
    ..._lastEvent,
    personUuid,
  };
};

const useSkipped = (
  personUuid: string | null | undefined,
  onPostSkip?: () => void
) => {
  const personUuidRef = useRef<string | null | undefined>(personUuid);
  const [state, setState] = useState<SkippedState>(lastState(personUuid));

  if (personUuidRef.current !== personUuid) {
    personUuidRef.current = personUuid;
    setState((oldState) => {
      const newState = lastState(personUuid)

      if (_.isEqual(oldState, newState)) {
        return oldState;
      } else {
        return newState;
      }
    });
  }

  useEffect(() => {
    if (!personUuid) {
      return;
    }

    const onEvent = (newState: SkippedState | undefined) => {
      if (newState === undefined) {
        return;
      }

      setState((oldState) => {
        // Fire `onPostSkip` when a posted skip lands
        if (
          oldState.networkState === 'posting' &&
          oldState.isSkipped !== newState.isSkipped &&
          newState.isSkipped
        ) {
          onPostSkip?.();
        }

        if (_.isEqual(oldState, newState)) {
          return oldState;
        } else {
          return newState;
        }
      });
    };

    return listen<SkippedState>(eventKey(personUuid), onEvent);
  }, [personUuid, onPostSkip]);

  return {
    isSkipped: state.isSkipped,
    wasPostSkipFiredInThisSession: state.wasPostSkipFiredInThisSession,
    isLoading: state.networkState !== 'settled',
    isFetching: state.networkState === 'fetching',
    isPosting: state.networkState === 'posting',
  };
};

const setSkipped = (
  personUuid: string,
  state: Partial<SkippedState>
) => {
  const key = eventKey(personUuid);

  const _lastEvent = lastEvent<SkippedState>(key);

  notify<SkippedState>(
    key,
    {
      ...INITIAL_STATE,
      ..._lastEvent,
      ...state,
      wasPostSkipFiredInThisSession: (
        _lastEvent?.wasPostSkipFiredInThisSession ||
        state?.isSkipped ||
        false
      ),
    }
  );
};

const postSkipped = async (
  personUuid: string,
  isSkipped: boolean,
  reportReason?: string,
): Promise<boolean> => {
  const endpoint = (
    isSkipped ?
    `/skip/by-uuid/${personUuid}` :
    `/unskip/by-uuid/${personUuid}`);

  const payload =
    (isSkipped && reportReason) ?
    { report_reason: reportReason } :
    undefined;

  setSkipped(personUuid, { networkState: 'posting' });

  const response = await japi('post', endpoint, payload);

  if (!response.ok) {
    setSkipped(personUuid, { networkState: 'settled' });
    return false;
  }

  setSkipped(
    personUuid,
    {
      isSkipped,
      networkState: 'settled',
    }
  );

  setConversationArchived(personUuid, isSkipped);

  return true;
};

export {
  postSkipped,
  useSkipped,
  setSkipped,
};
