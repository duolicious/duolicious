import {
  Animated,
  StyleSheet,
} from 'react-native';
import { Pressable } from '../pressable';
import {
  ReactNode,
  useState,
} from 'react'
import { DefaultText } from '../default-text';

const ModalButton = ({onPress, title, color}: {onPress?: () => void, title?: ReactNode, color?: string}) => {
  const [animatedOpacity] = useState(() => new Animated.Value(1));

  const opacityLo = 0.7;
  const opacityHi = 1.0;

  const fade = (callback?: () => void) => {
    animatedOpacity.stopAnimation();
    animatedOpacity.setValue(opacityLo);
    callback && callback();
  };

  const unfade = (callback?: () => void) => {
    animatedOpacity.stopAnimation();
    Animated.timing(animatedOpacity, {
      toValue: opacityHi,
      duration: 200,
      useNativeDriver: true,
    }).start((result) => result.finished && callback && callback());
  };

  return <Pressable
    style={styles.pressable}
    onPressIn={() => fade()}
    onPressOut={() => unfade()}
    onPress={onPress}
  >
    <Animated.View
      style={{
        borderRadius: 5,
        backgroundColor: color,
        flexGrow: 1,
        justifyContent: 'center',
        alignItems: 'center',
        opacity: animatedOpacity,
      }}
    >
      <DefaultText
        selectable={false}
        style={styles.defaultText}
      >
        {title}
      </DefaultText>
    </Animated.View>
  </Pressable>
};

const styles = StyleSheet.create({
  pressable: {
    height: 40,
    width: 100,
  },
  defaultText: {
    color: 'white',
    fontWeight: '700',
  },
});

export {
  ModalButton,
};
