import {
  Platform,
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = [
  'app_theme_name',
  'inbox_apply_search_filters',
  'inbox_order',
  'inbox_section',
  'last_path',
  'navigation_state',
  'draft_messages',
  'person_uuid',
  'seen_inbox_filter_hint',
  'seen_reply_hint',
  'seen_search_filters_hint',
  'session_token',
  'was_review_requested',
] as const;

type Key = typeof KEYS[number];

/*
 * Many users have been complaining that upgrading Duolicious on Android causes
 * it to get stuck on the splash screen. Clearing the app's data fixes the
 * issue.
 *
 * I looked at the errors in Google Play and I'm not sure why this is happening,
 * but I'm guessing it has something to do with issues like these:
 *
 *   * https://github.com/expo/expo/issues/22312
 *   * https://github.com/expo/expo/issues/19018
 *
 * To summarize the issues, the stored data ceases to be readable after
 * upgrading because it can't be decrypted.
 *
 */

const storeKvAsyncStorage = async (
  key: string,
  token?: string | null
): Promise<string | null | void> => {
  if (token === undefined) {
    return await AsyncStorage.getItem(key);
  }

  if (token === null) {
    return await AsyncStorage.removeItem(key);
  }

  return await AsyncStorage.setItem(key, token)
};

const storeKvSecureStore = async (
  key: Key,
  token?: string | null
): Promise<string | null | void> => {
  if (token === undefined) {
    return await SecureStore.getItemAsync(key);
  }

  if (token === null) {
    return await SecureStore.deleteItemAsync(key);
  }

  return await SecureStore.setItemAsync(key, token);
};

const storeKvUnsafe = async (
  key: Key,
  value?: string | null
): Promise<string | null | void> => {
  if (Platform.OS === "web") {
    return await storeKvAsyncStorage(key, value);
  } else if (['person_uuid', 'session_token'].includes(key)) {
    return await storeKvSecureStore(key, value);
  } else {
    return await storeKvAsyncStorage(key, value);
  }
};

const storeKv = async (
  key: Key,
  value?: string | null
): Promise<string | null | void> => {
  try {
    return await storeKvUnsafe(key, value);
  } catch { };

  try {
    return await storeKvUnsafe(key, null);
  } catch { };
}

const clearAllKv = async () => {
  console.warn('Clearing all kv-storage');

  try {
    await AsyncStorage.clear();
  } catch (error) {
    console.error(error);
  }

  try {
    if (Platform.OS !== 'web') {
      await Promise.all(KEYS.map((key) =>
        SecureStore.deleteItemAsync(key)
      ));
    }
  } catch (error) {
    console.error(error);
  }
};

const clearAllKvExceptSessionToken = async () => {
  let sessionToken: string | null | void = null;

  try {
    sessionToken = await storeKv('session_token');
  } catch (error) {
    console.error(error);
  }

  await clearAllKv();

  if (sessionToken) {
    try {
      await storeKv('session_token', sessionToken);
    } catch (error) {
      console.error(error);
    }
  }
};

export {
  storeKv,
  clearAllKv,
  clearAllKvExceptSessionToken,
}
