import {
  ActivityIndicator,
  AppState,
  AppStateStatus,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Dispatch,
  Fragment,
  SetStateAction,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { TopNavBar } from '../top-nav-bar';
import { LogoActivityIndicator } from '../logo/logo-activity-indicator';
import { ChatMessage, TypingIndicator } from './chat-message';
import { DefaultText } from '../default-text';
import {
  Message,
  markDisplayed,
} from '../../chat/application-layer';
import {
  fetchConversationAndNotify,
  getMessage,
  onReceiveMessageAndNotify,
  sendMessageAndNotify,
} from '../../chat/application-layer/hooks/message'
import {
  IMAGES_URL,
} from '../../env/env';
import { api } from '../../api/api';
import { TopNavBarButton } from '../top-nav-bar-button';
import { RotateCcw, Flag, X } from "react-native-feather";
import { postSkipped } from '../../hide-and-block/hide-and-block';
import { delay, possessive } from '../../util/util';
import { ReportModalInitialData } from '../modal/report-modal';
import { listen, notify } from '../../events/events';
import { ImageBackground } from 'expo-image';
import { maybeRequestReview } from '../../store-review/store-review';
import { MessageDivider }  from './message-divider';
import * as _ from 'lodash';
import { Input } from './input';
import {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from '@react-navigation/native-stack';
import type { RootParamList } from '../../navigation/linking';
import { useDraftMessage } from '../../chat/application-layer/hooks/draft-message';
import { QuoteCard } from './quote';
import { GifPickedEvent } from '../../components/modal/gif-picker-modal';
import { useSkipped } from '../../hide-and-block/hide-and-block';
import { OnlineIndicator } from '../online-indicator';
import { useAppTheme } from '../../app-theme/app-theme';
import { getProspectHint, setProspectHint } from '../../navigation/prospect-cache';
import { dismissConversationNotificationsOnMobile } from '../../notifications/mobile';

type ConversationProspectResponse = {
  name?: string,
  photo_uuid?: string | null,
  photo_blurhash?: string | null,
  is_available?: boolean,
  is_skipped?: boolean,
  url_slug?: string | null,
};

const firstMamId = (messageIds: string[] | null): string => {
  if (!messageIds) {
    return ''
  }

  if (!messageIds.length) {
    return ''
  }

  const firstMessageId = messageIds[0];

  const message = getMessage(firstMessageId);

  if (!message) {
    return '';
  }

  if (message.message.type === 'chat-text') {
    return message.message.mamId ?? '';
  } else if (message.message.type === 'chat-audio') {
    return message.message.mamId ?? '';
  }

  return '';
};

const Menu = ({
  navigation,
  name,
  personUuid,
  isSkipped,
  setIsSkipped,
  closeFn,
}: {
  navigation: NativeStackNavigationProp<RootParamList>,
  name: string | undefined,
  personUuid: string,
  isSkipped: boolean | undefined,
  setIsSkipped: Dispatch<SetStateAction<boolean | undefined>>,
  closeFn: () => void,
}) => {
  const [isUpdating, setIsUpdating] = useState(false);
  const { appTheme } = useAppTheme();

  const isLoading = (
    isSkipped === undefined ||
    name === undefined);

  const onPressSkip = useCallback(async () => {
    if (isSkipped === undefined) {
      return;
    }

    setIsUpdating(true);
    const nextHiddenState = !isSkipped;
    if (await postSkipped(personUuid, nextHiddenState)) {
      setIsSkipped(nextHiddenState);
      setIsUpdating(false);
      closeFn();
      if (nextHiddenState) {
        navigation.popToTop();
      }
    }
  }, [navigation, isSkipped, setIsSkipped, closeFn, personUuid]);

  const onPressReport = useCallback(async () => {
    if (name === undefined) {
      return;
    }

    closeFn();

    const data: ReportModalInitialData = {
      name,
      personUuid,
      context: 'Conversation Screen'
    };

    notify('open-report-modal', data);
  }, [name, personUuid, closeFn]);

  const pressableStyle: ViewStyle = {
    flexDirection: 'row',
    gap: 10,
  };

  const iconContainerStyle: ViewStyle = {
    flexGrow: 1,
  };

  const iconStyle = {
    backgroundColor: isLoading ? '#ddd' : 'transparent',
    borderRadius: 3,
  };

  const labelContainerStyle: ViewStyle = {
    gap: 5,
    flexShrink: 1,
  };

  const labelStyle: TextStyle = {
    fontSize: 16,
    fontWeight: '600',
    color: isLoading ? '#ddd' : '#777',
    backgroundColor: isLoading ? '#ddd' : undefined,
    borderRadius: 3,
  };

  const subLabelStyle: TextStyle = {
    color: isLoading ? '#ddd' : '#aaa',
    backgroundColor: isLoading ? '#ddd' : undefined,
    borderRadius: 3,
  };

  const iconStroke = isLoading ? "transparent" : appTheme.secondaryColor;

  const borderRadius = 10;

  return (
    <View
      style={{
        position: 'absolute',
        top: 45,
        right: 5,
        padding: 25,
        gap: 40,
        flexDirection: 'column',
        backgroundColor: appTheme.primaryColor,
        borderRadius: borderRadius,
        borderWidth: 1,
        borderColor: '#999',
        zIndex: 999,
        overflow: 'visible',
        maxWidth: 350,
      }}
    >
      <Pressable style={pressableStyle} onPress={isLoading ? undefined : onPressSkip}>
        {isSkipped &&
          <View style={iconContainerStyle}>
            <RotateCcw
              style={iconStyle}
              stroke={iconStroke}
              strokeWidth={4}
              height={18}
              width={18}
            />
          </View>
        }
        {!isSkipped &&
          <View style={iconContainerStyle}>
            <X
              style={iconStyle}
              stroke={iconStroke}
              strokeWidth={4}
              height={18}
              width={18}
            />
          </View>
        }
        <View style={labelContainerStyle}>
          <DefaultText style={labelStyle}>
            {isSkipped ? 'Undo skip' : 'Skip'}
          </DefaultText>
          <DefaultText style={subLabelStyle}>
            {isSkipped ?
              'Moves the conversation out of your archive' :
              'Ends the conversation and moves it to your archive'
            }
          </DefaultText>
        </View>
      </Pressable>
      {!isSkipped &&
        <Pressable style={pressableStyle} onPress={isLoading ? undefined : onPressReport}>
          <View style={iconContainerStyle}>
            <Flag
              style={iconStyle}
              stroke={iconStroke}
              strokeWidth={3}
              height={18}
              width={18}
            />
          </View>
          <View style={labelContainerStyle}>
            <DefaultText style={labelStyle}>
              Report
            </DefaultText>
            <DefaultText style={subLabelStyle}>
              Ends the conversation, moves it to your archive, and notifies
              moderators
            </DefaultText>
          </View>
        </Pressable>
      }
      {isUpdating &&
        <View
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: appTheme.primaryColor,
            borderRadius: 10,
          }}
        >
          <LogoActivityIndicator size="large" color={appTheme.brandColor} />
        </View>
      }
    </View>
  );
};

const ConversationScreenNavBar = ({
  navigation,
  personUuid,
  urlSlug,
  isAvailableUser,
  photoUuid,
  photoBlurhash,
  name,
  isOnline,
  isSkipped,
  setIsSkipped,
}: {
  navigation: NativeStackNavigationProp<RootParamList>,
  personUuid: string,
  urlSlug: string | null,
  isAvailableUser: boolean,
  photoUuid: string | null | undefined,
  photoBlurhash: string | null | undefined,
  name: string | undefined,
  isOnline: boolean,
  isSkipped: boolean | undefined,
  setIsSkipped: Dispatch<SetStateAction<boolean | undefined>>,
}) => {
  const { appTheme } = useAppTheme();
  const [showMenu, setShowMenu] = useState(false);

  // Profile links prefer the username (url_slug), falling back to the uuid.
  const handle = urlSlug || personUuid;

  const onPressName = useCallback(() => {
    if (isAvailableUser) {
      // The user is already in this conversation, so the prospect's bottom
      // "send intro" buttons would be redundant.
      setProspectHint(handle, {
        name,
        photoBlurhash,
        hideBottomButtons: true,
      });
      navigation.navigate(
        'Prospect Profile Screen',
        {
          screen: 'Prospect Profile',
          params: { personUuid: handle },
        }
      );
    }
  }, [isAvailableUser, name, handle, photoBlurhash]);

  const toggleMenu = useCallback(() => {
    setShowMenu(x => !x);
  }, []);

  return (
    <TopNavBar>
      <TopNavBarButton
        onPress={() => navigation.goBack()}
        iconName="arrow-back"
        position="left"
        secondary={true}
      />
      <Pressable
        onPress={onPressName}
        style={{
          justifyContent: 'center',
          alignItems: 'center',
          maxWidth: 220,
          overflow: 'visible',
          flexDirection: 'row',
          gap: 10,
        }}
      >
        <View
          style={{
            width: 30,
            height: 30,
          }}
        >
          <ImageBackground
            source={photoUuid && {
              uri: `${IMAGES_URL}/450-${photoUuid}.jpg`,
              height: 30,
              width: 30,
            }}
            placeholder={photoBlurhash && { blurhash: photoBlurhash }}
            transition={150}
            style={{
              width: 30,
              height: 30,
              borderRadius: 9999,
              backgroundColor: photoUuid ? 'white' : appTheme.avatarBackgroundColor,
              justifyContent: 'center',
              alignItems: 'center',
              overflow: 'hidden',
            }}
          >
            {!photoUuid &&
              <Ionicons
                style={{
                  fontSize: 14,
                  color: appTheme.avatarColor,
                }}
                name={'person'}
              />
            }
          </ImageBackground>
          <OnlineIndicator
            personUuid={personUuid}
            size={16}
            borderWidth={2}
            style={{
              position: 'absolute',
              bottom: -4,
              right: -4,
            }}
          />
        </View>
        <DefaultText
          style={{
            fontWeight: '700',
            fontSize: 20,
          }}
          numberOfLines={1}
        >
          {name ?? '...'}
        </DefaultText>
        <ActivityIndicator
          size="small"
          color={appTheme.brandColor}
          style={{
            opacity: isOnline ? 0 : 1,
          }}
        />
      </Pressable>
      {isAvailableUser &&
        <TopNavBarButton
          onPress={toggleMenu}
          iconName="ellipsis-vertical"
          position="right"
          secondary={true}
        />
      }
      {showMenu &&
        <Menu
          navigation={navigation}
          name={name}
          personUuid={personUuid}
          isSkipped={isSkipped}
          setIsSkipped={setIsSkipped}
          closeFn={() => setShowMenu(false)}
        />
      }
    </TopNavBar>
  );
};

const ConversationScreen = ({navigation, route}: NativeStackScreenProps<RootParamList, 'Conversation Screen'>) => {
  const { appTheme } = useAppTheme();
  const [isActive, setIsActive] = useState(AppState.currentState === 'active');
  const [isOnline, setIsOnline] = useState(false);

  const [messageIds, setMessageIds] = useState<string[] | null>(null);
  const hasFetchedAll = useRef(false);
  const hasFinishedFirstLoad = useRef(false);
  const isFetchingNextPage = useRef(false);
  const [isFocused, setIsFocused] = useState(true);

  const scrollOffsetRef = useRef(0);
  const layoutMeasurementRef = useRef({ height: 0 });

  const personUuid: string = route?.params?.personUuid;

  // Descriptive details (name, photo, availability, skipped state) are not
  // passed through route params (URL-safe). They are populated from an
  // in-memory hint cache for an optimistic render, and confirmed / filled in
  // via a single `/conversation-prospect/:uuid` request shared with the nav
  // bar's overflow menu. We use that endpoint rather than `/prospect-profile`
  // because the latter records the request as a profile visit — opening a
  // chat shouldn't surface the user in the prospect's "Visitors" tab.
  const initialHint = getProspectHint(personUuid) ?? {};
  const [name, setName] = useState<string | undefined>(initialHint.name);
  const [photoUuid, setPhotoUuid] = useState<string | null | undefined>(
    initialHint.photoUuid);
  const [photoBlurhash, setPhotoBlurhash] = useState<string | null | undefined>(
    initialHint.photoBlurhash);
  const [isAvailableUser, setIsAvailableUser] = useState<boolean>(
    initialHint.isAvailableUser ?? true);
  const [isSkipped, setIsSkipped] = useState<boolean | undefined>();
  // The prospect's url_slug, resolved from /conversation-prospect; used to link
  // to their profile by username rather than uuid.
  const [urlSlug, setUrlSlug] = useState<string | null>(null);

  useEffect(() => {
    if (!personUuid) return;
    // Re-seed from the (possibly newly populated) hint on every personUuid
    // change. `useState` initializers only run on first mount, so when the
    // screen instance is reused with a different uuid we'd otherwise show
    // the previous prospect's name and photo until the API resolves.
    const hint = getProspectHint(personUuid) ?? {};
    setName(hint.name);
    setPhotoUuid(hint.photoUuid);
    setPhotoBlurhash(hint.photoBlurhash);
    setIsAvailableUser(hint.isAvailableUser ?? true);
    setIsSkipped(undefined);
    setUrlSlug(null);

    let cancelled = false;
    (async () => {
      const response = await api<ConversationProspectResponse>('get', `/conversation-prospect/${personUuid}`);
      if (cancelled) return;
      if (!response.ok) {
        // Hard-deleted prospects 404 here. Mark them unavailable so the
        // "this user is no longer reachable" UI renders on a cold-start
        // deep-link to `/chat/<uuid>` (where there's no inbox-item
        // hint to seed `isAvailableUser` from).
        setIsAvailableUser(false);
        setProspectHint(personUuid, { isAvailableUser: false });
        return;
      }
      const j = response.json ?? {};
      const nextName: string | undefined = j.name ?? undefined;
      const nextPhotoUuid: string | null = j.photo_uuid ?? null;
      const nextPhotoBlurhash: string | null = j.photo_blurhash ?? null;
      const nextIsAvailableUser: boolean = !!j.is_available;
      setName(nextName);
      setPhotoUuid(nextPhotoUuid);
      setPhotoBlurhash(nextPhotoBlurhash);
      setIsAvailableUser(nextIsAvailableUser);
      setIsSkipped(j.is_skipped ?? false);
      setUrlSlug(j.url_slug ?? null);
      setProspectHint(personUuid, {
        name: nextName,
        photoUuid: nextPhotoUuid,
        photoBlurhash: nextPhotoBlurhash,
        isAvailableUser: nextIsAvailableUser,
      });
    })();
    return () => { cancelled = true; };
  }, [personUuid]);

  // Surface the other person's name in the browser tab. App.tsx's
  // `documentTitle.formatter` reads `options.title` from the focused screen
  // and prepends it to "Duolicious". `name` is already seeded optimistically
  // from prospect-cache and refined once the API resolves, so we just track
  // whatever it currently holds.
  useLayoutEffect(() => {
    navigation.setOptions({
      title: name ? `${possessive(name)} chat` : undefined,
    });
  }, [navigation, name]);

  // Load & persist draft message for this conversation (after personUuid available)
  const [draft, saveDraft] = useDraftMessage(personUuid);

  const listRef = useRef<ScrollView>(null);

  const onPressSend = useCallback((messageBody: string, card?: QuoteCard): void => {
    const messageId = sendMessageAndNotify(
      personUuid,
      { type: 'chat-text', text: messageBody, questionCard: card }
    );

    setMessageIds(messageIds => [...(messageIds ?? []), messageId]);

    if (messageIds && messageIds.length > 45) {
      maybeRequestReview(1000);
    }

    saveDraft('');
  }, [personUuid, messageIds, saveDraft]);

  const sendTypingMessage = useCallback(
    _.debounce(
      () => sendMessageAndNotify(personUuid, { type: 'typing' }),
      1000,
      {
        leading: true,
        trailing: false,
        maxWait: 1000,
      },
    ),
    [personUuid]
  );

  const onChange = useCallback((s: string) => {
    sendTypingMessage();
    saveDraft(s);
  }, [sendTypingMessage, saveDraft]);

  const onPressGif = useCallback(() => {
    notify('show-gif-picker');
  }, []);

  useEffect(() => {
    return listen<GifPickedEvent>('gif-picked', onPressSend);
  }, [onPressSend]);

  const onAudioComplete = useCallback((audioBase64: string) => {
    const messageId = sendMessageAndNotify(
      personUuid,
      { type: 'chat-audio', audioBase64 },
      { timeoutMs: 2 * 60 * 1000 }
    );

    setMessageIds(messageIds => [...(messageIds ?? []), messageId]);
  }, []);

  const onFocus = useCallback(async () => {
    if (listRef.current && (messageIds ?? []).length !== 0) {
      await delay(200);
      listRef.current.scrollToEnd({ animated: true });
    }
  }, [messageIds]);

  const maybeLoadNextPage = useCallback(async () => {
    if (hasFetchedAll.current) {
      return;
    }

    if (isFetchingNextPage.current) {
      return;
    }
    isFetchingNextPage.current = true;

    const fetchedMessageIds = await fetchConversationAndNotify(
      personUuid,
      firstMamId(messageIds),
    );

    isFetchingNextPage.current = false;

    if (fetchedMessageIds !== 'timeout') {
      // Prevents the list from moving up to the newly added speech bubbles and
      // triggering another fetch
      if (listRef.current) listRef.current.scrollTo({ y: 2, animated: false });

      setMessageIds([...(fetchedMessageIds ?? []), ...(messageIds ?? [])]);

      hasFetchedAll.current = !(fetchedMessageIds && fetchedMessageIds.length);
    }
  }, [messageIds]);

  const isCloseToTop = ({contentOffset}: NativeScrollEvent) => contentOffset.y < 1;

  const isAtBottom = ({layoutMeasurement, contentOffset, contentSize}: NativeScrollEvent) => {
    const epsilon = 1;

    return Math.abs(
      layoutMeasurement.height + contentOffset.y -
      contentSize.height
    ) >= epsilon;
  };

  const onScroll = useCallback(({nativeEvent}: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollOffsetRef.current = nativeEvent.contentOffset.y;
    layoutMeasurementRef.current = nativeEvent.layoutMeasurement;

    if (isCloseToTop(nativeEvent) && hasFinishedFirstLoad.current) {
      maybeLoadNextPage();
    }

    if (messageIds !== null && isAtBottom(nativeEvent)) {
      hasFinishedFirstLoad.current = true;
    }
  }, [maybeLoadNextPage]);

  const markLastMessageRead = useCallback(async () => {
    const lastMessageId = _.last(messageIds);

    if (!lastMessageId) {
      return;
    }

    const lastMessage = getMessage(lastMessageId);

    if (!lastMessage) {
      return;
    }

    if (lastMessage.message.type === 'typing') {
      return;
    }

    if (
      Platform.OS !== 'web' &&
      ['background', 'inactive'].includes(AppState.currentState)
    ) {
      return;
    }

    await markDisplayed(personUuid, lastMessage.message.id);
  }, [_.last(messageIds)]);

  useSkipped(personUuid, () => navigation.popToTop());

  // Fetch the first page of messages when the conversation is first opened
  // while online
  const fetchFirstPage = useCallback(async (personUuid: string) => {
    const fetchedMessageIds = await fetchConversationAndNotify(personUuid);

    if (fetchedMessageIds === 'timeout') {
      return;
    }

    setMessageIds((messageIds) => {
      const lastIdOfPage = _.last(fetchedMessageIds);

      if (
        messageIds === null ||
        lastIdOfPage && !messageIds.includes(lastIdOfPage)
      ) {
        return fetchedMessageIds;
      } else {
        return messageIds;
      }
    });

  }, []);

  useEffect(() => {
    const onChangeAppState = (state: AppStateStatus) => {
      setIsActive(state === 'active');
    };

    const subscription = AppState.addEventListener('change', onChangeAppState);

    return () => subscription.remove();
  }, []);

  useLayoutEffect(() => {
    return listen<boolean>(
      'chat-is-online',
      (data) => setIsOnline(data ?? false),
      true,
    );
  }, []);

  useEffect(() => {
    // If the user navigates to the conversation screen via a deep link, but the
    // conversation screen was already open on a conversation with a different
    // person, then the screen should be cleared.
    setMessageIds(null);
  }, [personUuid]);

  useEffect(() => {
    if (isActive && isOnline) {
      fetchFirstPage(personUuid)
    }
  }, [personUuid, isActive && isOnline]);

  // Clear this conversation's notifications from the tray when the
  // conversation is opened, and again when the app returns to the foreground
  // while it's still open (a notification might've arrived in the background)
  useEffect(() => {
    if (isActive && personUuid) {
      dismissConversationNotificationsOnMobile(personUuid);
    }
  }, [personUuid, isActive]);

  // Scroll to end when last message changes
  useEffect(() => {
    (async () => {
      await delay(500);
      if (listRef.current) {
        listRef.current.scrollToEnd({ animated: true });
      }
    })();
  }, [_.last(messageIds)]);


  // Listen for new messages
  useEffect(() => {
    return onReceiveMessageAndNotify(
      (message: Message) => {
        if (message.type === 'chat-text' || message.type === 'chat-audio') {
          setMessageIds(messageIds => [...(messageIds ?? []), message.id]);
        }
      },
      personUuid,
      isFocused
    );
  }, [personUuid, isFocused]);

  if (Platform.OS === 'web') {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => {
      const handleFocus = () => {
        markLastMessageRead();
        setIsFocused(true);
      };

      const handleBlur = () => {
        setIsFocused(false);
      };

      // Add event listeners
      window.addEventListener('focus', handleFocus);
      window.addEventListener('blur', handleBlur);

      // Clean up
      return () => {
        window.removeEventListener('focus', handleFocus);
        window.removeEventListener('blur', handleBlur);
      };
    }, [markLastMessageRead]);
  }

  return (
    <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.safeAreaView}>
      <ConversationScreenNavBar
        navigation={navigation}
        personUuid={personUuid}
        urlSlug={urlSlug}
        isAvailableUser={isAvailableUser}
        photoUuid={photoUuid}
        photoBlurhash={photoBlurhash}
        name={name}
        isOnline={isOnline}
        isSkipped={isSkipped}
        setIsSkipped={setIsSkipped}
      />
      {messageIds === null &&
        <View style={{flexGrow: 1, justifyContent: 'center', alignItems: 'center'}}>
          <LogoActivityIndicator size="large" color={appTheme.brandColor} />
        </View>
      }
      {messageIds !== null &&
        <ScrollView
          ref={listRef}
          onScroll={onScroll}
          onContentSizeChange={(_, contentHeight) => {
            const distanceToBottom = (
              contentHeight - (
                scrollOffsetRef.current + layoutMeasurementRef.current.height
              )
            );

            if (listRef.current && distanceToBottom < 100) {
              listRef.current.scrollToEnd({ animated: true });
            }
          }}
          scrollEventThrottle={0}
          maintainVisibleContentPosition={{
            minIndexForVisible: 0
          }}
          contentContainerStyle={{
            paddingTop: 10,
            maxWidth: 600,
            width: '100%',
            alignSelf: 'center',
            ...(messageIds.length === 0 ? {
              justifyContent: 'center',
              alignItems: 'center',
              flexGrow: 1,
            } : {}),
            gap: 10,
          }}
        >
          {messageIds.length === 0 &&
            <>
              <ImageBackground
                source={photoUuid && {
                  uri: `${IMAGES_URL}/450-${photoUuid}.jpg`,
                  height: 450,
                  width: 450,
                }}
                placeholder={photoBlurhash && { blurhash: photoBlurhash }}
                transition={150}
                style={{
                  height: 200,
                  width: 200,
                  margin: 2,
                  borderRadius: 999,
                  borderColor: 'white',
                  backgroundColor: photoUuid ? 'white' : appTheme.avatarBackgroundColor,
                  overflow: 'hidden',
                  justifyContent: 'center',
                  alignItems: 'center',
                  alignSelf: 'center',
                }}
              >
                {!photoUuid &&
                  <Ionicons
                    style={{
                      fontSize: 40,
                      color: appTheme.avatarColor,
                    }}
                    name={'person'}
                  />
                }
              </ImageBackground>
              {name &&
                <>
                  <DefaultText
                    style={{
                      marginTop: 20,
                      marginBottom: 10,
                      fontFamily: 'Trueno',
                      textAlign: 'center',
                      marginLeft: '15%',
                      marginRight: '15%',
                    }}
                  >
                    This is the start of your conversation with {name}
                  </DefaultText>
                  <DefaultText
                    style={{
                      textAlign: 'center',
                      marginLeft: '10%',
                      marginRight: '10%',
                    }}
                  >
                    Intros on Duolicious have to be totally unique! Try
                    asking {name} about something interesting on their profile...
                  </DefaultText>
                </>
              }
            </>
          }
          {messageIds.length > 0 && [... new Set(messageIds)].map((messageId, i, uniqueMessageIds) => {
            const [previousMessage, message] = [
              getMessage(uniqueMessageIds[i - 1]),
              getMessage(messageId)];

            return (
              <Fragment key={messageId}>
                {previousMessage && message &&
                  <MessageDivider
                    previousMessage={previousMessage.message}
                    message={message.message}
                  />
                }
                <ChatMessage
                  messageId={messageId}
                  personUuid={personUuid}
                  name={name}
                  avatarUuid={photoUuid}
                  isLastMessage={i === uniqueMessageIds.length - 1}
                />
              </Fragment>
            );
          })}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'flex-start',
            }}
          >
            <TypingIndicator
              personUuid={personUuid}
              avatarUuid={photoUuid}
            />
          </View>
        </ScrollView>
      }
      {isAvailableUser && draft !== null &&
        <Input
          initialValue={draft}
          onPressSend={onPressSend}
          onChange={onChange}
          onPressGif={onPressGif}
          onAudioComplete={onAudioComplete}
          onFocus={onFocus}
        />
      }
      {!isAvailableUser &&
        <DefaultText
          style={{
            maxWidth: 600,
            width: '100%',
            alignSelf: 'center',
            textAlign: 'center',
            padding: 5,
            paddingTop: 10,
            paddingBottom: 10,
            backgroundColor: appTheme.interactiveBorderColor,
            fontFamily: 'Trueno',
          }}
        >
          This person isn’t available right now. This often means their account
          is inactive or was deleted.
        </DefaultText>
      }
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeAreaView: {
    flex: 1
  },
});

export {
  ConversationScreen
};
