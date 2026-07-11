/**
 * The right-aligned "Reply" affordance shared by every surface that lets you
 * quote something into a conversation: bio-update feed items and quiz cards
 * (which render it inside the card via `NonInteractiveQuizCard`).
 */
import {
  GestureResponderEvent,
  Pressable,
  View,
} from 'react-native';
import { DefaultText } from './default-text';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faReply } from '@fortawesome/free-solid-svg-icons/faReply';
import { useAppTheme } from '../app-theme/app-theme';

const ReplyButton = ({
  onPress,
}: {
  onPress: (e: GestureResponderEvent) => void,
}) => {
  const { appTheme } = useAppTheme();

  return (
    <View style={{ alignItems: 'flex-end' }} >
      <Pressable
        style={{
          flexDirection: 'row',
          gap: 6,
          paddingRight: 5,
        }}
        hitSlop={20}
        onPress={onPress}
      >
        <DefaultText style={{ fontWeight: 700 }}>
          Reply
        </DefaultText>
        <FontAwesomeIcon
          icon={faReply}
          size={16}
          color={appTheme.secondaryColor}
          style={{
            /* @ts-ignore */
            outline: 'none',
          }}
        />
      </Pressable>
    </View>
  );
};

export {
  ReplyButton,
};
