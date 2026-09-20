import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faLocationDot } from '@fortawesome/free-solid-svg-icons/faLocationDot';
import { LogoActivityIndicator } from './logo/logo-activity-indicator';
import { DefaultText } from './default-text';
import { DefaultTextInput } from './default-text-input';
import { ButtonWithCenteredText } from './button/centered-text';
import { japi } from '../api/api';
import { LocationValue } from '../data/option-groups';
import * as _ from "lodash";
import { useAppTheme } from '../app-theme/app-theme';

type Props = {
  onChange: (value: LocationValue) => void
  currentValue: LocationValue
  color: string
};

const locate = async (): Promise<LocationValue | null> => {
  try {
    const { granted } = await Location.requestForegroundPermissionsAsync();
    if (!granted) {
      return null;
    }
    const { coords } = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Low,
    });
    const coordinates = { lat: coords.latitude, lon: coords.longitude };
    const { ok, json } = await japi<{ location: string }>(
      'get',
      `/reverse-geocode?lat=${coordinates.lat}&lon=${coordinates.lon}`,
    );
    return ok && json?.location ? { text: json.location, coordinates } : null;
  } catch {
    return null;
  }
};

const LinkText = ({ onPress, color, children }: {
  onPress: () => void
  color: string
  children: string
}) => (
  <Pressable
    onPress={onPress}
    style={{ alignSelf: 'center', padding: 10, zIndex: -1, elevation: -1 }}
  >
    <DefaultText style={{ color, textDecorationLine: 'underline' }}>
      {children}
    </DefaultText>
  </Pressable>
);

const ManualEntry = ({ value, onChange, onPressAutomatic, color }: {
  value: string
  onChange: (value: LocationValue) => void
  onPressAutomatic: () => void
  color: string
}) => {
  const { appTheme } = useAppTheme();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<string[] | null | undefined>(null);
  const [displayResults, setDisplayResults] = useState(false);

  const getSuggestions = useCallback(_.debounce(async (q: string) => {
    let json;
    try {
      const response = await japi<string[]>(
        'get',
        '/search-locations?q=' + encodeURIComponent(q),
      );
      json = response.json;
    } catch {
      setItems(null);
    }

    setItems(json);
    setLoading(false);
  }, 500), []);

  const onChangeText = useCallback((q: string) => {
    onChange({ text: q });
    setLoading(true);
    setDisplayResults(true);
    getSuggestions(q);
  }, [getSuggestions, onChange]);

  return (
    <>
      <DefaultTextInput
        autoFocus={true}
        placeholder="Type a location..."
        value={value}
        onChangeText={onChangeText}
      />
      <View
        style={{
          marginTop: 5,
          marginLeft: 20,
          marginRight: 20,
          paddingTop: 5,
          paddingBottom: 5,
        }}
      >
        {displayResults &&
          <View
            style={{
              position: 'absolute',
              width: '100%',
              top: 0,
              borderRadius: 10,
              backgroundColor: appTheme.primaryColor,
              maxHeight: Dimensions.get('screen').height * 0.25,
              borderWidth: 1,
              borderColor: appTheme.interactiveBorderColor,
              zIndex: 999,
            }}
          >
            <ScrollView showsVerticalScrollIndicator={!loading}>
              {loading &&
                <LogoActivityIndicator
                  size="large"
                  color={appTheme.brandColor}
                  style={{ padding: 5, alignSelf: 'center' }}
                />
              }
              {!loading && items?.map((item) =>
                <Pressable
                  key={item}
                  onPress={() => {
                    setDisplayResults(false);
                    onChange({ text: item });
                  }}
                >
                  <DefaultText style={{padding: 15}}>{item}</DefaultText>
                </Pressable>
              )}
              {!loading && !items?.length &&
                <DefaultText style={{ padding: 15, textAlign: 'center'}} >
                  No results
                </DefaultText>
              }
            </ScrollView>
          </View>
        }
      </View>
      <LinkText onPress={onPressAutomatic} color={color}>
        Use my location instead
      </LinkText>
    </>
  );
};

const LocationSelector = ({ onChange, currentValue, color }: Props) => {
  const { appTheme } = useAppTheme();
  const [value, setValue] = useState(currentValue);
  const [status, setStatus] = useState<
    'idle' | 'locating' | 'failed' | 'manual'
  >('idle');

  const update = useCallback((next: LocationValue) => {
    setValue(next);
    onChange(next);
  }, [onChange]);

  const onPressLocate = useCallback(async () => {
    setStatus('locating');
    const location = await locate();
    setStatus(location === null ? 'failed' : 'idle');
    location !== null && update(location);
  }, [update]);

  const detected = value.coordinates !== undefined;

  if (status === 'manual') {
    return (
      <ManualEntry
        value={value.text}
        onChange={update}
        onPressAutomatic={() => {
          update({ text: '' });
          setStatus('idle');
        }}
        color={color}
      />
    );
  }

  return (
    <>
      {detected &&
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            marginHorizontal: 20,
            marginBottom: 10,
            padding: 15,
            borderRadius: 10,
            backgroundColor: appTheme.primaryColor,
            borderWidth: 1,
            borderColor: appTheme.interactiveBorderColor,
          }}
        >
          <FontAwesomeIcon
            icon={faLocationDot}
            size={18}
            color={appTheme.brandColor}
          />
          <View style={{ flex: 1 }}>
            <DefaultText style={{ fontSize: 16 }}>{value.text}</DefaultText>
            <DefaultText style={{ fontSize: 12, color: appTheme.hintColor }}>
              Detected from your device
            </DefaultText>
          </View>
        </View>
      }
      {status === 'failed' &&
        <DefaultText
          style={{
            color,
            textAlign: 'center',
            marginHorizontal: 28,
            marginBottom: 10,
          }}
        >
          We couldn’t get your location. Allow location access in your device
          settings, or enter it yourself.
        </DefaultText>
      }
      {!detected &&
        <ButtonWithCenteredText
          secondary={true}
          onPress={status === 'locating' ? undefined : onPressLocate}
          icon={status === 'locating'
            ? <ActivityIndicator color={appTheme.brandColor} />
            : <FontAwesomeIcon
                icon={faLocationDot}
                size={16}
                color={appTheme.secondaryColor}
              />
          }
          containerStyle={{ marginHorizontal: 20 }}
        >
          {status === 'failed' ? 'Try again' : status === 'locating' ? 'Finding your location…' : 'Use my location'}
        </ButtonWithCenteredText>
      }
      <LinkText onPress={() => setStatus('manual')} color={color}>
        {detected ? 'Not right? Manually enter my location' : 'Manually enter my location'}
      </LinkText>
    </>
  );
};

export {
  LocationSelector,
};
