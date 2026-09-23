import { DimensionValue, TextStyle, View, ViewStyle } from 'react-native';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { faBrush, faMoon, faPencil } from '@fortawesome/free-solid-svg-icons';
import { DefaultText } from '../default-text';

const brandColor = '#7700ff';
const goldColor = '#ffd700';

const card: ViewStyle = {
  position: 'absolute',
  borderWidth: 3,
  borderColor: 'black',
  borderRadius: 12,
  backgroundColor: 'white',
};

const Bar = ({
  width,
  height = 7,
  radius = 4,
  color,
  marginTop,
}: {
  width: DimensionValue
  height?: number
  radius?: number
  color: string
  marginTop?: number
}) =>
  <View
    style={{
      width,
      height,
      borderRadius: radius,
      backgroundColor: color,
      marginTop,
    }}
  />;

const Badge = ({
  icon,
  left,
  top,
  size = 38,
}: {
  icon: IconDefinition
  left: number
  top: number
  size?: number
}) =>
  <View
    style={{
      ...card,
      left,
      top,
      width: size,
      height: size,
      borderRadius: size / 2,
      backgroundColor: goldColor,
      alignItems: 'center',
      justifyContent: 'center',
    }}
  >
    <FontAwesomeIcon icon={icon} size={18} color="black" />
  </View>;

const bubbleText: TextStyle = {
  fontSize: 14,
  lineHeight: 20,
  fontWeight: 600,
};

const ReadReceipts = () =>
  <>
    <View
      style={{
        ...card,
        left: 6,
        top: 12,
        borderRadius: 16,
        borderBottomLeftRadius: 4,
        paddingVertical: 9,
        paddingHorizontal: 14,
      }}
    >
      <DefaultText disableTheme style={{ ...bubbleText, color: 'black' }}>
        Still on for Friday?
      </DefaultText>
    </View>
    <View
      style={{
        ...card,
        right: 6,
        top: 68,
        borderRadius: 16,
        borderBottomRightRadius: 4,
        backgroundColor: 'black',
        paddingVertical: 9,
        paddingHorizontal: 14,
      }}
    >
      <DefaultText disableTheme style={{ ...bubbleText, color: 'white' }}>
        Yes! See you there
      </DefaultText>
    </View>
    <DefaultText
      disableTheme
      style={{
        position: 'absolute',
        right: 10,
        top: 120,
        color: goldColor,
        fontSize: 12,
        lineHeight: 16,
        fontWeight: 500,
      }}
    >
      <DefaultText disableTheme style={{ fontWeight: 800, color: goldColor }}>
        Seen
      </DefaultText>
      {} 3:42 pm
    </DefaultText>
  </>;

const clubRows = [['Hiking', 'Anime', 'Chess'], ['Vinyl', 'Board games'], ['Cats', '+94 more']];

const Clubs = () =>
  <View
    style={{
      position: 'absolute',
      left: -10,
      right: -10,
      top: 0,
      bottom: 0,
      justifyContent: 'center',
      gap: 8,
    }}
  >
    {clubRows.map((row) =>
      <View
        key={row[0]}
        style={{ flexDirection: 'row', justifyContent: 'center', gap: 8 }}
      >
        {row.map((label) =>
          <View
            key={label}
            style={{
              backgroundColor: label.startsWith('+') ? goldColor : 'white',
              borderWidth: 2,
              borderColor: 'black',
              borderRadius: 999,
              paddingVertical: 5,
              paddingHorizontal: 11,
            }}
          >
            <DefaultText
              disableTheme
              style={{ color: 'black', fontSize: 13, lineHeight: 18, fontWeight: 700 }}
            >
              {label}
            </DefaultText>
          </View>
        )}
      </View>
    )}
  </View>;

const Phone = ({
  left,
  rotate,
  background,
  muted,
  pill,
}: {
  left: number
  rotate: string
  background: string
  muted: string
  pill: string
}) =>
  <View
    style={{
      ...card,
      left,
      top: 10,
      width: 84,
      height: 130,
      borderRadius: 14,
      backgroundColor: background,
      transform: [{ rotate }],
      alignItems: 'center',
      paddingTop: 12,
      gap: 7,
    }}
  >
    <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: muted }} />
    <Bar width={56} color={muted} />
    <Bar width={44} color={muted} />
    <Bar width={50} color={muted} />
    <Bar width={56} height={14} radius={999} color={pill} marginTop={6} />
  </View>;

const DarkMode = () =>
  <>
    <Phone left={36} rotate="-8deg" background="white" muted="#dddddd" pill={brandColor} />
    <Phone left={120} rotate="8deg" background="#1a1a1e" muted="#2a2b35" pill={goldColor} />
    <Badge icon={faMoon} left={182} top={-2} />
  </>;

const themeColors = ['#ffe8cc', '#5b2333', '#e2412a'];

const ProfileTheme = () =>
  <>
    <View
      style={{
        ...card,
        left: 22,
        top: 20,
        width: 112,
        height: 122,
        transform: [{ rotate: '-8deg' }],
        padding: 10,
        justifyContent: 'center',
        gap: 7,
      }}
    >
      <Bar width="60%" height={9} radius={5} color="black" />
      <Bar width="90%" color="#dddddd" />
      <Bar width="70%" color="#dddddd" />
    </View>
    <View
      style={{
        ...card,
        left: 104,
        top: 10,
        width: 124,
        height: 132,
        backgroundColor: themeColors[0],
        transform: [{ rotate: '7deg' }],
        padding: 10,
        justifyContent: 'center',
      }}
    >
      <DefaultText
        disableTheme
        style={{ fontSize: 15, lineHeight: 20, fontWeight: 800, color: themeColors[2] }}
      >
        Sam, 27
      </DefaultText>
      <Bar width="90%" color={themeColors[1]} marginTop={6} />
      <Bar width="70%" color={themeColors[1]} marginTop={5} />
      <Bar width="80%" color={themeColors[1]} marginTop={5} />
    </View>
    <Badge icon={faBrush} left={196} top={-4} />
    {themeColors.map((color, i) =>
      <View
        key={color}
        style={{
          ...card,
          left: 10 + 20 * i,
          top: 114,
          width: 28,
          height: 28,
          borderRadius: 14,
          backgroundColor: color,
        }}
      />
    )}
  </>;

const privacyRows: [string, boolean][] = [
  ['Browse invisibly', true],
  ['Hide from strangers', true],
  ['Show my age', false],
];

const Privacy = () =>
  <View style={{ ...card, left: 2, top: 18, width: 236, padding: 12, gap: 12 }}>
    {privacyRows.map(([label, on]) =>
      <View
        key={label}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <DefaultText
          disableTheme
          style={{ color: 'black', fontSize: 12, lineHeight: 20, fontWeight: 700 }}
        >
          {label}
        </DefaultText>
        <View
          style={{
            width: 34,
            height: 20,
            borderRadius: 999,
            backgroundColor: on ? brandColor : '#dddddd',
            padding: 3,
            alignItems: on ? 'flex-end' : 'flex-start',
          }}
        >
          <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: 'white' }} />
        </View>
      </View>
    )}
  </View>;

const DisplayName = () =>
  <>
    <View
      style={{
        ...card,
        left: 4,
        top: 36,
        width: 212,
        height: 78,
        paddingVertical: 10,
        paddingHorizontal: 14,
        gap: 4,
      }}
    >
      <DefaultText
        disableTheme
        style={{
          fontSize: 13,
          lineHeight: 16,
          fontWeight: 800,
          letterSpacing: 0.3,
          color: brandColor,
        }}
      >
        DISPLAY NAME
      </DefaultText>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <DefaultText
          disableTheme
          style={{
            fontSize: 15,
            lineHeight: 20,
            fontWeight: 600,
            color: '#999999',
            textDecorationLine: 'line-through',
          }}
        >
          Sammy
        </DefaultText>
        <DefaultText
          disableTheme
          style={{ fontSize: 22, lineHeight: 28, fontWeight: 800, color: 'black' }}
        >
          Sam
        </DefaultText>
        <View style={{ width: 2, height: 24, backgroundColor: brandColor }} />
      </View>
    </View>
    <Badge icon={faPencil} left={194} top={14} size={44} />
  </>;

const FEATURES = [
  {
    key: 'read-receipts',
    headline: ['HAVE THEY', 'SEEN IT?'],
    subtitle: 'Stop wondering. Know if they’ve seen your message, and when.',
    cta: 'Show me if they’ve seen it',
    Illustration: ReadReceipts,
  },
  {
    key: 'clubs',
    headline: ['50 CLUBS', 'ISN’T ENOUGH'],
    subtitle: 'Gold doubles your limit to 100, so every niche interest gets a spot.',
    cta: 'Give me 100 clubs',
    Illustration: Clubs,
  },
  {
    key: 'dark-mode',
    headline: ['SCROLL AT 3AM', 'IN DARK MODE'],
    subtitle: 'Easy on the eyes when you’re up past midnight.',
    cta: 'Turn on dark mode',
    Illustration: DarkMode,
  },
  {
    key: 'profile-theme',
    headline: ['YOUR PROFILE,', 'YOUR COLORS'],
    subtitle: 'Choose the colors other members see when they visit your profile.',
    cta: 'Pick my colors',
    Illustration: ProfileTheme,
  },
  {
    key: 'privacy',
    headline: ['LURK IN', 'PEACE'],
    subtitle: 'Browse invisibly, hide from strangers, and keep your age or location to yourself.',
    cta: 'Let me lurk in peace',
    Illustration: Privacy,
  },
  {
    key: 'display-name',
    headline: ['NEW NAME,', 'SAME YOU'],
    subtitle: 'Change the name people see on your profile.',
    cta: 'Change my name',
    Illustration: DisplayName,
  },
] as const;

type PointOfSaleFeature = typeof FEATURES[number]['key'];

export {
  FEATURES,
  PointOfSaleFeature,
  brandColor,
  goldColor,
};
