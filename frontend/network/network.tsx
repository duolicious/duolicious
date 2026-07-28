import {
  NetworkStateEvent,
  addNetworkStateListener,
  getNetworkStateAsync,
} from 'expo-network';
import { notify } from '../events/events';

const EV_NETWORK_CAME_ONLINE = 'network-came-online';
const EV_NETWORK_IS_ONLINE = 'network-is-online';

let wasConnected = true;

const onChangeIsConnected = (isConnected: boolean): void => {
  const cameOnline = isConnected && !wasConnected;

  wasConnected = isConnected;

  notify<boolean>(EV_NETWORK_IS_ONLINE, isConnected);

  if (cameOnline) {
    notify(EV_NETWORK_CAME_ONLINE);
  }
};

addNetworkStateListener(
  (state: NetworkStateEvent) => onChangeIsConnected(state.isConnected === true)
);

getNetworkStateAsync().then(
  (state) => {
    if (state) {
      onChangeIsConnected(state.isConnected === true);
    }
  }
);

export {
  EV_NETWORK_CAME_ONLINE,
  EV_NETWORK_IS_ONLINE,
};
