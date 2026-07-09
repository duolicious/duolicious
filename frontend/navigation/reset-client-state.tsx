import { resetOptionScreenPayloads } from './option-screen-store';
import { resetProspectHints } from './prospect-cache';
import { resetSearchFilterAnswers } from './search-filter-state';
import { resetProfileInfo } from '../events/profile-info';
import { resetSearchFilters } from '../events/search-filters';
import { resetViewerAnswers } from '../api/answer';

// Drop every piece of in-memory, user-scoped client state. Call this from
// any path that signs the user out (explicit sign-out, account deletion,
// account deactivation, server-side session invalidation) so a subsequent
// sign-in by a different user on the same browser tab doesn't inherit the
// previous user's optimistic-render hints, queued wizard payloads, or saved
// search filters.
//
// This intentionally only touches in-process state; persisted KV (session
// token, cached themes, etc.) is the responsibility of the caller, since
// what to clear there depends on whether the sign-out is by user choice or
// by hard failure (e.g. revoked session) and which keys are user-scoped vs
// device-scoped.
export const resetUserScopedClientState = () => {
  resetProspectHints();
  resetSearchFilterAnswers();
  resetOptionScreenPayloads();
  resetProfileInfo();
  resetSearchFilters();
  resetViewerAnswers();
};
