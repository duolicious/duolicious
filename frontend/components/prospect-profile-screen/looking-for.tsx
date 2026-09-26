// Logic for the read-only "Looking For" section shown on profiles. Kept as a
// standalone module (no React/JSX) so it can be unit tested in isolation.

// The subset of a profile's data needed to build the "Looking For" section.
// `UserData` (in prospect-profile-screen.tsx) structurally satisfies this.
type LookingForData = {
  gender_preference?: string[] | null,
  age_preference?: { min_age: number | null, max_age: number | null } | null,
  looking_for?: string | null,
  long_distance?: string | null,
};

// Plural noun phrases for each gender, used to build the "Looking For"
// description (e.g. "Women ..."). Keep in sync with the gender list in
// `data/option-groups.tsx`.
const GENDER_PLURALS: { [key: string]: string } = {
  'Man': 'men',
  'Woman': 'women',
  'Agender': 'agender people',
  'Femboy': 'femboys',
  'Intersex': 'intersex people',
  'Non-binary': 'non-binary people',
  'Transgender': 'transgender people',
  'Trans woman': 'trans women',
  'Trans man': 'trans men',
  'Other': 'people of other genders',
};

const TOTAL_GENDER_COUNT = Object.keys(GENDER_PLURALS).length;

// Emoji shown beside the "Looking For" section, chosen by relationship goal so
// the section reads at a glance instead of as a wall of text.
const LOOKING_FOR_EMOJI: { [key: string]: string } = {
  'Friends': '👋',
  'Short-term dating': '🥂',
  'Long-term dating': '💘',
  'Marriage': '💍',
};

const DEFAULT_LOOKING_FOR_EMOJI = '💞';

const lookingForEmoji = (data?: LookingForData | null): string => {
  const goal = data?.looking_for;
  return (goal && LOOKING_FOR_EMOJI[goal]) || DEFAULT_LOOKING_FOR_EMOJI;
};

const joinWithAnd = (items: string[]): string => {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
};

// The subject of the "Looking For" sentence, without a leading verb, e.g.
// "women aged 18–99 for short-term dating".
const lookingForSubject = (data: LookingForData): string => {
  const genderPref = data.gender_preference ?? [];

  // An "accept all" preference (the signup default) reads better as "people"
  // than an exhaustive list of every gender.
  const wantsEveryGender =
    genderPref.length === 0 || genderPref.length >= TOTAL_GENDER_COUNT;

  const peopleText = wantsEveryGender
    ? 'people'
    : joinWithAnd(genderPref.map((g) => GENDER_PLURALS[g] ?? g.toLowerCase()));

  // The age slider runs 18–99; a `null` bound (or one sitting at either
  // extreme) means that end is unbounded. A full 18–99 range says nothing, so
  // the age clause is dropped and only shown when it actually narrows things.
  const minAge = data.age_preference?.min_age ?? 18;
  const maxAge = data.age_preference?.max_age ?? 99;
  const hasMin = minAge > 18;
  const hasMax = maxAge < 99;

  let ageText = '';
  if (hasMin && hasMax) {
    ageText = `aged ${minAge}\u2013${maxAge}`;
  } else if (hasMin) {
    ageText = `aged ${minAge}+`;
  } else if (hasMax) {
    ageText = `aged up to ${maxAge}`;
  }

  const goal = data.looking_for ? data.looking_for.toLowerCase() : '';

  // "people for friends" reads awkwardly when no gender or age narrows the
  // search; collapse it to just the goal, e.g. "friends".
  if (wantsEveryGender && !ageText && goal) {
    return goal;
  }

  // With nothing at all to narrow the search, a bare "people" reads as a
  // shrug; "all kinds of people" frames the openness as a positive instead.
  if (wantsEveryGender && !ageText && !goal) {
    return 'all kinds of people';
  }

  const goalText = goal ? `for ${goal}` : '';

  return [peopleText, ageText, goalText].filter(Boolean).join(' ');
};

const describeLongDistance = (data: LookingForData): string | null => {
  if (data.long_distance === 'Yes') return 'open to long distance';
  if (data.long_distance === 'No') return 'not open to long distance';
  return null;
};

// The descriptive text shown inside the "Looking For" card, e.g.
// "women aged 18–99 for short-term dating, open to long distance". Rendered as
// a lower-case fragment with no trailing period: the leading "Looking for" is
// already the section title, so the text reads as its value.
const lookingForDescription = (data: LookingForData): string => {
  const subject = lookingForSubject(data);
  const longDistance = describeLongDistance(data);
  return longDistance ? `${subject}, ${longDistance}` : subject;
};

export {
  LookingForData,
  describeLongDistance,
  lookingForDescription,
  lookingForEmoji,
};
