import {
  Platform,
  Text,
  View,
} from 'react-native';
import {
  useMemo,
} from 'react';
import { DefaultText } from './default-text';
import {
  randomGagMaintenanceNotice,
  randomGagUpdateNotice,
} from '../data/gag-utility-notices';
import { assertNever } from '../util/util'

type ServerStatus = "ok" | "down for maintenance" | "please update";

const UtilityScreen = ({
  serverStatus,
}: {
  serverStatus: ServerStatus
}) => {
  const getBody = () => {
    if (serverStatus === "ok") {
      return "";
    } else if (serverStatus === "down for maintenance") {
      return randomGagMaintenanceNotice();
    } else if (serverStatus === "please update") {
      return randomGagUpdateNotice();
    } else {
      return assertNever(serverStatus);
    }
  };

  const getTitle = () => {
    if (serverStatus === "ok") {
      return "";
    } else if (serverStatus === "down for maintenance") {
      return "Down For Maintenance";
    } else if (serverStatus === "please update") {
      if (Platform.OS === 'web') {
        return "Please Refresh This Page 😇"
      } else {
        return "Please Update Your App 😇"
      }
    } else {
      return assertNever(serverStatus);
    }
  };

  const title_ = useMemo(() => getTitle(), [serverStatus]);
  const body_ = useMemo(() => getBody(), [serverStatus]);

  if (serverStatus === 'ok') {
    return <></>;
  }

  return (
    <View
      style={{
        backgroundColor: '#70f',
        width: '100%',
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View
        style={{
          width: '100%',
          maxWidth: 600,
          alignItems: 'center',
          justifyContent: 'center',
          padding: 10,
        }}
      >
        <Text
          style={{
            color: 'white',
            alignSelf: 'center',
            fontFamily: 'TruenoBold',
            fontSize: 24,
            textAlign: 'center',
          }}
          selectable={false}
        >
          Duolicious
        </Text>
        <DefaultText
          style={{
            fontSize: 48,
            color: 'white',
            marginTop: 40,
            marginBottom: 40,
            textAlign: 'center',
          }}
        >
          {title_}
        </DefaultText>
        <DefaultText
          style={{
            color: 'white',
            textAlign: 'center',
          }}
        >
          {body_}
        </DefaultText>
      </View>
    </View>
  );
};

export {
  ServerStatus,
  UtilityScreen,
};
