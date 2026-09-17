import { markSearchResultsStale } from './stale-search-results';
import { storeKv } from '../kv-storage/kv-storage';

type AnonymousAnswer = {
  question_id: number
  answer: boolean | null
  public: boolean
};

const anonymousAnswers: AnonymousAnswer[] = [];

const onAnonymousAnswersChanged = (): void => {
  markSearchResultsStale();
  storeKv(
    'anonymous_answers',
    anonymousAnswers.length ? JSON.stringify(anonymousAnswers) : null,
  );
};

const loadAnonymousAnswers = async (): Promise<void> => {
  const raw = await storeKv('anonymous_answers');
  if (!raw) {
    return;
  }
  try {
    anonymousAnswers.splice(0, anonymousAnswers.length, ...JSON.parse(raw));
  } catch {
    anonymousAnswers.length = 0;
  }
};

const addAnonymousAnswer = (answer: AnonymousAnswer): void => {
  removeAnonymousAnswer(answer.question_id);
  anonymousAnswers.push(answer);
  onAnonymousAnswersChanged();
};

const removeAnonymousAnswer = (questionId: number): void => {
  const i = anonymousAnswers.findIndex(a => a.question_id === questionId);
  if (i !== -1) {
    anonymousAnswers.splice(i, 1);
    onAnonymousAnswersChanged();
  }
};

const clearAnonymousAnswers = (): void => {
  anonymousAnswers.length = 0;
  onAnonymousAnswersChanged();
};

const encodedAnonymousAnswers = (): string | null =>
  anonymousAnswers.length
    ? encodeURIComponent(JSON.stringify(anonymousAnswers))
    : null;

export {
  AnonymousAnswer,
  anonymousAnswers,
  encodedAnonymousAnswers,
  addAnonymousAnswer,
  removeAnonymousAnswer,
  clearAnonymousAnswers,
  loadAnonymousAnswers,
};
