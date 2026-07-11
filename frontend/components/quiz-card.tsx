import {
  Animated,
  Dimensions,
  GestureResponderEvent,
  ImageBackground,
  Pressable,
  View,
  StyleProp,
  TextStyle,
  ViewStyle,
} from 'react-native';
import {
  Ref,
  createElement,
  memo,
  useCallback,
  useState,
} from 'react';
import { StatelessCheckBox } from './check-box';
import { BaseQuizCard, BaseQuizCardRef, Direction } from './base-quiz-card';
import { DefaultText } from './default-text';
import { LinearGradient } from 'expo-linear-gradient';
import { X, Check, FastForward } from "react-native-feather";
import { Skeleton } from './skeleton';
import { japi } from '../api/api';
import {
  nextAnswer,
  setAnswerPublicly,
  toggleAnswer,
  useViewerAnswer,
} from '../api/answer';
import { IndeterminateProgressBar } from './indeterminate-progress-bar';
import { Logo14 } from './logo';
import { useAppTheme } from '../app-theme/app-theme';
import { ReplyButton } from './reply-button';
import { formatCount } from '../util/util';
import { SearchFilterAnswer } from '../navigation/search-filter-state';

const cardBorders = {
  borderRadius: 10,
  shadowOffset: {
    width: 0,
    height: 2,
  },
  shadowOpacity: 0.2,
  shadowRadius: 5,
  elevation: 3,
};

const cardPadding = {
  paddingLeft: 10,
  paddingRight: 10,
  paddingTop: 5,
  paddingBottom: 10,
};

type SearchFilterAnswerResponse = {
  error?: string
  answer?: SearchFilterAnswer[]
}

const LeftComponent = ({count}: {count: number}) => {
  return (
    <View
      style={{
        position: 'absolute',
        right: 0,
        top: '20%',
        backgroundColor: '#70f',
        paddingTop: 10,
        paddingBottom: 10,
        paddingLeft: 20,
        paddingRight: 20,
        borderRadius: 30,
        alignItems: 'center',
      }}
    >
      <DefaultText
        style={{
          fontSize: 20,
          fontFamily: 'TruenoBold',
          color: 'white',
        }}
      >
        {formatCount(count)} said
      </DefaultText>
      <View style={{flexDirection: 'row', alignItems: 'center'}}>
        <DefaultText
          style={{
            fontSize: 50,
            fontFamily: 'TruenoBold',
            color: 'white',
          }}
        >
          NO{' '}
        </DefaultText>
        <X
          stroke="white"
          strokeWidth={4}
          width={40}
          height={40}
        />
      </View>
    </View>
  );
};

const RightComponent = ({count}: {count: number}) => {
  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        top: '20%',
        backgroundColor: '#70f',
        paddingTop: 10,
        paddingBottom: 10,
        paddingLeft: 20,
        paddingRight: 20,
        borderRadius: 30,
        alignItems: 'center',
      }}
    >
      <DefaultText
        style={{
          fontSize: 20,
          fontFamily: 'TruenoBold',
          color: 'white',
        }}
      >
        {formatCount(count)} said
      </DefaultText>
      <View style={{flexDirection: 'row', alignItems: 'center'}}>
        <DefaultText style={{
          fontSize: 50,
          fontFamily: 'TruenoBold',
          color: 'white',
        }}>
          YES{' '}
        </DefaultText>
        <Check
          stroke="white"
          strokeWidth={4}
          width={40}
          height={40}
        />
      </View>
    </View>
  );
};

const DownComponent = memo(() => {
  return (
    <View
      style={{
        alignItems: 'center',
        justifyContent: 'flex-start',
      }}
    >
      <View
        style={{
          backgroundColor: 'black',
          paddingLeft: 20,
          paddingRight: 20,
          alignItems: 'center',
          flexDirection: 'row',
          borderRadius: 999,
        }}
      >
        <DefaultText style={{
          fontSize: 50,
          fontFamily: 'TruenoBold',
          color: 'white',
        }}>
          SKIP{' '}
        </DefaultText>
        <FastForward
          stroke="white"
          strokeWidth={4}
          width={40}
          height={40}
        />
      </View>
    </View>
  );
});

const QuizCard = ({
  children,
  noCount,
  yesCount,
  ...props
}: {
  children: string,
  noCount: number,
  yesCount: number,
  style?: ViewStyle,
  innerStyle?: ViewStyle,
  innerRef?: Ref<BaseQuizCardRef>,
  questionNumber?: number,
  topic?: string,
  answerPubliclyValue?: boolean,
  onChangeAnswerPublicly?: (value: boolean) => void,
  imageBackgroundStyle?: ViewStyle,
  nonInteractiveContainerStyle?: Animated.WithAnimatedObject<ViewStyle>,
  initialPosition?: Direction,
  preventSwipe?: Direction[],
  onSwipe?: (direction: Direction) => void,
  onSwipePrevented?: (direction: Direction) => void,
  onCardLeftScreen?: (direction: Direction) => void,
}) => {
  const {
    style,
    innerStyle,
    innerRef,
    questionNumber,
    topic,
    answerPubliclyValue = true,
    onChangeAnswerPublicly,
    imageBackgroundStyle,
    nonInteractiveContainerStyle,
    ...rest
  } = props;

  return (
    <BaseQuizCard
      ref={innerRef}
      containerStyle={{
        position: 'absolute',
        width: '100%',
        height: '100%',
        ...style,
      }}
      leftComponent={<LeftComponent count={noCount}/>}
      rightComponent={<RightComponent count={yesCount}/>}
      downComponent={<DownComponent/>}
      swipeThreshold={75}
      {...rest}
    >
      <NonInteractiveQuizCard
        innerStyle={innerStyle}
        questionNumber={questionNumber}
        topic={topic}
        answerPubliclyValue={answerPubliclyValue}
        onChangeAnswerPublicly={onChangeAnswerPublicly}
        imageBackgroundStyle={imageBackgroundStyle}
        containerStyle={nonInteractiveContainerStyle}
        showTutorial={true}
      >
        {children}
      </NonInteractiveQuizCard>
    </BaseQuizCard>
  );
};

const NonInteractiveQuizCard = ({children, ...props}: {
  children: string,
  extraChildren?: React.ReactNode,
  containerStyle?: Animated.WithAnimatedObject<ViewStyle>,
  innerStyle?: ViewStyle,
  fontSize?: number,
  maxFontSize?: number,
  answerPubliclyValue?: boolean,
  onChangeAnswerPublicly?: (value: boolean) => void,
  questionNumber?: number,
  topic?: string,
  imageBackgroundStyle?: ViewStyle,
  showAnswerPubliclyCheckBox?: boolean,
  showTutorial?: boolean,
  onPressReply?: (e: GestureResponderEvent) => void,
}) => {
  const {
    extraChildren,
    containerStyle,
    innerStyle,
    fontSize,
    maxFontSize,
    answerPubliclyValue,
    onChangeAnswerPublicly,
    questionNumber,
    topic,
    imageBackgroundStyle,
    showAnswerPubliclyCheckBox = true,
    showTutorial = false,
    onPressReply,
  } = props;

  const { appTheme } = useAppTheme();

  const adjustedFontSize = (() => {
    const defaultFontSize = 26;

    const windowArea =
      Math.min(600, Dimensions.get('window').width) *
      Dimensions.get('window').height;

    // Window scale factor
    const w1 = Math.min(1, windowArea / 502750 + 250 / 2171);

    // Text length scale factor
    const w2 = Math.min(1, - children.length / 1000 + 12 / 10);

    const scaledFontSize = Math.round(defaultFontSize * w1 * w2);

    if (fontSize) {
      return fontSize;
    } else if (maxFontSize === undefined) {
      return scaledFontSize;
    } else if (scaledFontSize > maxFontSize) {
      return maxFontSize;
    } else {
      return scaledFontSize;
    }
  })();

  return (
    <Animated.View
      style={{
        display: 'flex',
        height: '100%',
        width: '100%',
        ...cardPadding,
        backgroundColor: 'transparent',
        ...containerStyle,
      }}
    >
      <View
        style={{
          overflow: 'visible',
          flexGrow: 1,
          backgroundColor: appTheme.quizCardBackgroundColor,
          ...cardBorders,
        }}
      >
        <ImageBackground
          source={require('../assets/background-noise.png')}
          resizeMode="repeat"
          style={{
            width: '100%',
            height: '100%',
            flexGrow: 1,
            overflow: 'hidden',
            borderRadius: cardBorders.borderRadius,
            ...imageBackgroundStyle,
            ...innerStyle,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              width: '100%',
              paddingTop: 5,
              paddingLeft: 15,
              paddingRight: 12,
              alignItems: 'center',
            }}
          >
            {questionNumber && topic &&
              <DefaultText
                style={{
                  flex: 1,
                  color: appTheme.quizCardColor,
                  textAlign: 'left',
                }}
              >
                <DefaultText
                  style={{
                    fontWeight: '600',
                    color: appTheme.quizCardColor,
                  }}
                >
                  Q
                </DefaultText>
                {questionNumber} | {topic}
              </DefaultText>
            }
            {questionNumber && topic &&
              <View
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  gap: 3,
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                }}
              >
                <DefaultText
                  style={{
                    fontFamily: 'TruenoBold',
                    fontSize: 16,
                    color: appTheme.quizCardColor,
                    textAlign: 'right',
                  }}
                >
                  Duolicious
                </DefaultText>
                <Logo14
                  size={14 * 2}
                  color={appTheme.quizCardColor}
                  rectSize={0.3}
                />
              </View>
            }
          </View>
          <View
            style={{
              margin: 20,
              flexGrow: 1,
              justifyContent: 'center',
              minWidth: 150,
            }}
          >
            <DefaultText
              style={{
                fontSize: adjustedFontSize,
                fontFamily: 'Trueno',
                textAlign: 'center',
              }}
            >
              {showTutorial && questionNumber === 1 &&
                <DefaultText style={{fontSize: adjustedFontSize * 0.8}}>
                  👋 Welcome to Duolicious Q&A, where we pick your brain in the
                  quest to unearth your perfect match! Let's start with an easy
                  one:
                  {'\n\n'}
                </DefaultText>
              }
              {showTutorial && questionNumber === 2 &&
                <DefaultText style={{fontSize: adjustedFontSize * 0.8}}>
                  Best. Answer. Ever! We'll use that to improve your matches
                  here{'\u00A0'}☝️, and when you search{'\u00A0'}🔎.
                  {'\n\n'}
                </DefaultText>
              }
              {showTutorial && questionNumber === 3 &&
                <DefaultText style={{fontSize: adjustedFontSize * 0.8}}>
                  You're on a roll! Next question...
                  {'\n\n'}
                </DefaultText>
              }
              {showTutorial && questionNumber === 4 &&
                <DefaultText style={{fontSize: adjustedFontSize * 0.8}}>
                  Some questions seem pretty silly, but we promise they help us
                  figure out who's right for you. Our smartypants AI told us so.
                  {'\n\n'}
                </DefaultText>
              }
              {showTutorial && questionNumber === 5 &&
                <DefaultText style={{fontSize: adjustedFontSize * 0.8}}>
                  ...But if a question is too silly (or controversial, or you're
                  just on the fence), then you can always skip by swiping down.
                  {'\n\n'}
                </DefaultText>
              }
              {showTutorial && questionNumber === 6 &&
                <DefaultText style={{fontSize: adjustedFontSize * 0.8}}>
                  If you've got an extra-spicy hot take, you can also answer
                  privately. Just uncheck "answer publicly". We'll keep your
                  answer hidden, but still use it to sort the folders from the
                  scrunchers.
                  {'\n\n'}
                </DefaultText>
              }
              {showTutorial && questionNumber === 7 &&
                <DefaultText style={{fontSize: adjustedFontSize * 0.8}}>
                  Looks like you've got the hang of it.  We're gonna zip it and
                  let you find your match{'\u00A0'}💑. Happy swiping!
                  {'\n\n'}
                </DefaultText>
              }
              {children}
              {showTutorial && questionNumber === 1 &&
                <DefaultText style={{fontSize: adjustedFontSize * 0.8}}>
                  {'\n\n'}
                  Drag this card left for "no", or right for "yes"
                </DefaultText>
              }
              {showTutorial && questionNumber === 2 &&
                <DefaultText style={{fontSize: adjustedFontSize * 0.8}}>
                  {'\n\n'}
                  (Left is "no", right is "yes")
                </DefaultText>
              }
              {showTutorial && questionNumber === 3 &&
                <DefaultText style={{fontSize: adjustedFontSize * 0.8}}>
                  {'\n\n'}
                  (As always, 👈 = no, yes = 👉)
                </DefaultText>
              }
            </DefaultText>
          </View>
          {showAnswerPubliclyCheckBox &&
            <StatelessCheckBox
              value={answerPubliclyValue ?? true}
              labelPosition="left"
              containerStyle={{
                marginTop: 0,
                marginBottom: 25,
                marginRight: 30,
                alignSelf: 'flex-end',
              }}
              onValueChange={onChangeAnswerPublicly ?? (() => {})}
            >
              Answer Publicly
            </StatelessCheckBox>
          }
          {extraChildren}
          {onPressReply &&
            <View style={{ paddingRight: 10, paddingBottom: 14 }}>
              <ReplyButton onPress={onPressReply} />
            </View>
          }
          {!extraChildren &&
            <LinearGradient
              locations={[
                0.0,
                0.15,
                1.0,
              ]}
              colors={[
                'transparent',
                'rgba(0, 0, 0, 0.85)',
                'rgba(0, 0, 0, 1.0)',
              ]}
              style={{
                width: '100%',
                height: 95,
              }}
            />
          }
        </ImageBackground>
      </View>
    </Animated.View>
  );
};

// Exported so layouts around AnswerIcons (like the feed's facepile row) can
// size themselves against it
const ANSWER_ICON_SIZE = 26;

const AnswerIcon = ({
  answer,
  selected,
  enabled,
  onPress = undefined
}: {
  answer: string,
  selected: boolean,
  enabled: boolean,
  onPress?: () => void
}) => {
  const { appThemeName } = useAppTheme();

  const backgroundColor = (() => {
    if (selected === false) return appThemeName === 'dark' ? 'black' : 'white';
    if (enabled) return '#70f';
    return '#cabcff';
  })();

  const checkColor = (() => {
    if (selected) return 'white';
    if (enabled) return appThemeName === 'dark' ? 'white' : 'black';
    return '#bcbcbc';
  })();

  return createElement(
    onPress ? Pressable : View,
    {
      style: {
        justifyContent: 'center',
        alignItems: 'center',
        padding: 2,
        backgroundColor: backgroundColor,
        borderColor: selected === false || !enabled ? '#bbb' : 'black',
        borderWidth: 1,
        borderRadius: 999,
        overflow: 'visible',
        width: ANSWER_ICON_SIZE,
        height: ANSWER_ICON_SIZE,
      },
      onPress,
    },
    <>
      {answer === 'yes' ?
        <Check
          stroke={checkColor}
          width={18}
          height={18}
          /> :
        <X
          stroke={checkColor}
          width={18}
          height={18}
          />
      }
    </>
  );
};

const AnswerIconGroup = ({
  answer,
  enabled,
  onPress = undefined
}: {
  answer: boolean | null,
  enabled: boolean,
  onPress?: (value: boolean) => void,
}) => {
  const onPressYes = useCallback(() => onPress && onPress(true),  [onPress]);
  const onPressNo  = useCallback(() => onPress && onPress(false), [onPress]);

  return (
    <View
      style={{
        flexDirection: 'row',
        gap: 15,
      }}
    >
      <AnswerIcon
        answer="no"
        selected={answer === false}
        enabled={enabled}
        onPress={onPress && onPressNo}
      />
      <AnswerIcon
        answer="yes"
        selected={answer === true}
        enabled={enabled}
        onPress={onPress && onPressYes}
      />
    </View>
  );
};

const AnsweredQuizCard = ({
  children,
  questionNumber,
  topic,
  user1,
  answer1,
  user2,
  onPressReply,
}: {
  children: string,
  questionNumber: number
  topic: string,
  user1: string,
  answer1: boolean | null,
  user2: string,
  onPressReply?: (e: GestureResponderEvent) => void,
}) => {
  const viewerAnswer = useViewerAnswer(questionNumber);

  const textColor = (() => {
    if (viewerAnswer.answer === null)
      return '#666';
    if (answer1 === viewerAnswer.answer) {
      return '#5a5';
    } else {
      return '#e57';
    }
  })();

  const textStyle: StyleProp<TextStyle> = {
    fontWeight: '500',
    color: textColor,
    maxWidth: 120,
  };

  const onPressAnswerIconGroup = useCallback((pressedButton: boolean) => {
    toggleAnswer(questionNumber, pressedButton);
  }, [questionNumber]);

  const onChangeAnswerPublicly = useCallback((public_: boolean) => {
    setAnswerPublicly(questionNumber, public_);
  }, [questionNumber]);

  const extraChildren = (
    <View
      style={{
        width: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        paddingBottom: 20,
        paddingLeft: 20,
        paddingRight: 20,
      }}
    >
      <View
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          marginRight: 30,
        }}
      >
        <DefaultText style={textStyle} numberOfLines={1} >
          {user1}
        </DefaultText>
        <DefaultText style={[textStyle, { marginRight: 5 }]}>
          :
        </DefaultText>
        <AnswerIconGroup answer={answer1} enabled={false}/>
      </View>
      <View
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
        }}
      >
        <DefaultText style={{ fontWeight: '500', marginRight: 5, color: '#666' }}>
          {user2}:
        </DefaultText>
        <AnswerIconGroup
          answer={viewerAnswer.answer}
          enabled={true}
          onPress={onPressAnswerIconGroup}
        />
      </View>
    </View>
  );

  return (
    <NonInteractiveQuizCard
      answerPubliclyValue={viewerAnswer.public_}
      onChangeAnswerPublicly={onChangeAnswerPublicly}
      questionNumber={questionNumber}
      topic={topic}
      containerStyle={{
        height: undefined,
        width: undefined,
        paddingLeft: 15,
        paddingRight: 15,
      }}
      innerStyle={{
        flexGrow: undefined,
        height: undefined,
        width: '100%',
      }}
      maxFontSize={18}
      extraChildren={extraChildren}
      onPressReply={onPressReply}
    >
      {children}
    </NonInteractiveQuizCard>
  );
};

const SearchQuizCard = ({
  children,
  questionNumber,
  topic,
  answer,
  initialCheckBoxValue,
  onAnswerChange,
}: {
  children: string,
  questionNumber: number,
  topic: string,
  answer: boolean | null,
  initialCheckBoxValue: boolean,
  onAnswerChange: (answers: SearchFilterAnswer[]) => void,
}) => {
  type State = {
    answer: boolean | null
    acceptUnanswered: boolean
    errorMessage?: string
    loading: boolean
  };

  const [state, setState] = useState<State>({
    answer,
    acceptUnanswered: initialCheckBoxValue,
    loading: false,
  });

  const updateAnswer = useCallback(async (acceptUnanswered?: boolean) => {
    if (state.loading) {
      return;
    };

    setState({
      ...state,
      errorMessage: undefined,
      loading: true,
    });

    const updatedAnswer = (
      acceptUnanswered === undefined ?
      nextAnswer(state.answer) :
      state.answer);

    const updatedAcceptUnanswered = (
      acceptUnanswered === undefined ?
      state.acceptUnanswered :
      acceptUnanswered);

    const response = await japi<SearchFilterAnswerResponse>(
      'post',
      '/search-filter-answer',
      {
        question_id: questionNumber,
        answer: updatedAnswer,
        accept_unanswered: updatedAcceptUnanswered,
      }
    );

    const error = response.json?.error;
    const answers = response.json?.answer;

    if (error) {
      setState({
        ...state,
        errorMessage: error,
        loading: false,
      });
    } else if (answers) {
      setState({
        ...state,
        answer: updatedAnswer,
        acceptUnanswered: updatedAcceptUnanswered,
        loading: false,
      });

      onAnswerChange(answers);
    } else {
      throw Error('Unexpected response: ' + JSON.stringify(response));
    }
  }, [state]);

  const onPressAnswer   = useCallback(() => updateAnswer(), [updateAnswer]);
  const onPressCheckBox = useCallback(updateAnswer, [updateAnswer]);

  const extraChildren = (
    <View
      style={{
        width: '100%',
        paddingLeft: 20,
        paddingRight: 20,
      }}
    >
      <View
        style={{
          alignItems: 'center',
          justifyContent: 'space-between',
          flexDirection: 'row',
          flexWrap: 'wrap',
          paddingBottom: 20,
        }}
      >
        <View
          style={{
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'row',
          }}
        >
          <DefaultText
            style={{
              fontWeight: '500',
              color: '#666'
            }}
          >
            Answer: </DefaultText>
          <Pressable onPress={onPressAnswer}>
            <AnswerIconGroup answer={state.answer} enabled={true}/>
          </Pressable>
        </View>
        <StatelessCheckBox
          value={state.acceptUnanswered}
          labelPosition="left"
          containerStyle={{
            marginTop: 0,
            marginBottom: 0,
            marginRight: 0,
            marginLeft: 0,
          }}
          onValueChange={onPressCheckBox}
        >
          <DefaultText
            style={{
              fontWeight: '500',
              color: '#666'
            }}
          >
            Accept unanswered
          </DefaultText>
        </StatelessCheckBox>
      </View>
      {state.errorMessage &&
        <DefaultText
          style={{
            color: 'red',
            alignSelf: 'center',
            marginBottom: 20,
          }}
        >
          {state.errorMessage}
        </DefaultText>
      }
      <IndeterminateProgressBar show={state.loading} />
    </View>
  );

  return (
    <NonInteractiveQuizCard
      questionNumber={questionNumber}
      topic={topic}
      containerStyle={{
        height: undefined,
        width: undefined,
        paddingLeft: 0,
        paddingRight: 0,
      }}
      innerStyle={{
        flexGrow: undefined,
        height: undefined,
        width: '100%',
      }}
      fontSize={18}
      extraChildren={extraChildren}
      showAnswerPubliclyCheckBox={false}
    >
      {children}
    </NonInteractiveQuizCard>
  );
};

const SkeletonQuizCard = (props: {innerStyle?: ViewStyle}) => {
  return (
    <Animated.View
      style={{
        position: 'absolute',
        width: '100%',
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center',
        ...cardPadding,
        ...props.innerStyle,
      }}
    >
      <Skeleton style={cardBorders} />
    </Animated.View>
  );
};

const NoMoreCards = () => {
  return (
    <View
      style={{
        position: 'absolute',
        width: '100%',
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center',
        paddingLeft: 10,
        paddingRight: 10,
        paddingTop: 5,
        paddingBottom: 5,
      }}
    >
      <DefaultText
        style={{
          fontFamily: 'TruenoBold',
          fontSize: 22,
          textAlign: 'center',
          padding: '20%',
        }}
      >
        Those are all the questions we’ve got for now
      </DefaultText>
    </View>
  );
};

export {
  ANSWER_ICON_SIZE,
  AnswerIcon,
  AnsweredQuizCard,
  NoMoreCards,
  NonInteractiveQuizCard,
  QuizCard,
  SearchQuizCard,
  SkeletonQuizCard,
}
