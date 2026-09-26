import { Linking, StyleSheet, View } from 'react-native';
import { DefaultText } from '../default-text';
import { Logo16 } from '../logo';
import { ButtonWithCenteredText } from '../button/centered-text';
import { showSignUp } from '../modal/sign-up-modal';
import { useNumActiveUsers } from '../welcome-screen';
import { useAppTheme } from '../../app-theme/app-theme';
import { SidePanelCard, SidePanelHeading } from './side-panel';

const SignedOutCard = () => {
  const { appTheme } = useAppTheme();
  const numActiveUsers = useNumActiveUsers(undefined);
  const dividerStyle = { borderTopColor: appTheme.interactiveBorderColor };

  return (
    <SidePanelCard>
      <SidePanelHeading isFirst={true}>Touch grass? No.</SidePanelHeading>
      <DefaultText style={styles.pitch}>
        <DefaultText style={styles.bold}>Touch hearts.</DefaultText> Match
        with femcels, femboys, NEETs, gymcels, /lit/ pseudointellectuals, and
        that one person who’s also weirdly into trains. 100% free messaging and
        matching because monetizing loneliness is cringe and we’re broke too.
        Your body pillow had a good run. Now it’s time to romance someone who
        says “based” back.
      </DefaultText>
      <View style={[styles.members, dividerStyle]}>
        <Logo16 size={48} color={appTheme.brandColor} rectSize={0.3} />
        <View>
          <DefaultText style={styles.numMembers}>
            {numActiveUsers === undefined ?
              '\xa0' :
              numActiveUsers.toLocaleString()}
          </DefaultText>
          <DefaultText style={styles.membersLabel}>Active Members</DefaultText>
        </View>
      </View>
      <View style={[styles.buttons, dividerStyle]}>
        <ButtonWithCenteredText
          secondary={true}
          onPress={() => Linking.openURL('/faq/')}
          containerStyle={styles.button}
        >
          Read the FAQ
        </ButtonWithCenteredText>
        <ButtonWithCenteredText
          onPress={() => showSignUp(true)}
          containerStyle={styles.button}
        >
          Join or sign in
        </ButtonWithCenteredText>
      </View>
    </SidePanelCard>
  );
};

const styles = StyleSheet.create({
  pitch: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    lineHeight: 21,
  },
  bold: {
    fontWeight: '700',
  },
  members: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderTopWidth: 1,
  },
  numMembers: {
    fontSize: 20,
    fontWeight: '900',
  },
  membersLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  buttons: {
    gap: 10,
    paddingTop: 20,
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderTopWidth: 1,
  },
  button: {
    marginTop: 0,
    marginBottom: 0,
  },
});

export {
  SignedOutCard,
};
