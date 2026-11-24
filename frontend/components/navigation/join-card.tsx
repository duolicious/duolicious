import { StyleSheet, Text, View } from 'react-native';
import { DefaultText } from '../default-text';
import { Logo16 } from '../logo';
import { ButtonWithCenteredText } from '../button/centered-text';
import { JOIN_FREE_LABEL, showSignUp } from '../modal/sign-up-modal';
import { useNumActiveUsers } from '../welcome-screen';

const JoinCard = () => {
  const numActiveUsers = useNumActiveUsers(undefined);

  return (
    <View style={styles.card}>
      <Text style={styles.heading} selectable={false}>
        Touch grass? No.{'\n'}Touch hearts.
      </Text>
      <View style={styles.members}>
        <Logo16 size={32} color="#7700ff" rectSize={0.3} />
        <DefaultText disableTheme style={styles.membersText}>
          {numActiveUsers === undefined ?
            '\xa0' :
            `${numActiveUsers.toLocaleString()} active members`}
        </DefaultText>
      </View>
      <ButtonWithCenteredText
        onPress={() => showSignUp(true)}
        containerStyle={styles.joinButton}
        textStyle={styles.buttonText}
      >
        {JOIN_FREE_LABEL}
      </ButtonWithCenteredText>
      <ButtonWithCenteredText
        onPress={() => showSignUp(true)}
        backgroundColor="#ffffff"
        borderWidth={1}
        textColor="#000000"
        containerStyle={styles.signInButton}
        textStyle={styles.buttonText}
      >
        Sign in
      </ButtonWithCenteredText>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    alignSelf: 'stretch',
    marginHorizontal: 4,
    padding: 18,
    borderRadius: 20,
    backgroundColor: '#ffffff',
  },
  heading: {
    fontFamily: 'TruenoBold',
    fontSize: 22,
    lineHeight: 26,
    color: '#000000',
  },
  members: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  membersText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#444444',
  },
  joinButton: {
    marginTop: 10,
    marginBottom: 0,
    height: 48,
  },
  signInButton: {
    marginTop: 8,
    marginBottom: 0,
    height: 48,
  },
  buttonText: {
    fontWeight: '700',
  },
});

export {
  JoinCard,
};
