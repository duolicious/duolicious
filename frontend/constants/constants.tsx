const ONLINE_COLOR = '#23a55a';

// People who signed up before this person id keep the legacy search filter
// screen, whose "Basics" section is split into two-way and other filters.
// Mirrored by a same-named constant in the backend, where searches by people
// past the cutoff ignore prospects' two-way preferences.
const FIRST_ONE_WAY_FILTER_PERSON_ID = 369300;

export {
  FIRST_ONE_WAY_FILTER_PERSON_ID,
  ONLINE_COLOR,
};
