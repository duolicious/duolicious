// The only place that's allowed to write Q&A answers to the server. Answering
// a question re-ranks search results and match percentages, so every write
// must flag the cached search results and inbox as stale; every write must
// also go through `answerWriteQueue`, or two writes in short succession could land
// on the server out of order; and every surface that renders the viewer's
// answer must hear about the write, or it drifts from the ones that do.
// Routing all writes through here makes all three impossible to forget.
//
// This module is also the store for what the viewer has answered, keyed by
// question. `saveAnswer` and `deleteAnswer` update it optimistically, before
// their writes land.

import { useLayoutEffect, useState } from 'react';
import { japi } from './api';
import { answerWriteQueue } from './queue';
import { markSearchResultsStale } from '../events/stale-search-results';
import { markInboxStale } from '../events/stale-inbox';
import { notify, listen, lastEvent } from '../events/events';

type ViewerAnswer = {
  answer: boolean | null
  public_: boolean
};

const unansweredViewerAnswer: ViewerAnswer = {
  answer: null,
  public_: true,
};

const viewerAnswerKey = (questionId: number) =>
  `viewer-answer-${questionId}`;

// Which questions have store entries, so sign-out can clear them all
const storedQuestionIds = new Set<number>();

const getViewerAnswer = (questionId: number): ViewerAnswer =>
  lastEvent<ViewerAnswer>(viewerAnswerKey(questionId))
    ?? unansweredViewerAnswer;

// Updates what the viewer sees without writing to the server, e.g. for
// settings (like publicness) that don't mean anything until there's an answer
const setViewerAnswerLocally = (questionId: number, state: ViewerAnswer) => {
  storedQuestionIds.add(questionId);
  notify<ViewerAnswer>(viewerAnswerKey(questionId), state);
};

// Adopts server-sent state, but never clobbers what the viewer did in this
// session; the store hears about every write, so it's fresher than any fetch
const seedViewerAnswer = (questionId: number, state: ViewerAnswer) => {
  if (lastEvent(viewerAnswerKey(questionId)) === undefined) {
    setViewerAnswerLocally(questionId, state);
  }
};

// Sign-out must call this so a subsequent sign-in by a different user on the
// same browser tab doesn't inherit (and, via `seedViewerAnswer`, keep) the
// previous user's answers
const resetViewerAnswers = () => {
  for (const questionId of storedQuestionIds) {
    notify(viewerAnswerKey(questionId), undefined);
  }
  storedQuestionIds.clear();
};

const useViewerAnswer = (questionId: number): ViewerAnswer => {
  const [value, setValue] = useState(() => getViewerAnswer(questionId));

  useLayoutEffect(() => {
    // Re-read on every (re)subscription: `questionId` may have changed since
    // the useState initializer ran, and a write may have landed since render
    setValue(getViewerAnswer(questionId));

    return listen(
      viewerAnswerKey(questionId),
      () => setValue(getViewerAnswer(questionId)),
    );
  }, [questionId]);

  return value;
};

const saveAnswer = (
  questionId: number,
  answer: boolean | null | undefined,
  answerPublicly: boolean,
): Promise<void> => {
  setViewerAnswerLocally(
    questionId,
    { answer: answer ?? null, public_: answerPublicly },
  );

  return answerWriteQueue.addTask(async () => {
    await japi('post', '/answer', {
      question_id: questionId,
      answer: answer,
      public: answerPublicly,
    });

    markSearchResultsStale();
    markInboxStale();
  });
};

const deleteAnswer = (questionId: number): Promise<void> => {
  setViewerAnswerLocally(questionId, unansweredViewerAnswer);

  return answerWriteQueue.addTask(async () => {
    await japi('delete', '/answer', { question_id: questionId });

    markSearchResultsStale();
    markInboxStale();
  });
};

const nextAnswer = (curAnswer: boolean | null, pressedButton?: boolean) => {
  if (pressedButton === undefined) {
    if (curAnswer === true) return false;
    if (curAnswer === false) return null;
    return true;
  } else {
    if (curAnswer === pressedButton) {
      return null;
    } else {
      return pressedButton;
    }
  }
};

// The viewer pressed a yes/no button: select that answer, or deselect (skip)
// if it was already selected
const toggleAnswer = (
  questionId: number,
  pressedButton: boolean,
): Promise<void> => {
  const current = getViewerAnswer(questionId);

  return saveAnswer(
    questionId,
    nextAnswer(current.answer, pressedButton),
    current.public_,
  );
};

const setAnswerPublicly = (
  questionId: number,
  public_: boolean,
): Promise<void> => {
  const current = getViewerAnswer(questionId);

  if (current.answer === null) {
    // There's no answer to write yet; the choice still has to be remembered
    // for when they answer
    setViewerAnswerLocally(questionId, { ...current, public_ });
    return Promise.resolve();
  }

  return saveAnswer(questionId, current.answer, public_);
};

export {
  ViewerAnswer,
  deleteAnswer,
  nextAnswer,
  resetViewerAnswers,
  saveAnswer,
  seedViewerAnswer,
  setAnswerPublicly,
  toggleAnswer,
  useViewerAnswer,
};
