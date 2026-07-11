/**
 * Stages a quote (optionally carrying a quiz card) and opens the conversation
 * with `personUuid`. Shared by every "Reply" affordance -- the feed and the
 * In-Depth screen -- so they can't drift on how a reply is set up. The target
 * route lives in the root navigator, which `navigate` resolves from any nested
 * screen, so this works from the prospect navigator too.
 */
import { useCallback } from 'react';
import { GestureResponderEvent } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootParamList } from './linking';
import { QuoteCard, setQuote } from '../components/conversation-screen/quote';
import { setProspectHint } from './prospect-cache';

const useNavigationToConversation = (
  personUuid: string,
  name: string,
  photoUuid: string | null,
  photoBlurhash: string | null,
  quote: string,
  card?: QuoteCard,
) => {
  const navigation = useNavigation<NativeStackNavigationProp<RootParamList>>();

  return useCallback((e: GestureResponderEvent) => {
    e.preventDefault();

    setQuote({ text: quote, attribution: name, card });

    setProspectHint(personUuid, { name, photoUuid, photoBlurhash });
    navigation.navigate('Conversation Screen', { personUuid });
  }, [personUuid, name, photoUuid, photoBlurhash, quote, card]);
};

export {
  useNavigationToConversation,
};
