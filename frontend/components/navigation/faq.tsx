import { CSSProperties, Children, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { defaultFontFamily, defaultFontSize } from '../default-text';
import { commonStyles } from '../../styles';
import { useAppTheme } from '../../app-theme/app-theme';
import { api } from '../../api/api';

type GenderStats = {
  gender_ratio: number | null
  non_binary_percentage: number | null
};

type FaqItem = {
  question: string
  Answer: () => React.ReactNode
};

const useTextStyle = (): CSSProperties => {
  const { appTheme } = useAppTheme();

  return {
    margin: 0,
    color: appTheme.secondaryColor,
    fontFamily: defaultFontFamily,
    fontWeight: 'normal',
    fontSize: defaultFontSize,
    lineHeight: '21px',
  };
};

const Paragraph = ({ children }: { children: React.ReactNode }) => {
  return <p style={useTextStyle()}>{children}</p>;
};

const Italic = ({ children }: { children: React.ReactNode }) => {
  return <i>{children}</i>;
};

const Bold = ({ children }: { children: React.ReactNode }) => {
  return (
    <b style={{ fontFamily: 'MontserratBold', fontWeight: 'normal' }}>
      {children}
    </b>
  );
};

const Link = ({ href, children }: {
  href: string
  children: React.ReactNode
}) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        color: '#37f',
        fontFamily: 'MontserratSemiBold',
        textDecoration: isHovered ? 'underline' : 'none',
      }}
    >
      {children}
    </a>
  );
};

const BulletList = ({ children }: { children: React.ReactNode }) => {
  const textStyle = useTextStyle();

  return (
    <ul style={{ ...textStyle, paddingLeft: 22 }}>
      {Children.toArray(children).map((child, i) =>
        <li key={i} style={{ marginBottom: 4 }}>
          {child}
        </li>
      )}
    </ul>
  );
};

const useGenderStats = (): GenderStats | undefined => {
  const [genderStats, setGenderStats] = useState<GenderStats>();

  useEffect(() => {
    let isCurrent = true;

    (async () => {
      const response = await api<GenderStats>('GET', '/gender-stats');

      if (isCurrent && response.ok) {
        setGenderStats(response.json);
      }
    })();

    return () => { isCurrent = false };
  }, []);

  return genderStats;
};

const GenderStatsAnswer = () => {
  const genderStats = useGenderStats();

  const genderRatio = genderStats?.gender_ratio;
  const nonBinaryPercentage = genderStats?.non_binary_percentage;

  return <>
    <Paragraph>
      {genderRatio !== null && <>
        Right now the ratio of active men to women is {
          genderRatio === undefined ?
            <Italic>loading...</Italic> :
            <Bold>{genderRatio.toFixed(2)}:1</Bold>
        }. {}
      </>}
      The ratio can change a lot, depending on which online communities have
      been talking about Duolicious lately; the ratio’s previously been as high
      as about 20:1 😱.
    </Paragraph>
    <Paragraph>
      {nonBinaryPercentage !== null && <>
        Currently {
          nonBinaryPercentage === undefined ?
            <Italic>loading...</Italic> :
            <Bold>{nonBinaryPercentage.toFixed(1)}%</Bold>
        } of active members identify as non-binary. {}
      </>}
      Duolicious has the following non-binary gender options:
    </Paragraph>
    <BulletList>
      {'Agender'}
      {'Femboy'}
      {'Intersex'}
      {'Non-binary'}
      {'Transgender'}
      {'Trans woman'}
      {'Trans man'}
      {'Other'}
    </BulletList>
  </>;
};

const FAQ_ITEMS: FaqItem[] = [
  {
    question: 'Is Duolicious free?',
    Answer: () => <>
      <Paragraph>
        Yes, everyone on Duolicious can match and message people completely for
        free – no payment required. Everyone gets the same access to matches and
        messages without a subscription. In fact, all our core features are 100%
        free.
      </Paragraph>

      <Paragraph>
        For members who support us, we give convenience features like dark mode,
        extra profile customization and other perks.
      </Paragraph>
    </>,
  },
  {
    question: 'Is my profile private?',
    Answer: () => <>
      <Paragraph>
        Yes, unless you say otherwise! Only people signed into Duolicious can
        see your profile. The profiles that signed-out visitors can browse
        belong to members who turned on the optional ‘Public Profile’ setting,
        which is off by default.
      </Paragraph>
      <Paragraph>
        If you want even more privacy, you can use ‘Verification Level’ to set
        the minimum verification people need to find you in search results.
        You’ll find these options under “Privacy Settings” in the “Profile”
        tab.
      </Paragraph>
    </>,
  },
  {
    question: 'Are pics of myself required on my profile?',
    Answer: () => <>
      <Paragraph>
        No, though the other information on your profile (e.g. age, gender)
        must still be accurate. Avatars are fine, but pics of another person
        that could be mistaken for you aren’t.
      </Paragraph>
      <Paragraph>
        In locations where age verification is legally required, you’ll need to
        upload a selfie. But you upload that via our verification system, not to
        your profile.
      </Paragraph>
    </>,
  },
  {
    question: 'What’s the gender ratio on Duolicious?',
    Answer: GenderStatsAnswer,
  },
  {
    question: 'What are Duolicious clubs?',
    Answer: () => <>
      <Paragraph>
        If you want to date people who share your interests, or date people
        from your communities, Duolicious clubs are the way. Current clubs
        include:
      </Paragraph>
      <BulletList>
        <Link href="https://duolicious.gg/anime">anime</Link>
        <Link href="https://duolicious.gg/dark%20souls">dark souls</Link>
        <Link href="https://duolicious.gg/persona">persona</Link>
        <Link href="https://duolicious.gg/silly">silly</Link>
        <Link href="https://duolicious.gg/valorant">valorant</Link>
        <Link href="https://duolicious.gg/cosplay">cosplay</Link>
        <Link href="https://duolicious.gg/brainrot">brainrot</Link>
        {'and over 10,000 more!'}
      </BulletList>
      <Paragraph>
        You can make your own clubs (e.g. for your Discord server, subreddit,
        college, or interest group) in the app, or {}
        <Link href="https://duolicious.app/clubs">here</Link>
        . Though you’ll need to sign up to see who’s in them.
      </Paragraph>
    </>,
  },
  {
    question: 'How does the Duolicious matching algorithm work?',
    Answer: () => <>
      <Paragraph>
        Duolicious gives you a new match for each answer you give to our fun
        (and ginormous) personality quiz. We ask a bunch of questions about
        your personality, political alignment, habits, and so on. Based on
        those answers, Duolicious simply matches you with people similar to
        you. If you’re curious to know more, we go in depth in our {}
        <Link href="https://duolicious.app/blog/psychoanalysing-chatgpt-using-statistics-to-make-a-decent-dating-app/">
          blog article
        </Link>
        {} (including a bunch of math).
      </Paragraph>
      <Paragraph>
        As well as matching by personality, Duolicious has <Bold>Clubs</Bold> to
        help you find people who have the same interests, or who are in the
        same communities.
      </Paragraph>
    </>,
  },
  {
    question: 'Why is Duolicious telling me someone already used my intro?',
    Answer: () => <>
      <Paragraph>
        Duolicious is a dating app where opening messages need to be
        one-of-a-kind! That means if anyone on Duolicious already started a
        conversation by using “hi”, then everyone on the app who opens a
        conversation after that will have to pick a different intro. We think
        having totally unique openers is a fun way to encourage thoughtful
        messages that the person you’re messaging will love—And they’ll be more
        likely to reply to you too!
      </Paragraph>
      <Paragraph>
        Messages after the first one in a conversation can be whatever you
        want.
      </Paragraph>
    </>,
  },
  {
    question: 'Why does Duolicious use messages instead of likes to make matches?',
    Answer: () => <>
      <Paragraph>
        We want you to date people genuinely interested in you. Because
        sending a message is a tiny bit harder than sending a “like”, that
        makes it <Italic>a lot</Italic> more likely that the person messaging
        you is sincerely interested in getting to know you!
      </Paragraph>
      <Paragraph>
        Messaging on Duolicious is totally free. So to make sure you get
        thoughtful intros, we require senders to write an intro we’ve never
        seen before!
      </Paragraph>
    </>,
  },
  {
    question: 'Why does Duolicious match me with similar people? I thought opposites attract!',
    Answer: () => <>
      <Paragraph>
        Opposites do attract in some sense—That’s called {}
        <Link href="https://en.wikipedia.org/wiki/Sexual_dimorphism">
          sexual dimorphism
        </Link>
        , and it refers to the observation that males and females tend to be
        different in height, weight, body proportions, and a bunch of other
        characteristics. But even among sexually dimorphic traits, people tend
        to date others who are similar to them—And that’s called {}
        <Link href="https://en.wikipedia.org/wiki/Human_mating_strategies#Assortative_mating">
          assortative mating
        </Link>
        .
      </Paragraph>
      <Paragraph>
        Our {}
        <Link href="https://duolicious.app/blog/psychoanalysing-chatgpt-using-statistics-to-make-a-decent-dating-app/">
          blog article
        </Link>
        {} has a neat example of this. It has a chart from a study of couples’
        heights showing how people can be attracted to “opposite” and
        “similar” traits at the same time. Even though men in the study tended
        to be taller than the women they married, their heights were still
        more similar than if they partnered up at random.
      </Paragraph>
      <Paragraph>
        We’re often asked to include a way to search for people with specific
        personality traits because opposites attract, so hopefully this
        explanation has convinced you that you’ll get better matches just by
        letting the algorithm work its magic!
      </Paragraph>
    </>,
  },
  {
    question: 'How many personality questions does Duolicious have?',
    Answer: () => <>
      <Paragraph>
        Duolicious has a personality test containing 2005 questions. Even
        though our dating quiz is pretty in-depth, we made sure not to
        sacrifice fun, so we’ve got some good ones like these:
      </Paragraph>
      <BulletList>
        {'Would you date a robot if they had a great personality?'}
        {'Is it important that your partner can appreciate a good meme?'}
        {'Would you want a partner who can solve a Rubik’s Cube in under a minute, using only their feet?'}
      </BulletList>
      <Paragraph>
        Surprisingly, even answers to silly questions like these correlate
        with answers to the serious ones, and give us an idea of your
        compatibility with other members. Check out our {}
        <Link href="https://duolicious.app/blog/why-does-duolicious-ask-me-irrelevant-questions/">
          blog post
        </Link>
        {} where we did some stats to figure out which pairs of questions were
        most correlated. 🤓
      </Paragraph>
    </>,
  },
  {
    question: 'How old do I need to be to use Duolicious?',
    Answer: () => <>
      <Paragraph>
        Duolicious is strictly for people 18 years of age and older.
        Additionally, this means no photos of children who are either on
        their own or unclothed, even if they’re old photos of yourself.
      </Paragraph>
      <Paragraph>
        Even though Duolicious is for adults, we still ask you to keep your
        profile safe-for-work. 🙏
      </Paragraph>
    </>,
  },
  {
    question: 'How do I get verified on Duolicious?',
    Answer: () => <>
      <Paragraph>
        To verify your <Italic>photos</Italic> you need to upload pictures to
        your profile which include your face. Then you can run through the
        verification process in the app and your photos should be verified.
      </Paragraph>
      <Paragraph>
        To verify your <Italic>basics</Italic> (e.g. age and gender), your
        profile doesn’t need to show your face. Though you still need to upload
        a picture of yourself which will be analyzed by our AI.
      </Paragraph>
      <Paragraph>
        If that doesn’t work, you can email us your verification selfie so
        we can verify you manually. Our email address is available in the
        app, at the bottom of the “Profile” tab.
      </Paragraph>
    </>,
  },
  {
    question: 'What platforms is Duolicious available on?',
    Answer: () => <>
      <Paragraph>
        Duolicious is available via our web app, which you’re using right
        now. You can also download the app on {}
        <Link href="https://play.google.com/store/apps/details?id=app.duolicious">
          Google Play
        </Link>
        {} and the {}
        <Link href="https://apps.apple.com/us/app/duolicious-dating-app/id6499066647">
          App Store
        </Link>
        .
      </Paragraph>
    </>,
  },
];

const FaqDetails = ({ question, Answer, isFirst }: FaqItem & {
  isFirst: boolean
}) => {
  const { appTheme } = useAppTheme();
  const textStyle = useTextStyle();
  const [isOpen, setIsOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  return (
    <details
      onToggle={(e) => setIsOpen(e.currentTarget.open)}
      style={{
        borderTop: isFirst ?
          undefined :
          `1px solid ${appTheme.interactiveBorderColor}`,
      }}
    >
      <summary
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          paddingTop: 12,
          paddingBottom: 12,
          cursor: 'pointer',
          backgroundColor: isHovered ?
            `${appTheme.interactiveBorderColor}80` :
            undefined,
        }}
      >
        <h3
          style={{
            ...textStyle,
            flex: 1,
            fontFamily: 'MontserratSemiBold',
          }}
        >
          {question}
        </h3>
        <Ionicons
          style={{ color: appTheme.hintColor, fontSize: 18 }}
          name={isOpen ? 'chevron-up' : 'chevron-down'}
        />
      </summary>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          paddingBottom: 16,
        }}
      >
        <Answer/>
      </div>
    </details>
  );
};

const SectionHeading = ({ children, isFirst }: {
  children: React.ReactNode
  isFirst?: boolean
}) => {
  const { appTheme } = useAppTheme();

  return (
    <h2
      style={{
        margin: 0,
        color: appTheme.secondaryColor,
        fontFamily: 'MontserratBlack',
        fontWeight: 'normal',
        fontSize: 18,
        padding: `${isFirst ? 14 : 32}px 16px 6px`,
      }}
    >
      {children}
    </h2>
  );
};

const Faq = () => {
  const { appTheme } = useAppTheme();

  return (
    <View
      style={{
        flex: 1,
        overflow: 'hidden',
        backgroundColor: appTheme.primaryColor,
        ...commonStyles.cardBorders,
        ...appTheme.card,
      }}
    >
      <ScrollView>
        <SectionHeading isFirst={true}>Touch grass? No.</SectionHeading>

        <div style={{ padding: '0 16px 14px' }}>
          <Paragraph>
            <Bold>Touch hearts.</Bold> Match with femcels, femboys, NEETs,
            gymcels, /lit/ pseudointellectuals, and that one person who’s also
            weirdly into trains. 100% free messaging and matching because
            monetizing loneliness is cringe and we’re broke too. Your body
            pillow had a good run. Now it’s time to romance someone who says
            “based” back.
          </Paragraph>
        </div>

        <SectionHeading>Frequently asked questions</SectionHeading>

        <div style={{ paddingLeft: 16, paddingRight: 16 }}>
          {FAQ_ITEMS.map((faqItem, i) =>
            <FaqDetails key={faqItem.question} {...faqItem} isFirst={i === 0}/>
          )}
        </div>
      </ScrollView>
    </View>
  );
};

export {
  Faq,
};
