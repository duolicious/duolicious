import { ComponentType, ReactNode, useState } from 'react';
import { TextStyle, View } from 'react-native';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { faCheck } from '@fortawesome/free-solid-svg-icons';
import { Pressable } from '../pressable';
import { DefaultText } from '../default-text';
import { FEATURES, brandColor, goldColor } from './point-of-sale-features';

const fadedWhite = 'rgba(255, 255, 255, 0.85)';

type Feature = typeof FEATURES[number];

type PerksProps = {
  active: number
  setActive: (active: number) => void
  compact: boolean
};

type Arm = {
  name: string
  hasTitle: boolean
  hasSlimPlans: boolean
  Above: ComponentType<PerksProps>
  Below?: ComponentType<PerksProps>
  plansMarginTop: (compact: boolean) => number
  missionMarginTop: (compact: boolean) => number | null
  cta: (feature: Feature) => string
};

const featureCta = (feature: Feature) => feature.cta;

const allPerksCta = () => `Get all ${FEATURES.length} with Gold`;

const otherFeatures = (active: number) => FEATURES.filter((_, i) => i !== active);

const activeFirst = (active: number) =>
  [active, ...FEATURES.map((_, i) => i).filter((i) => i !== active)];

const Headline = ({
  lines,
  size,
  marginTop,
}: {
  lines: readonly string[]
  size: number
  marginTop: number
}) =>
  <View style={{ marginTop, paddingHorizontal: 24 }}>
    {lines.map((line, i) =>
      <DefaultText
        key={line}
        disableTheme
        style={{
          fontSize: size,
          lineHeight: size + 4,
          fontWeight: 900,
          color: i === 0 ? 'white' : goldColor,
        }}
      >
        {line}
      </DefaultText>
    )}
  </View>;

const Art = ({
  feature,
  small,
  marginTop,
}: {
  feature: Feature
  small: boolean
  marginTop: number
}) =>
  <View style={{ marginTop, height: small ? 96 : 150, alignItems: 'center' }}>
    <View
      style={{
        width: 240,
        height: 150,
        transform: [{ scale: small ? 0.64 : 1 }],
        transformOrigin: 'top',
      }}
    >
      <feature.Illustration />
    </View>
  </View>;

const IconCircle = ({
  icon,
  size,
  iconSize,
  color = goldColor,
  iconColor = 'black',
}: {
  icon: IconDefinition
  size: number
  iconSize: number
  color?: string
  iconColor?: string
}) =>
  <View
    style={{
      width: size,
      height: size,
      borderRadius: size / 2,
      borderWidth: 3,
      borderColor: 'black',
      backgroundColor: color,
      alignItems: 'center',
      justifyContent: 'center',
    }}
  >
    <FontAwesomeIcon icon={icon} size={iconSize} color={iconColor} />
  </View>;

const Grid = ({
  marginTop,
  rowGap = 0,
  columnGap = 12,
  children,
}: {
  marginTop: number
  rowGap?: number
  columnGap?: number
  children: ReactNode
}) =>
  <View style={{ marginTop, flexDirection: 'row', flexWrap: 'wrap', rowGap, columnGap }}>
    {children}
  </View>;

const Perk = ({
  icon = faCheck,
  iconSize = 12,
  iconColor,
  label,
  height,
  gap,
  textStyle,
  onPress,
}: {
  icon?: IconDefinition
  iconSize?: number
  iconColor: string
  label: string
  height: number
  gap: number
  textStyle: TextStyle
  onPress?: () => void
}) =>
  <Pressable
    disabled={!onPress}
    onPress={onPress}
    style={{
      flexBasis: '40%',
      flexGrow: 1,
      height,
      flexDirection: 'row',
      alignItems: 'center',
      gap,
    }}
  >
    <FontAwesomeIcon icon={icon} size={iconSize} color={iconColor} />
    <DefaultText disableTheme style={textStyle}>
      {label}
    </DefaultText>
  </Pressable>;

const OtherPerks = ({
  active,
  compact,
  height,
  marginTop,
  iconColor,
}: {
  active: number
  compact: boolean
  height: number
  marginTop: number
  iconColor: string
}) =>
  <Grid marginTop={marginTop}>
    {otherFeatures(active).map(({ key, name }) =>
      <Perk
        key={key}
        iconColor={iconColor}
        label={name}
        height={compact ? 24 : height}
        gap={compact ? 6 : 8}
        textStyle={{
          fontSize: compact ? 13 : 14,
          lineHeight: compact ? 18 : 20,
          fontWeight: 700,
          color: 'black',
        }}
      />
    )}
  </Grid>;

const Checklist = ({ active, setActive, compact }: PerksProps) => {
  const [order] = useState(() => activeFirst(active));

  return <>
    <Art feature={FEATURES[active]} small marginTop={compact ? 16 : 8} />
    <Headline lines={FEATURES[active].headline} size={28} marginTop={12} />
    {!compact &&
      <DefaultText
        disableTheme
        style={{
          marginTop: 8,
          paddingHorizontal: 24,
          minHeight: 42,
          fontSize: 15,
          lineHeight: 21,
          color: 'white',
        }}
      >
        {FEATURES[active].subtitle}
      </DefaultText>
    }
    <View style={{ marginTop: compact ? 24 : 20, marginHorizontal: 24 }}>
      <DefaultText
        disableTheme
        style={{
          fontSize: 12,
          lineHeight: 16,
          fontWeight: 800,
          letterSpacing: 0.3,
          color: 'white',
        }}
      >
        <DefaultText disableTheme style={{ fontWeight: 800, color: goldColor }}>
          ALL {FEATURES.length}
        </DefaultText>
        {} INCLUDED WITH GOLD
      </DefaultText>
      <Grid marginTop={6} columnGap={8}>
        {order.map((i) =>
          <Perk
            key={FEATURES[i].key}
            iconColor={goldColor}
            label={FEATURES[i].name}
            height={28}
            gap={8}
            textStyle={{
              fontSize: 13,
              lineHeight: 18,
              fontWeight: i === active ? 800 : 600,
              color: i === active ? goldColor : 'white',
            }}
            onPress={() => setActive(i)}
          />
        )}
      </Grid>
    </View>
  </>;
};

const FullList = ({ active, compact }: PerksProps) =>
  <>
    <Headline
      lines={['ALL OF THIS', 'COMES WITH GOLD']}
      size={28}
      marginTop={compact ? 16 : 8}
    />
    <View
      style={{
        marginTop: compact ? 24 : 16,
        paddingHorizontal: 24,
        flexDirection: compact ? 'row' : 'column',
        flexWrap: compact ? 'wrap' : 'nowrap',
        columnGap: 12,
        rowGap: compact ? 14 : 6,
      }}
    >
      {[FEATURES[active], ...otherFeatures(active)].map(({ key, name, description, icon }) =>
        <View
          key={key}
          style={{
            flexBasis: compact ? '40%' : 'auto',
            flexGrow: 1,
            height: compact ? 32 : 44,
            flexDirection: 'row',
            alignItems: 'center',
            gap: compact ? 10 : 12,
          }}
        >
          <IconCircle icon={icon} size={compact ? 32 : 36} iconSize={compact ? 14 : 16} />
          <View style={{ flexShrink: 1 }}>
            <DefaultText
              disableTheme
              style={{
                fontSize: compact ? 13 : 15,
                lineHeight: compact ? 18 : 20,
                fontWeight: compact ? 700 : 800,
                color: 'white',
              }}
            >
              {name}
            </DefaultText>
            {!compact &&
              <DefaultText
                disableTheme
                style={{ fontSize: 12, lineHeight: 16, fontWeight: 500, color: fadedWhite }}
              >
                {description}
              </DefaultText>
            }
          </View>
        </View>
      )}
    </View>
  </>;

const Simple = ({ active, compact }: PerksProps) => {
  const others = otherFeatures(active).map((f) => f.name.toLowerCase());

  return (
    <>
      <Art feature={FEATURES[active]} small={compact} marginTop={compact ? 8 : 16} />
      <Headline
        lines={FEATURES[active].headline}
        size={compact ? 28 : 34}
        marginTop={compact ? 12 : 20}
      />
      <DefaultText
        disableTheme
        style={{
          marginTop: compact ? 8 : 10,
          paddingHorizontal: 24,
          fontSize: compact ? 15 : 16,
          lineHeight: compact ? 21 : 22,
          color: 'white',
        }}
      >
        <DefaultText disableTheme style={{ fontWeight: 700, color: 'white' }}>
          Gold includes {FEATURES[active].name.toLowerCase()},
        </DefaultText>
        {} plus {others.slice(0, -1).join(', ')} and {others.at(-1)}.
      </DefaultText>
    </>
  );
};

const MembershipCard = ({ active, compact }: PerksProps) =>
  <>
    <Headline
      lines={['THAT’S A', 'GOLD PERK']}
      size={compact ? 28 : 34}
      marginTop={compact ? 0 : 16}
    />
    <View
      style={{
        marginTop: compact ? 22 : 32,
        marginHorizontal: 24,
        paddingVertical: compact ? 14 : 22,
        paddingHorizontal: compact ? 16 : 22,
        backgroundColor: goldColor,
        borderWidth: 3,
        borderColor: 'black',
        borderRadius: 16,
        transform: [{ rotate: '-2deg' }],
      }}
    >
      <View
        style={{
          height: 20,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <DefaultText
          disableTheme
          style={{
            fontSize: 12,
            lineHeight: 16,
            fontWeight: 900,
            letterSpacing: 1.5,
            color: 'black',
          }}
        >
          DUOLICIOUS GOLD
        </DefaultText>
        <View
          style={{
            backgroundColor: 'black',
            borderRadius: 999,
            paddingVertical: 2,
            paddingHorizontal: 9,
          }}
        >
          <DefaultText
            disableTheme
            style={{
              fontSize: 11,
              lineHeight: 16,
              fontWeight: 800,
              letterSpacing: 0.3,
              color: goldColor,
            }}
          >
            {FEATURES.length} PERKS
          </DefaultText>
        </View>
      </View>
      <View
        style={{
          marginTop: compact ? 12 : 18,
          flexDirection: 'row',
          alignItems: 'center',
          gap: compact ? 10 : 12,
        }}
      >
        <IconCircle
          icon={faCheck}
          size={compact ? 24 : 30}
          iconSize={compact ? 12 : 15}
          color="black"
          iconColor={goldColor}
        />
        <DefaultText
          disableTheme
          style={{
            fontSize: compact ? 22 : 26,
            lineHeight: compact ? 26 : 32,
            fontWeight: 900,
            color: 'black',
          }}
        >
          {FEATURES[active].name}
        </DefaultText>
      </View>
      <DefaultText
        disableTheme
        style={{
          marginTop: compact ? 4 : 6,
          fontSize: compact ? 13 : 15,
          lineHeight: compact ? 18 : 21,
          fontWeight: 500,
          color: 'black',
        }}
      >
        {FEATURES[active].description}
      </DefaultText>
      <View
        style={{
          marginVertical: compact ? 12 : 18,
          borderWidth: 1,
          borderStyle: 'dashed',
          borderColor: 'black',
        }}
      />
      <DefaultText
        disableTheme
        style={{
          fontSize: 11,
          lineHeight: 14,
          fontWeight: 800,
          letterSpacing: 0.5,
          color: 'black',
        }}
      >
        PLUS
      </DefaultText>
      <OtherPerks
        active={active}
        compact={compact}
        height={30}
        marginTop={compact ? 6 : 8}
        iconColor="black"
      />
    </View>
  </>;

const PerkCard = ({ active, compact }: PerksProps) =>
  <>
    <Headline
      lines={FEATURES[active].headline}
      size={compact ? 28 : 34}
      marginTop={compact ? 8 : 16}
    />
    <View
      style={{
        marginTop: compact ? 18 : 24,
        marginHorizontal: 24,
        paddingVertical: compact ? 12 : 16,
        paddingHorizontal: compact ? 16 : 18,
        backgroundColor: 'white',
        borderWidth: 3,
        borderColor: 'black',
        borderRadius: 12,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: compact ? 10 : 12 }}>
        <IconCircle
          icon={FEATURES[active].icon}
          size={compact ? 34 : 38}
          iconSize={compact ? 16 : 18}
        />
        <View style={{ flexShrink: 1 }}>
          <DefaultText
            disableTheme
            style={{
              fontSize: compact ? 16 : 18,
              lineHeight: compact ? 22 : 24,
              fontWeight: 800,
              color: 'black',
            }}
          >
            {FEATURES[active].name}
          </DefaultText>
          <DefaultText
            disableTheme
            style={{
              fontSize: compact ? 12 : 13,
              lineHeight: compact ? 16 : 18,
              fontWeight: 500,
              color: '#666666',
            }}
          >
            {FEATURES[active].description}
          </DefaultText>
        </View>
      </View>
      <View
        style={{
          marginVertical: compact ? 10 : 14,
          height: 1,
          backgroundColor: '#dddddd',
        }}
      />
      <DefaultText
        disableTheme
        style={{
          fontSize: 11,
          lineHeight: 14,
          fontWeight: 800,
          letterSpacing: 0.3,
          color: brandColor,
        }}
      >
        ALSO IN GOLD
      </DefaultText>
      <OtherPerks
        active={active}
        compact={compact}
        height={28}
        marginTop={compact ? 4 : 6}
        iconColor={brandColor}
      />
    </View>
  </>;

const PlainHeadline = ({ active, compact }: PerksProps) =>
  <Headline
    lines={[FEATURES[active].name.toUpperCase(), `${FEATURES[active].verb} WITH GOLD`]}
    size={compact ? 28 : 30}
    marginTop={compact ? 24 : 56}
  />;

const PlainPerks = ({ active, compact }: PerksProps) =>
  <View style={{ marginTop: compact ? 20 : 36, paddingHorizontal: 24 }}>
    <DefaultText
      disableTheme
      style={{
        fontSize: 12,
        lineHeight: 16,
        fontWeight: 800,
        letterSpacing: 0.5,
        color: fadedWhite,
      }}
    >
      ALSO IN GOLD
    </DefaultText>
    <Grid marginTop={compact ? 8 : 12} rowGap={compact ? 4 : 8}>
      {otherFeatures(active).map(({ key, name, icon }) =>
        <Perk
          key={key}
          icon={icon}
          iconSize={compact ? 16 : 18}
          iconColor={goldColor}
          label={name}
          height={compact ? 26 : 32}
          gap={10}
          textStyle={{
            fontSize: compact ? 13 : 14,
            lineHeight: compact ? 18 : 20,
            fontWeight: 500,
            color: fadedWhite,
          }}
        />
      )}
    </Grid>
  </View>;

const ARMS: Arm[] = [
  {
    name: 'checklist',
    hasTitle: true,
    hasSlimPlans: false,
    Above: Checklist,
    plansMarginTop: (compact) => compact ? 34 : 36,
    missionMarginTop: (compact) => compact ? null : 18,
    cta: allPerksCta,
  },
  {
    name: 'full-list',
    hasTitle: true,
    hasSlimPlans: false,
    Above: FullList,
    plansMarginTop: (compact) => compact ? 34 : 26,
    missionMarginTop: (compact) => compact ? 12 : 18,
    cta: allPerksCta,
  },
  {
    name: 'feature-first',
    hasTitle: true,
    hasSlimPlans: false,
    Above: Simple,
    plansMarginTop: (compact) => compact ? 34 : 36,
    missionMarginTop: (compact) => compact ? 12 : 18,
    cta: featureCta,
  },
  {
    name: 'membership-card',
    hasTitle: false,
    hasSlimPlans: true,
    Above: MembershipCard,
    plansMarginTop: (compact) => compact ? 26 : 36,
    missionMarginTop: (compact) => compact ? 14 : 20,
    cta: featureCta,
  },
  {
    name: 'perk-card',
    hasTitle: true,
    hasSlimPlans: false,
    Above: PerkCard,
    plansMarginTop: (compact) => compact ? 28 : 36,
    missionMarginTop: (compact) => compact ? 12 : 18,
    cta: featureCta,
  },
  {
    name: 'plain',
    hasTitle: true,
    hasSlimPlans: false,
    Above: PlainHeadline,
    Below: PlainPerks,
    plansMarginTop: (compact) => compact ? 36 : 48,
    missionMarginTop: (compact) => compact ? 12 : 32,
    cta: () => 'Get Gold',
  },
];

const armOf = (personId: number | undefined) => ARMS[(personId ?? 0) % ARMS.length];

export {
  ARMS,
  Arm,
  armOf,
};
