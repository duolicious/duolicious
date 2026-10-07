import {
  View,
  StyleProp,
  TextStyle,
  ViewStyle,
} from 'react-native';
import {
  ReactNode,
  useCallback,
  useState,
} from 'react';
import { DefaultText } from './default-text';
import { useAppTheme } from '../app-theme/app-theme';
import {
  AnimatedPressable,
  hoverTransition,
  RiseEdge,
  riseStyle,
  useHover,
  usePressed,
} from './hover';

const CheckChip = ({label, ...props}: {
  label?: ReactNode,
  initialCheckedState?: boolean,
  onChange?: (checked: boolean) => void,
  compact?: boolean,
}) => {
  const {
    onChange = () => {}
  } = props;

  const { appTheme } = useAppTheme();
  const [checked, setChecked] = useState(props.initialCheckedState ?? false);
  const { hovered, hoverProps } = useHover();
  const { pressed, pressProps } = usePressed();

  const checkedContainerStyle = {
    backgroundColor: 'rgb(228, 204, 255)', // = #70f, 0.2 opacity
  };

  const checkedTextStyle: StyleProp<TextStyle> = {
    color: '#70f',
  };

  const uncheckedContainerStyle: StyleProp<TextStyle> = {
    textDecorationLine: 'line-through',
  };

  const onPress_ = useCallback(() => {
    setChecked((checked: boolean) => {
      onChange(!checked);
      return !checked;
    });
  }, []);

  return (
    <AnimatedPressable
      style={[{
        borderRadius: 999,
        borderWidth: 1,
        borderRightWidth: 2,
        borderBottomWidth: 4,
        borderColor: 'black',
        paddingLeft: props.compact ? 12 : 20,
        paddingRight: props.compact ? 12 : 20,
        paddingTop: props.compact ? 5 : 12,
        paddingBottom: props.compact ? 5 : 12,
        margin: props.compact ? 3 : 5,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: appTheme.primaryColor,
        ...(checked ? checkedContainerStyle : {}),
      },
        riseStyle(hovered && !pressed),
        hoverTransition(pressed ? 'none' : 'top'),
      ]}
      onPress={onPress_}
      {...hoverProps}
      {...pressProps}
    >
      <RiseEdge
        raised={hovered && !pressed}
        pressed={pressed}
        color="black"
        border={{ top: 1, right: 2, bottom: 4, left: 1 }}
      />
      <DefaultText
        style={{
          color: '#666',
          ...(props.compact ? { fontSize: 14 } : {}),
          ...(checked ? checkedTextStyle : uncheckedContainerStyle)
        }}
      >
        {label}
      </DefaultText>
    </AnimatedPressable>
  );
};

const CheckChips = ({children, ...props}: {children?: ReactNode, style?: ViewStyle}) => {
  return (
    <View
      style={{
        justifyContent: 'center',
        flexDirection: 'row',
        flexWrap: 'wrap',
        ...props.style,
      }}
    >
      {children}
    </View>
  );
};

export {
  CheckChip,
  CheckChips,
};
