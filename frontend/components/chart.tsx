import {
  DimensionValue,
  LayoutAnimation,
  Pressable,
  View,
} from 'react-native';
import {
  useCallback,
  useState,
} from 'react';
import { DefaultText } from './default-text';
import Ionicons from '@expo/vector-icons/Ionicons';
import { commonStyles } from '../styles';
import { useAppTheme } from '../app-theme/app-theme';
import { usePressableAnimation } from '../animation/animation';
import Animated from 'react-native-reanimated';

const Chart = ({name1, percentage1, name2, percentage2, ...props}: {
  name1?: string | null,
  percentage1?: number,
  name2?: string | null,
  percentage2?: number,
  children?: React.ReactNode,
  dimensionName?: string,
  minLabel?: string,
  maxLabel?: string,
}) => {
  const {
    children,
    dimensionName,
    minLabel,
    maxLabel,
  } = props;

  const compact = name1 === null && !name2;

  const { appTheme } = useAppTheme();
  const [expanded, setExpanded] = useState(false);
  const { backgroundStyle, onPressIn, onPressOut } = usePressableAnimation();

  const { scaleXY } = LayoutAnimation.Properties;
  const { easeInEaseOut } = LayoutAnimation.Types;

  const onPressChart = useCallback(() => {
    LayoutAnimation.configureNext({
      duration: 100,
      update: { type: easeInEaseOut, property: scaleXY }
    });
    setExpanded(expanded => !expanded);
  }, [setExpanded]);

  if (dimensionName && (minLabel || maxLabel)) {
    throw new Error("dimensionName can't be set at the same time as minLabel or maxLabel");
  }

  const clamp = (x: number, min: number, max: number) => {
    return Math.min(max, Math.max(min, x));
  };

  const labelPercentage = (percentage: number | undefined) => {
    if (percentage === undefined) return undefined;
    if (minLabel || maxLabel) return clamp(2 * Math.abs(percentage - 50), 0, 100);
    return percentage;
  };

  const minLabel_ = minLabel ? `100%` : '0%';
  const maxLabel_ = maxLabel ? `100%` : '100%';

  const Tick = useCallback(({position, color, ...props}: {
    position?: number,
    color: string,
    label?: string | null,
    labelPercentage?: number,
    extraHeight?: number,
    round?: boolean,
  }) => {
    const {label, labelPercentage, extraHeight, round = false} = props;

    const position_ = position && Math.round(position);
    const extraHeight_ = extraHeight || 0;

    const labelPos = position_ ?? 0;
    const labelPosition: {
      left: DimensionValue
    } | {
      right: DimensionValue
    } = labelPos < 50 ?
      {left: `${labelPos}%`} :
      {right: `${100 - labelPos}%`};

    return <>
      {
        position_ !== undefined && <View
          style={{
            position: 'absolute',
            left: `${position_}%`,
            marginLeft: round ? -5 : (label === undefined ? 0 : -1),
            backgroundColor: color,
            top: 40 - extraHeight_ - (compact ? 40 : 0),
            width: round ? 11 : (label === undefined ? 1 : 3),
            height: 11 + extraHeight_,
            borderRadius: 999,
          }}
        />
      }
      {
        position_ !== undefined && label && <DefaultText
          style={{
            position: 'absolute',
            ...labelPosition,
            top: 20 - extraHeight_,
            color: color,
            fontWeight: '600',
          }}
        >
          {label} <DefaultText style={{fontWeight: '400'}}>
            ({labelPercentage}%)
          </DefaultText>
        </DefaultText>
      }
      {
        position_ !== undefined && label === null && <DefaultText
          style={{
            position: 'absolute',
            ...labelPosition,
            marginLeft: 10,
            marginRight: 10,
            top: -5,
            color: color,
          }}
        >
          {labelPercentage}%
        </DefaultText>
      }
      {
        position_ === undefined && (label || label === null) && <View
          style={{
            width: '100%',
            position: 'absolute',
            top: label === null ? -5 : (20 - extraHeight_),
            flexDirection: 'row',
            justifyContent: 'center',
          }}
        >
          <DefaultText
            style={{
              color: color,
              fontWeight: '600',
              backgroundColor: label === null ? 'white' : undefined,
              borderRadius: 5,
            }}
          >
            {label}<DefaultText style={{fontWeight: '400'}}>
              {' '}(Not enough Q&A answers){' '}
            </DefaultText>
          </DefaultText>
        </View>
      }
    </>
  }, [compact]);

  const TraitInfoButton = useCallback(() => {
    return (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons
          style={{
            color: '#888',
            fontSize: 16,
          }}
          name={expanded ? 'chevron-up' : 'chevron-down'}
        />
      </View>
    );
  }, [expanded]);

  return (
    <Animated.View
      style={[{
        marginTop: 10,
        marginBottom: 10,
        overflow: 'visible',
        ...commonStyles.cardBorders,
        ...appTheme.card,
      }, backgroundStyle]}
    >
      <Pressable
        style={{
          padding: 10,
        }}
        onPress={onPressChart}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
      >
        <View
          style={{
            width: '100%',
          }}
        >
          <View
            style={{
              position: 'absolute',
              top: compact ? 5 : 45,
              backgroundColor: '#ddd',
              height: 1,
              width: '100%',
            }}
          />

          <View
            style={{
              marginTop: 60 - (compact ? 40 : 0),
              flexDirection: 'row',
            }}
          >
            <DefaultText style={{flex: 1, textAlign: 'left', color: "#666"}}>
              {minLabel_}
            </DefaultText>
            {(minLabel || maxLabel) &&
              <DefaultText style={{flex: 3, textAlign: 'center', color: "#666"}}>
                0%
              </DefaultText>
            }
            {!minLabel && !maxLabel &&
              <DefaultText style={{flex: 3, textAlign: 'center', fontWeight: '500'}}>
                {dimensionName}
              </DefaultText>
            }
            <DefaultText style={{flex: 1, textAlign: 'right', color: "#666"}}>
              {maxLabel_}
            </DefaultText>
          </View>

          {minLabel && maxLabel &&
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
              }}
            >
              <DefaultText style={{ fontWeight: '500', flex: 10 }}>
                {minLabel}
              </DefaultText>
              <View style={{flex: 1}}>
                {!expanded && <TraitInfoButton/>}
              </View>
              <DefaultText style={{ fontWeight: '500', flex: 10, textAlign: 'right' }}>
                {maxLabel}
              </DefaultText>
            </View>
          }

          <Tick color="#ddd" position={0}/>
          <Tick color="#ddd" position={50}/>
          <Tick color="#ddd" position={100}/>

          <Tick
            color="#c3c3c3"
            position={percentage2}
            label={name2}
            labelPercentage={labelPercentage(percentage2)}
            extraHeight={20}/>
          <Tick
            color="#70f"
            position={percentage1}
            label={name1}
            round={compact}
            labelPercentage={labelPercentage(percentage1)}
            extraHeight={0}/>
        </View>
        {expanded && <>
            <DefaultText
              style={{
                color: '#888',
                marginTop: 25,
                marginBottom: 25,
                alignSelf: 'stretch',
              }}
            >
              {children}
              {!(minLabel && maxLabel) && percentage1 !== undefined &&
                <>
                  {'\n\n'}
                  A score of {percentage1}% means that
                  about {100 - percentage1}% people on Duolicious scored higher
                  than that, and about {percentage1}% scored lower.
                </>
              }
              {(minLabel && maxLabel) &&
                <>
                  {'\n\n'}
                  A score can be 100% {minLabel.toLowerCase()}, 100% {
                  maxLabel.toLowerCase()}, or something in between. People who
                  score 0% have a roughly equal preference for {
                  minLabel.toLowerCase()} and {maxLabel.toLowerCase()}.
                </>
              }
            </DefaultText>
          </>
        }
        {(!(minLabel && maxLabel) || expanded) &&
          <TraitInfoButton/>
        }
      </Pressable>
    </Animated.View>
  );
};

export {
  Chart,
};
