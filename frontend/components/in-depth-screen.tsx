import {
  View,
} from 'react-native';
import { LogoActivityIndicator } from './logo/logo-activity-indicator';
import {
  memo,
  useEffect,
  useLayoutEffect,
  useState,
} from 'react';
import { seedViewerAnswer, useViewerAnswer } from '../api/answer';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TopNavBar } from './top-nav-bar';
import { DefaultText } from './default-text';
import { ButtonGroup } from './button-group';
import { AnsweredQuizCard } from './quiz-card';
import { DefaultFlatList } from './default-flat-list';
import { Chart } from './chart';
import { api } from '../api/api';
import { StatusBarSpacer } from './status-bar-spacer';
import { FloatingBackButton } from './prospect-profile-screen/prospect-profile-screen';
import type { ProspectNavigationRef } from './prospect-profile-screen/prospect-profile-screen';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ProspectParamList } from '../navigation/linking';
import { useSignedInUser } from '../events/signed-in-user';
import { getProspectHint, setProspectHint } from '../navigation/prospect-cache';
import { useNavigationToConversation } from '../navigation/use-navigation-to-conversation';
import { quizCardQuoteText } from './conversation-screen/quote';

type CompareAnswer = {
  question_id: number,
  topic: string,
  prospect_name: string,
  prospect_answer: boolean | null,
  person_answer: boolean | null,
  person_public_: boolean | null,
  question: string,
};

type TraitData = {
  trait_name?: string,
  trait_min_label?: string,
  trait_max_label?: string,
  trait_description?: string,
  prospect_name?: string | null,
  prospect_percentage?: number | null,
  person_percentage?: number | null,
};

type PersonalityTopic = 'mbti' | 'big5' | 'attachment' | 'politics' | 'other';

type InDepthListItem =
  | { kind: 'answer', item: CompareAnswer }
  | { kind: PersonalityTopic, data: TraitData[] };

type ProspectProfileResponse = {
  person_id: number,
  name: string,
};

const sideMargins = {
  marginLeft: 10,
  marginRight: 10,
};

const Subtitle = ({children}: {children: React.ReactNode}) => {
  return (
    <DefaultText
      style={{
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 5,
        marginTop: 15,
        color: '#888',
        ...sideMargins,
      }}
    >
      {children}
    </DefaultText>
  );
};

const Header = ({
  name,
  idx1,
  idx2,
  idx3,
  idx4,
  onChangeIdx1,
  onChangeIdx2,
  onChangeIdx3,
  onChangeIdx4,
}: {
  name: string,
  idx1: number,
  idx2: number,
  idx3: number,
  idx4: number,
  onChangeIdx1: (index: number) => void,
  onChangeIdx2: (index: number) => void,
  onChangeIdx3: (index: number) => void,
  onChangeIdx4: (index: number) => void,
}) => {
  const answersSubtitle = () => {
    let result = name.endsWith('s') ? `${name}' ` : `${name}'s `;

    if (idx3 === 1) result += "Values-Related ";
    if (idx3 === 2) result += "Sex-Related ";
    if (idx3 === 3) result += "Interpersonal ";
    if (idx3 === 4) result += "Other ";

    result += "Q&A Answers";

    if (idx2 === 1) result += " Which You Agree With Each Other About";
    if (idx2 === 2) result += " Which You Disagree With Each Other About";
    if (idx2 === 3) result += " Which You Haven't Answered";

    return result
  };

  const analysisSubtitle = () => {
    if (idx4 === 0) return 'MBTI (Myers–Briggs Type Indicator)';
    if (idx4 === 1) return 'Big 5 Personality Traits';
    if (idx4 === 2) return 'Attachment Style';
    if (idx4 === 3) return 'Politics';
    if (idx4 === 4) return 'Other Traits';
  };

  const subtitle = idx1 === 0 ? answersSubtitle() : analysisSubtitle();

  return (
    <>
      <TopNavBar
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 20,
          minHeight: 40,
          height: undefined,
        }}
      >
        <DefaultText
          style={{
            width: '100%',
            paddingLeft: 50,
            paddingRight: 50,
            fontWeight: '700',
            fontSize: 20,
            textAlign: 'center',
          }}
        >
          You + {name}
        </DefaultText>
      </TopNavBar>
      <ButtonGroup
        buttons={['Q&A Answers', 'Personality']}
        selectedIndex={idx1}
        onPress={onChangeIdx1}
        containerStyle={sideMargins}
      />
      {idx1 === 0 && <>
        <ButtonGroup
          buttons={['All', 'Agree', 'Disagree', 'Unanswered']}
          selectedIndex={idx2}
          onPress={onChangeIdx2}
          containerStyle={sideMargins}
          secondary={true}
        />
        <ButtonGroup
          buttons={['All', 'Values', 'Sex', 'Interp.', 'Other']}
          selectedIndex={idx3}
          onPress={onChangeIdx3}
          containerStyle={sideMargins}
          secondary={true}
        />
      </>}
      {idx1 === 1 && <>
        <ButtonGroup
          buttons={['MBTI', 'Big 5', 'Att.', 'Politics', 'Other']}
          selectedIndex={idx4}
          onPress={onChangeIdx4}
          containerStyle={sideMargins}
          secondary={true}
        />
        <ButtonGroup
          buttons={['Invisible']}
          selectedIndex={0}
          onPress={() => undefined}
          containerStyle={{
            ...sideMargins,
            opacity: 0
          }}
          secondary={true}
          disabled={true}
        />
      </>}
      <Subtitle>{subtitle}</Subtitle>
    </>
  );
};

const fetchAnswersPage = (
  personId: number,
  agreement: string,
  topic: string,
) => async (
  pageNumber: number,
): Promise<InDepthListItem[]> => {
  const resultsPerPage = 10;
  const offset = resultsPerPage * (pageNumber - 1);

  const response = await api<CompareAnswer[]>(
    'get',
    `/compare-answers/${personId}` +
    `?topic=${topic}` +
    `&agreement=${agreement}` +
    `&n=${resultsPerPage}` +
    `&o=${offset}`
  );

  const responseList = response.ok ? response.json : [];

  // The store is the live source of truth for the viewer's own answers; the
  // fetched `person_answer`/`person_public_` only seed it
  for (const item of responseList) {
    seedViewerAnswer(item.question_id, {
      answer: item.person_answer,
      public_: item.person_public_ ?? true,
    });
  }

  return responseList.map((item) => ({
    kind: 'answer',
    item: item,
  }));
};

const fetchPersonalityPage = (personId: number, m: number) => async (n: number): Promise<InDepthListItem[]> => {
  const topics = ['mbti', 'big5', 'attachment', 'politics', 'other'] as const;
  const topic = topics[m];

  if (n === 1) {
    const response = await api<TraitData[]>('get', `/compare-personalities/${personId}/${topic}`);

    if (response.json === undefined) return [];

    return [{
      kind: topic,
      data: response.json,
    }];
  }
  return [];
};

const InDepthScreen = (navigationRef: ProspectNavigationRef) => {
  return (props: NativeStackScreenProps<ProspectParamList, 'In-Depth'>) => <CurredInDepthScreen
     navigationRef={navigationRef}
     {...props}
  />;
}

const InDepthAnswer = ({
  personId,
  personUuid,
  photoUuid,
  photoBlurhash,
  item,
}: {
  personId: number,
  personUuid: string | undefined,
  photoUuid: string | null,
  photoBlurhash: string | null,
  item: CompareAnswer,
}) => {
  const [signedInUser] = useSignedInUser();
  const isViewingSelf = personId === signedInUser?.personId;

  const viewerAnswer = useViewerAnswer(item.question_id);

  // When viewing yourself, you're the prospect too, so the prospect column
  // has to track your live answer
  const prospectAnswer =
    isViewingSelf ? viewerAnswer.answer : item.prospect_answer;

  const onPressReply = useNavigationToConversation(
    personUuid ?? '',
    item.prospect_name,
    photoUuid,
    photoBlurhash,
    quizCardQuoteText(item.question, prospectAnswer),
    {
      questionId: item.question_id,
      question: item.question,
      topic: item.topic,
      subjectAnswer: prospectAnswer,
    },
  );

  const canReply = !isViewingSelf && !!personUuid;

  return (
    <AnsweredQuizCard
      questionNumber={item.question_id}
      topic={item.topic}
      user1={item.prospect_name}
      answer1={prospectAnswer}
      user2="You"
      onPressReply={canReply ? onPressReply : undefined}
    >
      {item.question}
    </AnsweredQuizCard>
  );
};

const InDepthItem = ({
  personId,
  personUuid,
  photoUuid,
  photoBlurhash,
  item,
}: {
  personId: number,
  personUuid: string | undefined,
  photoUuid: string | null,
  photoBlurhash: string | null,
  item: InDepthListItem,
}) => {
  switch (item.kind) {
    case 'answer':
      return <InDepthAnswer
        personId={personId}
        personUuid={personUuid}
        photoUuid={photoUuid}
        photoBlurhash={photoBlurhash}
        item={item.item}
      />;
    case 'mbti':
    case 'big5':
    case 'politics':
    case 'attachment':
    case 'other':
      return <Charts data={item.data}/>;
    default:
      return <></>;
  }
};

const InDepthItemMemo = memo(InDepthItem);

const CurredInDepthScreen = ({navigationRef, navigation, route}: NativeStackScreenProps<ProspectParamList, 'In-Depth'> & {
  navigationRef: ProspectNavigationRef,
}) => {
  if (navigationRef)
    navigationRef.current = navigation;

  // Only `personUuid` lives in the URL. Numeric `personId` (used by the
  // `/compare-*` endpoints) and the prospect's display `name` come from the
  // prospect-cache hint that the parent profile screen populates after its
  // own fetch. On a direct deep-link we won't have a hint, so we fall back
  // to fetching `/prospect-profile/:personUuid` here.
  const personUuid: string | undefined = route?.params?.personUuid;
  const initialHint = getProspectHint(personUuid) ?? {};

  const photoUuid = initialHint.photoUuid ?? null;
  const photoBlurhash = initialHint.photoBlurhash ?? null;

  const [personId, setPersonId] = useState<number | undefined>(
    initialHint.personId);
  const [name, setName] = useState<string>(initialHint.name ?? '');
  const [fetchFailed, setFetchFailed] = useState(false);

  useEffect(() => {
    if (!personUuid) return;
    // Re-seed from the (possibly newly populated) hint on every personUuid
    // change. `useState` initializers only run on first mount, so without
    // this we'd briefly show the previous prospect's name/id when the same
    // screen instance is reused with a different uuid.
    const hint = getProspectHint(personUuid) ?? {};
    setPersonId(hint.personId);
    setName(hint.name ?? '');
    setFetchFailed(false);

    // Skip the network round-trip if the hint already has everything we
    // need. The common case is "Prospect Profile -> In-Depth" where the
    // parent screen has just populated the cache with the same fields the
    // `/prospect-profile/:uuid` endpoint would return.
    if (hint.personId !== undefined && hint.name) return;

    let cancelled = false;
    (async () => {
      const response = await api<ProspectProfileResponse>('get', `/prospect-profile/${personUuid}`);
      if (cancelled) return;
      if (!response.ok) {
        setFetchFailed(true);
        return;
      }
      const j = response.json ?? {};
      setPersonId(j.person_id);
      setName(j.name ?? '');
      setFetchFailed(false);
      setProspectHint(personUuid, {
        personId: j.person_id,
        name: j.name,
      });
    })();
    return () => { cancelled = true; };
  }, [personUuid]);

  // Surface the prospect's name in the browser tab. App.tsx's
  // `documentTitle.formatter` reads `options.title` from the focused screen.
  useLayoutEffect(() => {
    navigation.setOptions({
      title: name ? `You + ${name}` : undefined,
    });
  }, [navigation, name]);

  const [idx1, setIdx1] = useState(0);
  const [idx2, setIdx2] = useState(0);
  const [idx3, setIdx3] = useState(0);
  const [idx4, setIdx4] = useState(0);

  const insets = useSafeAreaInsets();

  return (
    <>
      {personId === undefined && !fetchFailed &&
        <View
          style={{
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <LogoActivityIndicator size="large" color="#70f" />
        </View>
      }
      {personId === undefined && fetchFailed &&
        <View
          style={{
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            paddingHorizontal: 20,
          }}
        >
          <DefaultText
            style={{
              fontSize: 16,
              color: '#888',
              textAlign: 'center',
            }}
          >
            Couldn’t load this profile.
          </DefaultText>
        </View>
      }
      {personId !== undefined &&
        <DefaultFlatList
          contentContainerStyle={{
            paddingTop: 0 + insets.top,
            paddingBottom: 20 + insets.bottom,
          }}
          dataKey={
            idx1 === 1 ? `${idx1}-${idx4}` : `${idx1}-${idx2}-${idx3}`}
          emptyText={
            idx1 === 1 ? undefined : "No Q&A answers to show"}
          endText={
            idx1 === 1 ? undefined : "No more Q&A answers to show"}
          fetchPage={
            idx1 === 1 ?
            fetchPersonalityPage(personId, idx4) :
            fetchAnswersPage(
              personId,
              ['all', 'agree', 'disagree', 'unanswered'][idx2],
              ['all', 'values', 'sex', 'interpersonal', 'other'][idx3],
            )
          }
          ListHeaderComponent={
            <Header
              name={name}
              idx1={idx1}
              idx2={idx2}
              idx3={idx3}
              idx4={idx4}
              onChangeIdx1={setIdx1}
              onChangeIdx2={setIdx2}
              onChangeIdx3={setIdx3}
              onChangeIdx4={setIdx4}
            />
          }
          renderItem={({item}) =>
            <InDepthItemMemo
              personId={personId}
              personUuid={personUuid}
              photoUuid={photoUuid}
              photoBlurhash={photoBlurhash}
              item={item}
            />
          }
          disableRefresh={true}
        />
      }
      <View
        style={{
          position: 'absolute',
          top: insets.top,
          height: 0,
          width: '100%',
          maxWidth: 600,
          alignSelf: 'center',
          zIndex: 999,
        }}
      >
        <StatusBarSpacer/>
        <FloatingBackButton navigationRef={navigationRef}/>
      </View>
    </>
  );
};

const Charts = ({data}: {data: TraitData[]}) => {
  return (
    <View style={sideMargins}>
      {data.map((trait) =>
        <Chart
          key={JSON.stringify(trait)}
          dimensionName={trait.trait_min_label ? undefined : trait.trait_name}
          minLabel={trait.trait_min_label}
          maxLabel={trait.trait_max_label}
          name1={trait.prospect_name ?? undefined}
          percentage1={trait.prospect_percentage ?? undefined}
          name2="You"
          percentage2={trait.person_percentage ?? undefined}
        >
          {trait.trait_description}
        </Chart>
      )}
    </View>
  );
};

export {
  InDepthScreen,
};
