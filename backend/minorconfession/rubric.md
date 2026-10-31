# Labelling rubric: does the sender indicate they are under 18?

Duolicious is a dating app for adults (18+). We are building a child-safety
filter that spots members who reveal, in their own messages, that they are
probably under 18, so that moderators can check their account. Reports go to
human moderators, who make the final decision.

Each item shows one TARGET message written by ME (the member being assessed),
the messages just BEFORE and AFTER it in the same conversation (ME is that
member, THEM is the person they're talking to), the age ME claims on their
profile at the time, and ME's profile self-summary.

Decide, using everything shown, whether the TARGET message (read in its
context) is ME indicating that ME is currently under 18.

## Labels

- `yes`: the TARGET message, in context, clearly or strongly indicates ME is
  under 18 right now. Examples of the kind of thing that counts (they are
  invented, not real):
  - stating an age under 18: "im 16", "I'm only 17", "15 lol" as an answer
    to "how old are you?" (the answer may be in the TARGET while the question
    is in BEFORE)
  - "I'm not 18", "I'm not 18 yet", "I'm a minor", "I'm underage"
  - "I'm too young for this site", "I'm younger than my profile says",
    "I put a fake birthday", "I lied about my age to sign up"
  - "I got banned before because of my age", "they banned me for being
    underage" (even if ME now claims to be 18)
  - "I'm a junior in high school", "I'm in 10th grade", "I'm in year 11",
    "I'm doing my GCSEs" (with nothing suggesting ME is an adult, such as a
    teacher or a parent)
  - "I turn 18 in March" when that birthday is still in the future
  - multi-message admissions where TARGET completes it (THEM: "wait how old
    are you really" / ME: "younger than it says")
- `maybe`: a real but weak or ambiguous signal that ME might be under 18,
  worth a moderator's look but not clear. Examples: "my mom took my phone
  until Friday" plus other childlike signals; "I can't, I have school
  tomorrow and my parents check my phone" from someone claiming 18;
  "I'm basically a kid" when it might be literal; evasive answers to age
  questions ("does it matter", "guess") that THEM reads as underage.
- `no`: anything else. In particular:
  - ages from the past: "when I was 16", "14 year old me", "I've been doing
    this since I was 13"
  - other people's ages: "my brother is 15", "she's 17", "my 16 year old"
  - adults mentioning school as adults: university, college, teachers,
    parents of school children, "back in high school"
  - jokes that clearly aren't literal: "I'm 12 mentally", "my humour is that
    of a 13 year old", "I'm a minor inconvenience"
  - numbers that aren't ages: "17 minutes", "top 15", "16 messages"
  - ME saying they're over 18, or asking THEM about THEIR age
  - THEM saying ME seems young, when ME doesn't agree or confirm it

Judge ME, not THEM. If only THEM reveals being under 18, label `no` (that
member is assessed when their own messages are labelled).

## Kind

For `yes` and `maybe`, also give the kind of signal (one of):
`stated_age`, `minor_status` (minor/underage/not 18), `school_year`,
`age_question_answer`, `younger_than_profile`, `banned_for_age`,
`birthday_countdown`, `implied` (parents/school/curfew etc.), `other`.
For `no`, use `none`.

## Content you must skip

Items were filtered to exclude sexual content. If an item nevertheless
contains sexual content involving ME or THEM, label it `skip` with kind
`none` and move on without describing it.
