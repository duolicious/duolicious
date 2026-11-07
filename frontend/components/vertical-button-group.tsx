import { StyleSheet, View, ViewStyle } from 'react-native';
import { Pressable } from './pressable';
import { DefaultText } from './default-text';
import { useAppTheme } from '../app-theme/app-theme';

type VerticalButtonGroupProps = {
  buttons: string[];
  selectedIndex: number;
  onPress: (index: number) => void;
  containerStyle?: ViewStyle;
  disabled?: boolean;
};

const VerticalButtonGroup: React.FC<VerticalButtonGroupProps> = ({
  buttons,
  selectedIndex,
  onPress,
  containerStyle,
  disabled = false,
}) => {
  const { appTheme } = useAppTheme();

  return (
    <View
      style={[
        styles.baseContainer,
        containerStyle,
        { borderColor: appTheme.interactiveBorderColor },
        { opacity: disabled ? 0.3 : 1 },
      ]}
      pointerEvents={disabled ? 'none' : 'auto'}
    >
      {buttons.map((label, i) => {
        const isSelected = i === selectedIndex;
        const isLast     = i === buttons.length - 1;
        return (
          <Pressable
            key={i}
            onPress={() => onPress(i)}
            style={[
              styles.button,
              {
                borderBottomColor: appTheme.interactiveBorderColor,
                borderBottomWidth: isLast ? 0 : 1,
                backgroundColor: isSelected ? '#70f' : appTheme.primaryColor,
              },
            ]}
          >
            <DefaultText
              style={{
                fontWeight: '500',
                color: isSelected ? 'white' : appTheme.secondaryColor,
              }}
            >
              {label}
            </DefaultText>
          </Pressable>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  baseContainer: {
    flexDirection: 'column',
    overflow: 'hidden',
    borderWidth: 1,
  },
  baseIndicator: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: '#70f',
  },
  button: {
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderBottomColor: '#ddd',
  },
});

export { VerticalButtonGroup };
