import {
  NetworkStateEvent,
  addNetworkStateListener,
  getNetworkStateAsync,
} from 'expo-network';
import { notify } from '../events/events';

const EV_NETWORK_CAME_ONLINE = 'network-came-online';

let wasConnected = true;

const onChangeIsConnected = (isConnected: boolean): void => {
  if (isConnected && !wasConnected) {
    notify(EV_NETWORK_CAME_ONLINE);
  }

  wasConnected = isConnected;
};

addNetworkStateListener(
  (state: NetworkStateEvent) => onChangeIsConnected(state.isConnected === true)
);

getNetworkStateAsync().then(
  (state) => { wasConnected = state?.isConnected === true; }
);

export {
  EV_NETWORK_CAME_ONLINE,
};
