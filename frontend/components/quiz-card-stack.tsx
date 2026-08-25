import {
  Animated,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import {
  MutableRefObject,
  RefObject,
  createRef,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  SkeletonQuizCard,
  NoMoreCards,
  QuizCard,
} from './quiz-card';
import { BaseQuizCardRef, Direction } from './base-quiz-card';
import { Avatar } from './avatar';
import { DonutChart } from './donut-chart';
import { DefaultText } from './default-text';
import { LinearGradient } from 'expo-linear-gradient';
import { api, japi } from '../api/api';
import { cardQueue, prospectUpdateQueue } from '../api/queue';
import * as _ from "lodash";
import { useSkipped } from '../hide-and-block/hide-and-block';
import { useAppTheme } from '../app-theme/app-theme';
import { useIsWebLoggedOut } from '../events/signed-in-user';
import { showSignUp } from './modal/sign-up-modal';
import {
  AnonymousAnswer,
  addAnonymousAnswer,
  anonymousAnswers,
  removeAnonymousAnswer,
} from '../events/anonymous-answers';
import { saveAnswer, deleteAnswer } from '../api/answer';
import { markSearchResultsStale } from '../events/stale-search-results';

// How many questions an unauthenticated web user may answer before we ask them
// to sign up.
const PUBLIC_ANSWER_LIMIT = 10;

const SIGN_UP_MESSAGE = 'Join to save your answers';

const ALL_SWIPE_DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right'];

const styles = StyleSheet.create({
  stackContainerStyle: {
    flexGrow: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 600,
    // @ts-ignore
    touchAction: 'none',
  },
});


const QuizCardMemo = memo(QuizCard);

declare interface ApiInterface {
  yes(): Promise<void>
  no(): Promise<void>
  skip(): Promise<void>
  undo(): Promise<void>
  canUndo(): boolean
  canSwipe(): boolean
}

const getRandomArbitrary = (min: number, max: number) => {
  return Math.random() * (max - min) + min;
}

const getRandomInt = (max: number) => Math.floor(Math.random() * max);

type QuestionCardData = {
  id: number
  question: string
  topic: string
  yesCount: number
  noCount: number
};

type NextQuestion = {
  id: number
  question: string
  topic: string
  count_yes: number
  count_no: number
};

const fetchNextQuestions = async (
  n: number = 10,
  o: number = 0,
  isPublic: boolean = false,
): Promise<QuestionCardData[]> => {
  const endpoint = isPublic ? '/public-next-questions' : '/next-questions';
  const response = await api<NextQuestion[]>('GET', `${endpoint}?n=${n}&o=${o}`);

  if (!response.ok) {
    return [];
  }

  return response.json.map((q) => ({
    id: q.id,
    question: q.question,
    topic: q.topic,
    yesCount: q.count_yes,
    noCount: q.count_no,
  }));
};

const prospectState = (
  personId: number,
  personUuid: string,
  urlSlug: string | null,
  photoUuid: string,
  photoBlurhash: string,
  matchPercentage: number,
  verificationRequired: 'photos' | 'basics' | null,
): ProspectState => {
  const animation = new Animated.Value(0);

  const interpolatedLeft = animation.interpolate({
    inputRange: [0, 3],
    outputRange: ['0%', '100%'],
    extrapolate: 'clamp',
  });

  const interpolatedScale = animation.interpolate({
    inputRange: [0, 1],
    outputRange: [0.75, 1],
    extrapolate: 'clamp',
  });

  const interpolatedDonutOpacity = animation.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });


  const interpolatedOpacity = animation.interpolate({
    inputRange: [2, 3],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  return {
    personId: personId,
    personUuid: personUuid,
    urlSlug: urlSlug,
    photoUuid: photoUuid,
    photoBlurhash: photoBlurhash,
    matchPercentage: matchPercentage,
    verificationRequired: verificationRequired,
    style: {
      transform: [
        { scale: interpolatedScale },
      ],
      opacity: interpolatedOpacity,
      left: interpolatedLeft
    },
    donutOpacity: interpolatedDonutOpacity,
    animation: animation,
  };
};

type SearchResult = {
  prospect_person_id: number
  prospect_uuid: string
  url_slug: string | null
  profile_photo_uuid: string
  profile_photo_blurhash: string
  match_percentage: number
  verification_required_to_view: 'photos' | 'basics' | null
};

const fetchNBestProspects = async (
  n: number,
  refreshNeighborhood: boolean,
  isPublic: boolean = false,
  answers: AnonymousAnswer[] = [],
): Promise<ProspectState[]> => {
  const rebuildsSearchCache = !isPublic && (refreshNeighborhood || n > 1);

  if (rebuildsSearchCache) {
    markSearchResultsStale();
  }

  const response = isPublic ?
    await japi<SearchResult[]>(
      'get',
      `/public-search?answers=${
        encodeURIComponent(JSON.stringify(answers))
      }&n=${n}&o=0`,
    ) :
    rebuildsSearchCache ?
    await japi<SearchResult[]>('get', `/search?n=${n}`) :
    await japi<SearchResult[]>('get', '/search');

  if (!response.ok) {
    return [];
  }

  response.json.reverse();
  return response.json.map((x) => prospectState(
    x.prospect_person_id,
    x.prospect_uuid,
    x.url_slug,
    x.profile_photo_uuid,
    x.profile_photo_blurhash,
    x.match_percentage,
    x.verification_required_to_view,
  ));
};

type StackState = {
  cards: CardState[]
  prospects: ProspectState[]
  topCardIndex: number
  questionNumbers: Set<number>
};

type BaseCardState = {
  style: {
    transform: [
      { rotate: string },
      { scale: Animated.AnimatedInterpolation<string | number> },
    ]
  }
  answerPublicly: boolean
  swipeDirection: Direction | undefined
  onChangeAnswerPublicly: ((answerPublicly: boolean) => void) | undefined
  preventSwipe: Direction[]
  scale: Animated.Value
  ref: RefObject<BaseQuizCardRef | null>
};

type UnfetchedCardState = BaseCardState & {
  isFetched: false
  questionNumber: undefined
  questionText: undefined
  topic: undefined
  noCount: number
  yesCount: number
};

type FetchedCardState = BaseCardState & {
  isFetched: true
  questionNumber: number
  questionText: string
  topic: string
  noCount: number
  yesCount: number
};

type CardState = UnfetchedCardState | FetchedCardState;

type ProspectState = {
  personId: number
  personUuid: string
  urlSlug: string | null
  photoUuid: string
  photoBlurhash: string
  matchPercentage: number
  verificationRequired: 'photos' | 'basics' | null
  style: {
    transform: [
      { scale: Animated.AnimatedInterpolation<string | number> },
    ],
    opacity: Animated.AnimatedInterpolation<string | number>
    left: Animated.AnimatedInterpolation<string | number>
  },
  donutOpacity: Animated.AnimatedInterpolation<string | number>
  animation: Animated.Value
};

const initialState = (): StackState => ({
  topCardIndex: 0,
  cards: [],
  prospects: [],
  questionNumbers: new Set<number>(),
});

const unfetchedCard = (): UnfetchedCardState => {
  const scale = new Animated.Value(0);

  const interpolatedScale = scale.interpolate({
    inputRange: [0, 1],
    outputRange: [0.95, 1]
  });

  return {
    isFetched: false,
    questionNumber: undefined,
    questionText: undefined,
    topic: undefined,
    noCount: getRandomInt(100),
    yesCount: getRandomInt(100),
    answerPublicly: true,
    swipeDirection: undefined,
    style: {
      transform: [
        { rotate: getRandomArbitrary(-0.02, 0.02) + 'rad' },
        { scale: interpolatedScale },
      ],
    },
    onChangeAnswerPublicly: undefined,
    preventSwipe: ['up'],
    scale: scale,
    ref: createRef<BaseQuizCardRef>(),
  };
};

const fetchedCard = (
  card: UnfetchedCardState,
  question: QuestionCardData,
): FetchedCardState => ({
  ...card,
  onChangeAnswerPublicly: undefined,
  isFetched: true,
  questionNumber: question.id,
  questionText: question.question,
  topic: question.topic,
  yesCount: question.yesCount,
  noCount: question.noCount,
});

const numRemainingCards = (state: StackState): number => {
  return state.cards.length - state.topCardIndex;
};

const addNextCardsInPlace = async (
  state: StackState,
  isPublic: boolean,
  onAddCallback?: () => void,
  onFetchCallback?: () => void,
  onTopCardChangedCallback?: () => void,
): Promise<void> => {
  const targetStackSize = 15
  const targetStackSizeSlack = 5;

  const numRemainingCards_ = numRemainingCards(state);

  if (numRemainingCards_ + targetStackSizeSlack > targetStackSize) {
    return;
  }

  const numCardsToAdd = (targetStackSize + targetStackSizeSlack) - numRemainingCards_;

  const unfetchedCards = Array(numCardsToAdd)
    .fill(undefined)
    .map(unfetchedCard);
  state.cards.push(...unfetchedCards);

  numRemainingCards_ < 2 && onAddCallback && onAddCallback();

  const offset = isPublic ? state.questionNumbers.size : numRemainingCards_;

  const nextQuestions = await fetchNextQuestions(
    unfetchedCards.length, offset, isPublic);

  // Pop the unfetched cards off the stack in case the server is running out of
  // questions and can't give us enough cards to meet the target.
  unfetchedCards.forEach(() => state.cards.pop());

  const fetchedCards: FetchedCardState[] = _.zip(unfetchedCards, nextQuestions).flatMap(([u, q]) => {
    if (u && q && !state.questionNumbers.has(q.id)) {
      state.questionNumbers.add(q.id);

      return [fetchedCard(u, q)];
    }

    return [];
  });

  state.cards.push(...fetchedCards);

  numRemainingCards_ < 2 && onFetchCallback && onFetchCallback();

  numRemainingCards_ === 0 &&
    onTopCardChangedCallback &&
    onTopCardChangedCallback();
};

const addNextProspectsInPlace = async (
  state: StackState,
  isPublic: boolean,
  answers: AnonymousAnswer[],
  callback?: () => void,
  n: number = 1,
) => {
  const prospects = state.prospects;

  const topCardQuestionNumber = state.cards[
    state.topCardIndex
  ]?.questionNumber ?? -1;

  prospects.push(...await fetchNBestProspects(
    n,
    [4, 8, 16, 32, 64].includes(topCardQuestionNumber),
    isPublic,
    answers,
  ));

  callback && callback();
};

const removeNextProspectInPlace = async (
  state: StackState,
  callback?: () => void,
) => {
  const prospects = state.prospects;

  Animated.parallel(
    getBestProspects(prospects).map((prospect, i) => {
      return Animated.timing(prospect.animation, {
        toValue: i - 1,
        duration: 500,
        useNativeDriver: false,
      });
    })
  ).start(() => {
    getBestProspects(prospects).map((prospect, i) => {
      prospect.animation.setValue(i - 1);
    });
    prospects.pop();
    callback && callback();
  });
};

const removePreviousAnswerInPlace = async (
  card: CardState,
  swipeDirection: Direction | undefined,
  isPublic: boolean,
  state: StackState,
  triggerRender: () => void,
) => {
  if (card.questionNumber === undefined) {
    return;
  }

  if (!isPublic) {
    await deleteAnswer(card.questionNumber);
  }

  if (swipeDirection === 'left' || swipeDirection === 'right') {
    removeNextProspectInPlace(state, triggerRender);
  }
};

const directionToAnswer = (
  direction: Direction,
): boolean | null | undefined => {
  if (direction === 'left') return false;
  if (direction === 'right') return true;
  if (direction === 'down') return null;
};

const addAnswerInPlace = async (
  direction: Direction,
  swipedCard: CardState,
  isPublic: boolean,
  state: StackState,
  triggerRender: () => void,
) => {
  if (swipedCard.questionNumber !== undefined && !isPublic) {
    await saveAnswer(
      swipedCard.questionNumber,
      directionToAnswer(direction),
      swipedCard.answerPublicly,
    );
  }

  if (direction === 'left' || direction === 'right') {
    await addNextProspectsInPlace(
      state, isPublic, anonymousAnswers, triggerRender);
  }
};

const getBestProspects = (prospects: ProspectState[]) => {
  return [
    prospects[prospects.length - 1],
    prospects[prospects.length - 2],
    prospects[prospects.length - 3],
    prospects[prospects.length - 4],
  ].filter(prospect => prospect);
};

const Prospect = ({
  style,
  personUuid,
  urlSlug,
  photoUuid,
  photoBlurhash,
  matchPercentage,
  verificationRequired,
}: {
  style: ProspectState['style'],
  personUuid: string,
  urlSlug: string | null,
  photoUuid: string,
  photoBlurhash: string,
  matchPercentage: number,
  verificationRequired: 'photos' | 'basics' | null,
}) => {
  const { isSkipped, wasPostSkipFiredInThisSession } = useSkipped(personUuid);

  return <Animated.View
    style={{
      position: 'absolute',
      width: '33.3333%',
      alignItems: 'center',
      justifyContent: 'center',
      ...style,
    }}
  >
    <Avatar
      personUuid={personUuid}
      urlSlug={urlSlug}
      photoUuid={photoUuid}
      photoBlurhash={photoBlurhash}
      percentage={matchPercentage}
      isSkipped={isSkipped && wasPostSkipFiredInThisSession}
      verificationRequired={verificationRequired}
    />
  </Animated.View>
};

const ProspectDonutPercentage = ({ donutOpacity, matchPercentage }: {
  donutOpacity: ProspectState['donutOpacity'],
  matchPercentage: number,
}) => {
  const { appTheme } = useAppTheme();

  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: 0,
        alignItems: 'center',
        justifyContent: 'center',
        width: '33.333%',
        opacity: donutOpacity,
      }}
    >
      <DonutChart
        style={{
          width: 90,
          height: 90,
          backgroundColor: appTheme.primaryColor,
          borderRadius: 999,
        }}
        percentage={matchPercentage}
      >
        <DefaultText
          style={{
            paddingBottom: 7,
            fontWeight: '500',
            fontSize: 9,
          }}
        >
          Best Match
        </DefaultText>
      </DonutChart>
    </Animated.View>
  );
};

const Prospects = ({
  topCardIndex,
  prospect1,
  prospect2,
  prospect3,
  prospect4,
}: {
  topCardIndex: number,
  prospect1: ProspectState | undefined,
  prospect2: ProspectState | undefined,
  prospect3: ProspectState | undefined,
  prospect4: ProspectState | undefined,
}) => {
  const { appTheme } = useAppTheme();

  const animatedTranslateY = useRef(new Animated.Value(0)).current;

  const translateY = animatedTranslateY.interpolate({
    inputRange: [0, 1],
    outputRange: [-150, 0],
    extrapolate: 'clamp',
  });

  const lgColors = useMemo<readonly [string, string, string]>(() => [
    `${appTheme.primaryColor}ff`,
    `${appTheme.primaryColor}bf`,
    `${appTheme.primaryColor}00`,
  ], [appTheme.primaryColor]);

  const lgLocations = useRef<readonly [number, number, number]>([
    0.0,
    0.75,
    1.0,
  ]).current;

  const lgStyle = useRef<StyleProp<ViewStyle>>({
    width: '100%',
    zIndex: 999,
    paddingTop: 5,
    paddingBottom: 15,
  }).current;

  const v1Style = useRef<Animated.WithAnimatedValue<StyleProp<ViewStyle>>>({
    marginLeft: 5,
    marginRight: 5,
    flexDirection: 'row',
    alignSelf: 'center',
    width: '100%',
    maxWidth: 600,
    transform: [
      { translateY: translateY },
    ],
  }).current;

  const dcViewStyle = useRef<StyleProp<ViewStyle>>({
    alignItems: 'center',
    justifyContent: 'center',
    width: '33.333%',
  }).current;

  const bestProspects = [
    prospect1,
    prospect2,
    prospect3,
    prospect4,
  ].flatMap(prospect => prospect ? [prospect] : []);

  useEffect(() => {
    Animated.parallel([
      ...bestProspects.map((prospect, i) => {
        return Animated.timing(prospect.animation, {
          toValue: i,
          duration: 500,
          useNativeDriver: false,
        })
      }),
      Animated.timing(animatedTranslateY, {
        toValue: bestProspects.some(Boolean) ? 1 : 0,
        duration: 500,
        useNativeDriver: false,
      })
    ]).start();
  }, [prospect1, prospect2, prospect3, prospect4]);

  return (
    <LinearGradient
      colors={lgColors}
      locations={lgLocations}
      style={lgStyle}
    >
      <Animated.View style={v1Style}>
        {
          bestProspects.map((prospect, i) =>
            <Prospect
              key={String(topCardIndex - i)}
              style={prospect.style}
              personUuid={prospect.personUuid}
              urlSlug={prospect.urlSlug}
              photoUuid={prospect.photoUuid}
              photoBlurhash={prospect.photoBlurhash}
              matchPercentage={prospect.matchPercentage}
              verificationRequired={prospect.verificationRequired} />
          )
        }
        <View style={dcViewStyle}>
          <DonutChart
            style={{
              width: 90,
              height: 90,
              backgroundColor: appTheme.primaryColor,
              borderRadius: 999,
            }}
            percentage={undefined}
          />
        </View>
        {
          bestProspects.map((prospect, i) =>
            <ProspectDonutPercentage
              key={String(topCardIndex - i)}
              donutOpacity={prospect.donutOpacity}
              matchPercentage={prospect.matchPercentage}
            />
          )
        }
      </Animated.View>
    </LinearGradient>
  );
};

const ProspectsMemo = memo(Prospects);

const QuizCardStack_ = ({
  card1,
  card2,
  card3,
  locked,
  triggerRender,
  onSwipe,
  onSwipePrevented,
  onCardLeftScreen,
}: {
  card1: CardState | undefined,
  card2: CardState | undefined,
  card3: CardState | undefined,
  locked: boolean,
  triggerRender: () => void,
  onSwipe: (direction: Direction) => Promise<void>,
  onSwipePrevented: (direction: Direction) => void,
  onCardLeftScreen: () => void,
}) => {
  const cards = [card1, card2, card3].flatMap(card => card ? [card] : []);

  const onScreenCards = cards.filter(c => c.isFetched && !c.swipeDirection);

  useEffect(() => {
    Animated.parallel(
      cards.map((card) =>
        Animated.timing(card.scale, {
          toValue: 1.0,
          duration: 500,
          useNativeDriver: false,
        })
      )
    ).start();
  }, [JSON.stringify(cards.map((card) => card.questionNumber))]);

  return (
    <View style={styles.stackContainerStyle}>
      {!onScreenCards.length && <NoMoreCards/>}
      {
        cards.map((card, i) => {
          card.onChangeAnswerPublicly = card.onChangeAnswerPublicly ?? (
            (answerPublicly: boolean) => {
              card.answerPublicly = answerPublicly;
              triggerRender();
            }
          );

          if (card.isFetched) {
            return <QuizCardMemo
              key={`${card.questionNumber}-quiz-card`}
              initialPosition={card.swipeDirection}
              preventSwipe={
                locked && card === card2
                  ? ALL_SWIPE_DIRECTIONS
                  : card.preventSwipe
              }
              innerRef={card.ref}
              onSwipe={onSwipe}
              onSwipePrevented={onSwipePrevented}
              onCardLeftScreen={onCardLeftScreen}
              nonInteractiveContainerStyle={card.style}
              questionNumber={card.questionNumber}
              topic={card.topic}
              noCount={card.noCount}
              yesCount={card.yesCount}
              answerPubliclyValue={card.answerPublicly}
              onChangeAnswerPublicly={card.onChangeAnswerPublicly}
            >
              {card.questionText}
            </QuizCardMemo>
          } else {
            return <SkeletonQuizCard
              key={`${i}-skeleton-quiz-card`}
              innerStyle={card.style}
            />
          }
        })
      }
    </View>
  );
};

const QuizCardStackMemo = memo(QuizCardStack_);

const QuizCardStack = (props: {
  innerRef: MutableRefObject<ApiInterface | undefined>,
  onTopCardChanged?: () => void,
  onSwipe: (direction: Direction) => void,
}) => {
  const {
    innerRef,
    onTopCardChanged,
    onSwipe,
  } = props;

  const isPublic = useIsWebLoggedOut();

  const stateRef = useRef<StackState>(initialState()).current;

  const [, triggerRender_] = useState({});
  const triggerRender = () => triggerRender_({});

  const isAtAnswerLimit = (): boolean =>
    isPublic && anonymousAnswers.length >= PUBLIC_ANSWER_LIMIT;

  class Api implements ApiInterface {
    async swipe(direction: Direction) {
      const cards = stateRef.cards;
      const topCardIndex = stateRef.topCardIndex;
      const topCard = cards[topCardIndex];
      if (topCard === undefined) {
        return;
      }
      if (isAtAnswerLimit()) {
        showSignUp(true, SIGN_UP_MESSAGE);
        return;
      }
      const topCardRef = topCard.ref.current;
      if (topCardRef) {
        topCardRef.swipe(direction);
      }
    }
    async restoreCard() {
      if (stateRef.topCardIndex === 0) {
        return;
      }

      const bottomCard = stateRef.cards[
        stateRef.topCardIndex + 1
      ];

      if (bottomCard) {
        bottomCard.scale.setValue(0);
      }

      const previouslySwipedCard = stateRef.cards[
        stateRef.topCardIndex - 1
      ];

      previouslySwipedCard.ref.current?.restoreCard();

      const previousSwipeDirection = previouslySwipedCard.swipeDirection;

      if (isPublic && previouslySwipedCard.questionNumber !== undefined) {
        removeAnonymousAnswer(previouslySwipedCard.questionNumber);
      }

      prospectUpdateQueue.addTask(() => removePreviousAnswerInPlace(
        previouslySwipedCard,
        previousSwipeDirection,
        isPublic,
        stateRef,
        triggerRender,
      ));

      previouslySwipedCard.swipeDirection = undefined;

      stateRef.topCardIndex--;

      triggerRender();
      onTopCardChanged && onTopCardChanged();
    }

    // eslint-disable-next-line react/no-this-in-sfc
    async yes () { await this.swipe('right') }

    // eslint-disable-next-line react/no-this-in-sfc
    async no  () { await this.swipe('left') }

    // eslint-disable-next-line react/no-this-in-sfc
    async skip() { await this.swipe('down') }

    // eslint-disable-next-line react/no-this-in-sfc
    async undo() { await this.restoreCard() }

    canUndo() {
      return stateRef.topCardIndex > 0;
    }
    canSwipe() {
      return stateRef.topCardIndex < stateRef.cards.length;
    }
  }

  innerRef.current = new Api();

  const onSwipe_ = useCallback(async (direction: Direction) => {
    const swipedCard = stateRef.cards[stateRef.topCardIndex];

    if (isAtAnswerLimit()) {
      swipedCard.ref.current?.restoreCard();
      showSignUp(true, SIGN_UP_MESSAGE);
      return;
    }

    swipedCard.swipeDirection = direction;

    if (isPublic && swipedCard.questionNumber !== undefined) {
      addAnonymousAnswer({
        question_id: swipedCard.questionNumber,
        answer: directionToAnswer(direction) ?? null,
        public: swipedCard.answerPublicly,
      });
    }

    prospectUpdateQueue.addTask(() => addAnswerInPlace(
      direction,
      swipedCard,
      isPublic,
      stateRef,
      triggerRender,
    ));

    cardQueue.addTask(() => addNextCardsInPlace(
      stateRef,
      isPublic,
      triggerRender,
      triggerRender,
      onTopCardChanged,
    ));

    stateRef.topCardIndex++;

    if (isAtAnswerLimit()) {
      showSignUp(true, SIGN_UP_MESSAGE);
    }

    onTopCardChanged && onTopCardChanged();

    onSwipe(direction);
  }, []);

  const onSwipePrevented = useCallback(() => {
    if (isAtAnswerLimit()) {
      showSignUp(true, SIGN_UP_MESSAGE);
    }
  }, []);

  const onCardLeftScreen = useCallback(() => {
    triggerRender();
  }, []);

  useEffect(() => {
    if (isPublic) {
      anonymousAnswers.forEach(
        a => stateRef.questionNumbers.add(a.question_id));
    }

    addNextProspectsInPlace(
      stateRef, isPublic, anonymousAnswers, triggerRender, 3);

    cardQueue.addTask(() => addNextCardsInPlace(
      stateRef,
      isPublic,
      triggerRender,
      triggerRender,
      onTopCardChanged
    ));
  }, []);

  return (
    <>
      <ProspectsMemo
        topCardIndex={stateRef.prospects.length - 1}
        prospect1={stateRef.prospects[stateRef.prospects.length - 1]}
        prospect2={stateRef.prospects[stateRef.prospects.length - 2]}
        prospect3={stateRef.prospects[stateRef.prospects.length - 3]}
        prospect4={stateRef.prospects[stateRef.prospects.length - 4]}
      />
      <QuizCardStackMemo
        card1={stateRef.cards[stateRef.topCardIndex + 1]}
        card2={stateRef.cards[stateRef.topCardIndex + 0]}
        card3={stateRef.cards[stateRef.topCardIndex - 1]}
        locked={isAtAnswerLimit()}
        triggerRender={triggerRender}
        onSwipe={onSwipe_}
        onSwipePrevented={onSwipePrevented}
        onCardLeftScreen={onCardLeftScreen}
      />
    </>
  );
};

export {
  ApiInterface,
  QuizCardStack
};
