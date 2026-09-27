import { japi } from '../api/api';
import { listen, notify } from '../events/events';
import { delay } from '../util/util';

type VerificationStatus =
  | 'uploading-photo'
  | 'enqueued'
  | 'running'
  | 'success'
  | 'failure';

type VerificationEvent = {
  photos?: {
    [position: string]: boolean
  }
  gender?: boolean
  age?: boolean
  ethnicity?: boolean
  status?: VerificationStatus
  message?: string
};

type GetVerificationResponse = {
  status?: VerificationStatus
  message?: string
  verified_photos?: {
    [position: string]: boolean
  }
  verified_gender?: boolean
  verified_age?: boolean
  verified_ethnicity?: boolean
};

const EV_UPDATED_VERIFICATION = 'updated-verification';

const notifyUpdatedVerification = (e: VerificationEvent) => {
  notify<VerificationEvent>(EV_UPDATED_VERIFICATION, e);
};

const listenUpdatedVerification = (f: (e: VerificationEvent) => void) => {
  listen<VerificationEvent>(EV_UPDATED_VERIFICATION, f);
};

const verificationWatcher = async () => {
  let checkUntil = null as null | Date;
  let lastStatus = '';

  listen(
    'watch-verification',
    () => {
      checkUntil = new Date(Date.now() + 60 * 1000); // A minute from now
      lastStatus = '';
    },
  );

  while (true) {
    await delay(1000);

    if (checkUntil === null) {
      continue;
    }

    const isTimeReached = new Date() > checkUntil;
    const isDone = ['success', 'failure'].includes(lastStatus);

    if (isTimeReached && !isDone) {
      notifyUpdatedVerification({
        status: 'failure',
        message: 'Verification took too long. Try again later.',
      });

      lastStatus = 'failure';
    }

    if (isTimeReached) {
      continue;
    }

    if (isDone) {
      continue;
    }

    const response = await japi<GetVerificationResponse>('get', '/check-verification');

    if (!response.ok || !response.json) {
      console.error('Verification response not ok:', response);
      continue;
    }

    notifyUpdatedVerification({
      status: response.json.status,
      message: response.json.message,
      photos: response.json.verified_photos,
      gender: response.json.verified_gender,
      age: response.json.verified_age,
      ethnicity: response.json.verified_ethnicity,
    });

    lastStatus = response.json.status ?? '';
  }
};

export {
  VerificationEvent,
  VerificationStatus,
  listenUpdatedVerification,
  notifyUpdatedVerification,
  verificationWatcher,
};
