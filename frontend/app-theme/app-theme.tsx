import { StatusBar } from 'react-native';
import { useEffect, useState } from 'react';
import { listen, notify, lastEvent } from '../events/events';
import { appThemeName as kvAppThemeName } from '../kv-storage/app-theme';
import { useSignedInUser } from '../events/signed-in-user';
import { assertNever } from '../util/util';

type AppThemeName = 'light' | 'dark';

// A translucent panel layered over content (basics, stats, the "looking for"
// card, the profile audio player, ...). See ./surface for how it's resolved.
type Surface = {
  backgroundColor: string
  borderColor: string
};

type AppTheme = {
  primaryColor: string
  secondaryColor: string
  hintColor: string
  inputColor: string
  card: {
    borderTopColor: string
    borderLeftColor: string
    borderRightColor: string
    borderBottomColor: string
  },
  surface: Surface
  interactiveBorderColor: string
  hoverColor: string
  hoverOverlayColor: string
  brandHoverColor: string
  purpleHoverTint: string
  quizCardColor: string
  quizCardBackgroundColor: string
  speechBubbleOtherUserBackgroundColor: string
  speechBubbleOtherUserColor: string
  reactionBarBackgroundColor: string
  reactionBarBorderColor: string
  reactionSelectedBackgroundColor: string
  brandColor: string
  avatarBackgroundColor: string
  avatarColor: string
  timestampFontSize: number
};

type AppThemes = Record<AppThemeName, AppTheme>;

const APP_THEME: AppThemes = {
  light: {
    primaryColor: '#ffffff',
    secondaryColor: '#000000',
    hintColor: '#999999',
    inputColor: '#eeeeee',
    card: {
      borderTopColor: '#eeeeee',
      borderLeftColor: '#dddddd',
      borderRightColor: '#dddddd',
      borderBottomColor: '#dddddd',
    },
    surface: {
      backgroundColor: 'rgba(255, 255, 255, 0.5)',
      borderColor: 'rgba(0, 0, 0, 0.12)',
    },
    interactiveBorderColor: '#dddddd',
    hoverColor: '#f6f6f6',
    hoverOverlayColor: 'rgba(0, 0, 0, 0.06)',
    brandHoverColor: '#6400d6',
    purpleHoverTint: 'rgba(119, 0, 255, 0.15)',
    quizCardBackgroundColor: '#ffffff',
    quizCardColor: '#7700ff',
    speechBubbleOtherUserBackgroundColor: '#eeeeee',
    speechBubbleOtherUserColor: '#000000',
    reactionBarBackgroundColor: '#ffffff',
    reactionBarBorderColor: '#cccccc',
    reactionSelectedBackgroundColor: '#ebd9ff',
    brandColor: '#7700ff',
    avatarBackgroundColor: '#f1e5ff',
    avatarColor: 'rgba(119, 0, 255, 0.2)',
    timestampFontSize: 13,
  },
  dark: {
    primaryColor: '#1a1a1e',
    secondaryColor: '#ffffff',
    hintColor: '#999999',
    inputColor: '#222327',
    card: {
      borderTopColor: '#000000',
      borderLeftColor: '#000000',
      borderRightColor: '#000000',
      borderBottomColor: '#000000',
    },
    surface: {
      backgroundColor: 'rgba(255, 255, 255, 0.07)',
      borderColor: 'rgba(255, 255, 255, 0.16)',
    },
    interactiveBorderColor: '#000000',
    hoverColor: '#25252a',
    hoverOverlayColor: 'rgba(255, 255, 255, 0.1)',
    brandHoverColor: '#e6e6e6',
    purpleHoverTint: 'rgba(119, 0, 255, 0.3)',
    quizCardBackgroundColor: '#2c2c33',
    quizCardColor: '#000000',
    speechBubbleOtherUserBackgroundColor: '#2a2b35',
    speechBubbleOtherUserColor: '#ffffff',
    reactionBarBackgroundColor: '#3a3b45',
    reactionBarBorderColor: '#54555f',
    reactionSelectedBackgroundColor: '#5d5e66',
    brandColor: '#ffffff',
    avatarBackgroundColor: '#2a2b35',
    avatarColor: '#ffffff',
    timestampFontSize: 13,
  }
};

const EVENT_KEY = 'updated-theme';

const setAppBarStyle = (appThemeName: AppThemeName) => {
  if (appThemeName === 'dark') {
    StatusBar.setBarStyle('light-content');
  } else if (appThemeName === 'light') {
    StatusBar.setBarStyle('dark-content');
  } else {
    assertNever(appThemeName);
  }

  StatusBar.setTranslucent(true);

  StatusBar.setBackgroundColor('transparent');
};

// React hook for components to subscribe to changes
const useAppTheme = (): { appThemeName: AppThemeName, appTheme: AppTheme } => {
  const initialAppThemeName = lastEvent<AppThemeName>(EVENT_KEY) ?? 'light';

  const [appThemeName, setAppThemeName] = useState<AppThemeName>(
    initialAppThemeName
  );

  useEffect(() => {
    return listen<AppThemeName>(
      EVENT_KEY,
      (v) => {
        if (v) {
          setAppThemeName(v);
        }
      }
    );
  }, []);

  return { appThemeName, appTheme: APP_THEME[appThemeName] };
};

const setAppThemeName = (appThemeName: AppThemeName) => {
  kvAppThemeName(appThemeName);

  notify<AppThemeName>(EVENT_KEY, appThemeName);

  setAppBarStyle(appThemeName);
};

const loadAppTheme = async (hasGold: boolean) => {
  const appThemeName = hasGold ? await kvAppThemeName() : 'light';

  notify<AppThemeName>(EVENT_KEY, appThemeName);

  setAppBarStyle(appThemeName);
};

const useAppThemeLoader = () => {
  const [signedInUser] = useSignedInUser();

  useEffect(() => {
    loadAppTheme(signedInUser?.hasGold ?? false);
  }, [signedInUser?.hasGold]);

};


export {
  AppTheme,
  AppThemeName,
  AppThemes,
  Surface,
  useAppThemeLoader,
  setAppThemeName,
  useAppTheme,
};
