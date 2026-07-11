// The store for what a conversation partner has publicly answered, keyed by
// person and question. Values arrive from the server: seeded from card
// attributes on fetched/received messages, then kept fresh by
// `duo_answer_update` events on the channel joined via the online-status
// subscription. `null` means hidden or unanswered -- the server never sends
// private state.

import { listen, lastEvent, notify } from '../../../events/events';
import { useRetained } from '../../../events/use-retained';
import { EV_CHAT_WS_RECEIVE } from '../../websocket-layer';
import { seedViewerAnswer } from '../../../api/answer';

const eventKey = (personUuid: string, questionId: number) =>
  `partner-answer-${personUuid}-${questionId}`;

const answerFromWire = (answer: unknown): boolean | null => {
  if (answer === 'yes') return true;
  if (answer === 'no') return false;
  return null;
};

const setPartnerAnswer = (
  personUuid: string,
  questionId: number,
  answer: boolean | null,
) => {
  notify<boolean | null>(eventKey(personUuid, questionId), answer);
};

// Set-if-absent, for the send path: the feed item's copy of the partner's
// answer shows the card immediately, but must never clobber a fresher value
// from the server
const seedPartnerAnswer = (
  personUuid: string,
  questionId: number,
  answer: boolean | null,
) => {
  if (lastEvent(eventKey(personUuid, questionId)) === undefined) {
    setPartnerAnswer(personUuid, questionId, answer);
  }
};

type CardAttributes = {
  '@question_id'?: unknown
  '@viewer_answer'?: unknown
  '@viewer_answer_public'?: unknown
  '@partner_answer'?: unknown
};

// The single place server-sent card state on a message enters the client
// stores. The partner's answer is authoritative (the server computed it just
// now); the viewer's own answer only seeds their store, which is fresher than
// any fetch once they've written in this session.
const ingestCardAttributes = (
  partnerUuid: string,
  attrs: CardAttributes,
): void => {
  const questionId = Number(attrs['@question_id']);

  if (!questionId) {
    return;
  }

  setPartnerAnswer(
    partnerUuid,
    questionId,
    answerFromWire(attrs['@partner_answer']),
  );

  seedViewerAnswer(questionId, {
    answer: answerFromWire(attrs['@viewer_answer']),
    public_: attrs['@viewer_answer_public'] !== 'false',
  });
};

const usePartnerAnswer = (
  personUuid: string,
  questionId: number | undefined,
): boolean | null =>
  useRetained<boolean>(
    questionId === undefined ? undefined : eventKey(personUuid, questionId));

const onReceiveAnswerUpdate = (doc: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const update = doc?.duo_answer_update;

  if (!update) {
    return;
  }

  const personUuid = update['@uuid'];
  const questionId = Number(update['@question_id']);

  if (!personUuid || !questionId) {
    return;
  }

  setPartnerAnswer(personUuid, questionId, answerFromWire(update['@answer']));
};

listen(EV_CHAT_WS_RECEIVE, onReceiveAnswerUpdate);

export {
  ingestCardAttributes,
  seedPartnerAnswer,
  usePartnerAnswer,
};
