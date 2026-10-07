import {
  View,
  StyleSheet,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useRef,
} from 'react';
import {
  ButtonWithCenteredText,
  ButtonWithCenteredTextApi,
} from './button/centered-text';
import { ApiInterface, QuizCardStack } from './quiz-card-stack';
import {
  Check,
  FastForward,
  Rewind,
  X,
} from "react-native-feather";

interface UndoNoYesSkipApi {
  setIsUndoEnabled(value: boolean): void
  setIsSwipeEnabled(value: boolean): void
  doYesPressAnimation(): void
  doNoPressAnimation(): void
  doSkipPressAnimation(): void
}

const QuizTab = () => {
  const stackRef = useRef<ApiInterface | undefined>(undefined);

  const inputElementsRef = useRef<UndoNoYesSkipApi | undefined>(undefined);

  const onPressUndo      = () => { stackRef.current?.undo() };
  const onPressNo        = () => { stackRef.current?.no() };
  const onPressYes       = () => { stackRef.current?.yes() };
  const onPressSkip      = () => { stackRef.current?.skip() };

  const onTopCardChanged = () => {
    inputElementsRef.current?.setIsUndoEnabled(
      !!(stackRef.current && stackRef.current.canUndo())
    );

    inputElementsRef.current?.setIsSwipeEnabled(
      !!(stackRef.current && stackRef.current.canSwipe())
    );
  };

  const onSwipe = (direction: string) => {
    if (inputElementsRef.current === undefined) return;
    if (stackRef.current === undefined) return;
    if (!stackRef.current.canSwipe()) return;

    if (direction === 'left' ) inputElementsRef.current.doNoPressAnimation();
    if (direction === 'right') inputElementsRef.current.doYesPressAnimation();
    if (direction === 'down' ) inputElementsRef.current.doSkipPressAnimation();
  };

  return (
    <SafeAreaView style={styles.safeAreaView} edges={['top', 'left', 'right']}>
      <View style={styles.safeAreaView}>
        <QuizCardStack
          innerRef={stackRef}
          onTopCardChanged={onTopCardChanged}
          onSwipe={onSwipe}
        />
        <UndoNoYesSkip
          innerRef={inputElementsRef}
          onPressNo={onPressNo}
          onPressYes={onPressYes}
          onPressSkip={onPressSkip}
          onPressUndo={onPressUndo}
        />
      </View>
    </SafeAreaView>
  );
};

const UndoNoYesSkip = (props: {
  innerRef: React.MutableRefObject<UndoNoYesSkipApi | undefined>,
  onPressUndo: () => void,
  onPressNo: () => void,
  onPressYes: () => void,
  onPressSkip: () => void,
  style?: ViewStyle,
}) => {
  const undoButtonRef = useRef<ButtonWithCenteredTextApi | undefined>(undefined);
  const noButtonRef = useRef<ButtonWithCenteredTextApi | undefined>(undefined);
  const yesButtonRef = useRef<ButtonWithCenteredTextApi | undefined>(undefined);
  const skipButtonRef = useRef<ButtonWithCenteredTextApi | undefined>(undefined);

  const {
    innerRef,
    onPressUndo,
    onPressNo,
    onPressYes,
    onPressSkip,
  } = props;

  class Api implements UndoNoYesSkipApi {
    setIsUndoEnabled(value: boolean) {
      if (undoButtonRef.current) undoButtonRef.current.isEnabled(value);
    }

    setIsSwipeEnabled(value: boolean) {
      if (noButtonRef.current) noButtonRef.current.isEnabled(value);
      if (yesButtonRef.current) yesButtonRef.current.isEnabled(value);
      if (skipButtonRef.current) skipButtonRef.current.isEnabled(value);
    }

    doYesPressAnimation() {
      if (yesButtonRef.current) {
        yesButtonRef.current.doPressAnimation();
      }
    }

    doNoPressAnimation() {
      if (noButtonRef.current) {
        noButtonRef.current.doPressAnimation();
      }
    }

    doSkipPressAnimation() {
      if (skipButtonRef.current) {
        skipButtonRef.current.doPressAnimation();
      }
    }
  };

  innerRef.current = new Api();

  const buttonStyle = {
    width: 60,
    height: 60,
    aspectRatio: 1,
    margin: 10,
  };

  return (
    <View
      style={{
        width: '100%',
        maxWidth: 600,
        alignSelf: 'center',
        position: 'absolute',
        bottom: 0,
        flexGrow: 0,
        flexShrink: 1,
        paddingLeft: 15,
        paddingRight: 15,
        paddingBottom: 10,
        flexDirection: 'row',
        justifyContent: 'space-around',
        ...props.style,
      }}
    >
      <ButtonWithCenteredText
        innerRef={undoButtonRef}
        containerStyle={buttonStyle}
        secondary={true}
        onPress={onPressUndo}
        backgroundColor="black"
        borderColor="white"
        borderWidth={2}
        growOnHover={true}
        extraChildren={
          <Rewind
            stroke="white"
            strokeWidth={4}
            height={30}
            width={30}
            style={{
              marginTop: 3,
              marginLeft: -3,
            }}
          />
        }
      />
      <ButtonWithCenteredText
        innerRef={noButtonRef}
        containerStyle={buttonStyle}
        onPress={onPressNo}
        backgroundColor="#70f"
        borderColor="white"
        borderWidth={2}
        growOnHover={true}
        extraChildren={
          <X
            stroke="white"
            strokeWidth={4}
            width={30}
            height={30}
            style={{
              marginTop: 3,
            }}
          />
        }
      />
      <ButtonWithCenteredText
        innerRef={yesButtonRef}
        containerStyle={buttonStyle}
        onPress={onPressYes}
        backgroundColor="#70f"
        borderColor="white"
        borderWidth={2}
        growOnHover={true}
        extraChildren={
        <Check
          stroke="white"
          strokeWidth={4}
          width={30}
          height={30}
          style={{
            marginTop: 3,
          }}
        />
        }
      />
      <ButtonWithCenteredText
        innerRef={skipButtonRef}
        containerStyle={buttonStyle}
        secondary={true}
        onPress={onPressSkip}
        backgroundColor="black"
        borderColor="white"
        borderWidth={2}
        growOnHover={true}
        extraChildren={
          <FastForward
            stroke="white"
            strokeWidth={4}
            height={30}
            width={30}
            style={{
              marginTop: 3,
              marginRight: -3,
            }}
          />
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  safeAreaView: {
    flex: 1,
    overflow: 'hidden',
  }
});

export {
  QuizTab,
}
