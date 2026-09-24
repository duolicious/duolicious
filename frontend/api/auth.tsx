import { ApiResponse } from './api';
import { navigateAfterAuth } from '../navigation/navigate-after-auth';
import { login } from '../chat/application-layer';
import { setSignedInUser } from '../events/signed-in-user';
import { sessionPersonUuid } from '../kv-storage/session-token';
import { clearAnonymousAnswers } from '../events/anonymous-answers';
import { notify } from '../events/events';
import { ClubItem } from '../club/club';

export type AuthResult =
  | 'rejected'         // the request failed; nothing was applied
  | 'signed-in'        // an onboarded user is now fully signed in
  | 'needs-onboarding' // a new user still has to complete onboarding

// The (snake_case) response body shared by `/check-otp`,
// `/sign-in-with-google`, `/sign-in-with-apple`, and `/sign-in-with-discord`.
type AuthenticatedResponse = {
  onboarded: boolean;
  person_id: number;
  person_uuid: string;
  units: string;
  clubs: ClubItem[];
  pending_club: ClubItem | null;
  estimated_end_date: string;
  name: string | null;
  has_gold: boolean;
  session_token?: string;
};

export const applyAuthenticatedResponse = async (
  response: ApiResponse,
  existingSessionToken: string,
  { onboardingComplete = false, preserveLocation = true }: {
    onboardingComplete?: boolean,
    preserveLocation?: boolean,
  } = {},
): Promise<AuthResult> => {
  if (!response.ok) {
    return 'rejected';
  }

  const json = response.json as AuthenticatedResponse;
  const onboarded = onboardingComplete || json.onboarded;
  const clubs = json.clubs;
  const pendingClub = json.pending_club;
  const personUuid = json.person_uuid;

  if (!onboarded) {
    return 'needs-onboarding';
  }

  navigateAfterAuth(pendingClub, { preserveLocation });

  login(personUuid, existingSessionToken);

  setSignedInUser({
    personId: json.person_id,
    personUuid: personUuid,
    units: json.units === 'Imperial' ? 'Imperial' : 'Metric',
    sessionToken: existingSessionToken,
    pendingClub: pendingClub,
    estimatedEndDate: new Date(json.estimated_end_date),
    name: json.name,
    hasGold: json.has_gold,
  });

  await sessionPersonUuid(personUuid);

  // The server already received these with `/request-otp`; clear the local
  // copy now that the user is signed in.
  clearAnonymousAnswers();

  notify<ClubItem[]>('updated-clubs', clubs);

  return 'signed-in';
};
