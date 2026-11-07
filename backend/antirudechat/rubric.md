# Labelling rubric

Every message in `train.jsonl` and in the benchmarks in
`serviceshared/antiabuse/antirude/chat` is labelled by this rubric.
Duolicious members are mostly young adults with nerdy interests
(games, anime, internet culture). Every message is an **intro**: a
message from a stranger whom the recipient has never replied to. Intros the
classifier calls rude are silently moved into a "Hidden intros" folder, which
the recipient can still open. Most recipients of rude intros are young women.

The goal is to hide intros the recipient is likely to be offended by, so that
getting intros stays a good experience. It isn't to enforce ideals about
proper speech. Many members come from imageboards like 4chan, where in-jokes
and slang that would offend outsiders often signal belonging, and those are
fine when the recipient would most likely take them as friendly ("heyyy
fellow foid", "sorry anon, I'm a newfag kek").

Judge each message on its own, as the recipient would see it. You know nothing
about the sender or the recipient beyond the message text. The question is
always how the recipient would most likely take it: a message they would
likely be offended by is `rude`, and one they would most likely take as
friendly, joking or harmless is `ok`.

## Labels

- `rude`: should be hidden.
- `ok`: should be shown.
- `unsure`: reasonable moderators would disagree, or the meaning can't be
  worked out from the text. These messages are left out of both files, so a
  wrong confident label is worse than `unsure`.

## Quotes of the recipient's profile

Replies to a profile embed the quoted profile text as a markdown blockquote
followed by an attribution line, then the sender's reply:

```
>quoted text from the recipient's profile
>- RecipientName
the sender's own reply
```

The quoted lines (starting with `>`) up to and including the `>- Name` line were
written by the recipient. **Ignore them when deciding**: they can't offend the
recipient, who wrote them. Judge only the sender's own words. A blockquote
without a `>- Name` attribution line is usually the sender's own greentext and
counts as the sender's words.

Likewise, words the sender quotes or repeats from the recipient's profile
("your bio says 'msg me to goon'", "what does 'healslut' mean?") don't make a
message rude by themselves. A neutral comment or question about something the
recipient wrote is `ok` even when the topic is sexual ("is it hard to find
people who share your kink?"). But the sender's own sexual propositions,
sexual remarks about the recipient, and hostile slurs, insults and threats
are `rude` whatever the profile says. One exception: when a quote shows the
recipient explicitly asking for exactly this kind of message (the quote says
"msg me to goon" and the reply offers to goon together), use `unsure`.

Without a quote, "you said" or "your bio", don't guess that a sexual question
or remark is echoing the profile: judge it as written.

## Rude

1. **Sexual**: sexual propositions or requests ("wanna fuck", "send nudes",
   "can I see your feet"), descriptions of sex acts, sexual remarks about the
   recipient's body ("nice tits", "that ass", "your thighs are crushing me"),
   talk about the sender's genitals ("my 8 inches"), masturbation or gooning
   talk ("I'm gooning to your pics", "can I goon to you"), kink or fetish talk
   aimed at the recipient ("be my sub", "I want to choke you", "I'd love to
   use you"), breeding or impregnation talk, sexual roleplay, porn links or
   requests for porn. Euphemisms, innuendo whose sexual meaning is plain,
   emoji (🍆 💦 🍑 👅 used sexually), misspellings and self-censoring count
   exactly like the plain words: "s3x", "c*ck", "d1ck", "seggs", "corn" for
   porn, "ra pe", "a$$", "goo n", "slide on it", "match my freak", "rail you",
   "back shots", "breedable", "ruin you" (sexual), "netflix and chill" (as a
   proposition). Short questions count when their sexual meaning is plain:
   "how big is it?", "do they jiggle?", "do you send?", "what's your cup
   size?", "body count?". So does treating the recipient as a seller of
   sexual content or offering to pay for it: "what's your menu?", "do you
   sell?", "do you do customs?", "are you on onlyfans/fansly/throne?",
   "cashapp?", sugar daddy offers, "findom", "pay pig". A bare "do you do
   commissions?" counts as asking for paid content; asking about non-sexual
   work the recipient plainly does ("your art is so clean, do you take
   commissions?") is `ok`.
2. **Slur**: racial, ethnic, homophobic, transphobic or misogynistic slurs
   used against the recipient or a group they may belong to, in a way they
   would likely take as hostile or degrading, including deliberate
   misspellings and imageboard coinages ("nigger", "n1gger", "groid",
   "chink", "jeet", "kike", "tranny", "troon", "fag", "foid", "roastie",
   "trap" for a person); Nazi and antisemitic codes ("1488", "heil hitler",
   "(((them)))", "day of the rope"); dehumanising statements about a group.
   The same words used as an in-joke, a self-description or friendly banter
   that the recipient would most likely take well are `ok` ("heyyy fellow
   foid", "we're both autistic lol", "only if u are a cute foid 🥹"). Praise
   of Nazis, Hitler or genocide stays `rude` even as a self-description
   ("aryanpilled", "hitlercel").
   Ableist words ("retarded", "tard", "sperg", "autist") follow the same
   rule: `rude` when aimed at the recipient as an insult, `ok` when casual
   or self-directed ("I might be retarded but...").
3. **Insult**: name-calling or degrading remarks aimed at the recipient ("you
   whore", "dumb slut", "hi bitch", "are you retarded"), body shaming, mocking
   the recipient's gender identity ("you'll never be a woman"), accusing the
   recipient of being a pedophile. Insults are often creative ("you look like
   you lost a fight with a blender", "subhuman", "failed abortion"), and those
   count too. Transphobic insults include questioning whether the recipient
   is a "real" woman or man, demanding to see their hands, voice or Adam's
   apple to "clock" them, "post hands", "failed male", "man in a dress",
   "AGP", "dilate", calling them mentally ill or mutilated for being trans,
   and "41%" or "join the 41%" (a jab about trans suicide rates, which is also
   self-harm encouragement). Profiles show the share of intros a member
   replies to, so "41%" about a reply rate is `ok`. Imageboard insults count
   when they put the recipient down ("cope and seethe", "ngmi", "midwit",
   "soyboy", "cuck", "hon", "clocky", "used goods", "hit the wall"), but not
   as friendly banter. Some remarks that are harmless between friends are
   offensive as a stranger's first message: pointing out or questioning the
   recipient's ethnicity, religion, race, body or gender ("you're jewish",
   "are you black?", "you look like a man", "where are you really from?", "ni
   hao" out of nowhere), fetishising it ("I've never been with an asian girl",
   "yellow fever") or backhanded compliments ("pretty for a black girl"). A
   question about identity that the sender plainly offers as common ground
   ("are you jewish too? I'd love to meet someone from my community") is `ok`,
   and so is asking about faith as compatibility ("are you religious?", "are
   you catholic?", "is faith important to you?").
4. **Violence**: threats or violent fantasies about the recipient ("I'll stab
   you", "let me cut you up", "you just need to be beaten"), even as a joke,
   and praise of mass shooters or massacres ("supreme gentleman", "going ER",
   "saint tarrant").
5. **Self-harm**: telling the recipient to kill or hurt themselves, however
   it's phrased ("kys", "k y s", "kill urself", "off yourself", "end your
   life", "unalive yourself", "commit die", "commit sudoku", "rope", "neck
   yourself", "go jump off a bridge", "jump in front of a train", "walk into
   traffic", "drink bleach", "sewerslide", "an hero", "do us all a favour",
   "nobody would miss you", "the world would be better without you", "cut
   deeper"), or wishing them dead ("hope you die", "hope you get hit by a
   bus"), even as a joke, or sincere statements that the sender will kill or
   harm themselves. Encouraging an eating disorder counts too ("wanna be my
   ana buddy?", "send meanspo", "we can starve together"). Telling someone
   not to hurt themselves ("don't kys, you're too cute") is `ok`, but a
   "don't" that still pushes them toward it ("why don't you just kill
   yourself", "don't kys yet, send me your money first") is `rude`.
6. **Other**: sexualising minors (loli, shota, cunny), or anything else that
   is clearly as upsetting as the categories above.

## Ok

- Casual swearing that most adults find inoffensive in casual conversation and
  that isn't an insult aimed at the recipient: "holy shit you're pretty", "what
  the fuck, you live near me", "this game is ass", "boring ass movie", "damn",
  "hell yeah", "fuck yeah", "badass", "I'm a little bitch about horror games"
  (self-deprecating), "life's a bitch". In-group and imageboard slang
  ("newfag", "foid", "autist", "kek") is casual swearing when it's friendly,
  joking or self-deprecating ("sorry anon, I'm a newfag kek"), and an insult
  when it puts the recipient down ("fuck off, newfag").
- Compliments and mild flirting without sexual content: "you're cute",
  "you're gorgeous", "you're hot", "love your eyes", "your smile is lovely",
  "can I take you on a date", "I want to cuddle", "I want to kiss you".
- Talking about sexuality, mental health or dark topics without propositioning
  or attacking the recipient: "I'm asexual too", "I've been in a psych ward
  too", "true crime podcasts about murders are my thing". Abstract or joking
  questions about a sexual topic are `ok` when they don't describe sex acts,
  don't concern the recipient's body or sex life and don't propose anything
  ("is gooning a real hobby or a meme?"). The sender describing their own
  arousal, genitals or masturbation is `rude`.
- "Gooner" can also mean an Arsenal football fan; when nothing else in the
  message is sexual, use `unsure` rather than guessing.
- Hyperbolic jokes that are clearly not about real self-harm or violence: "this
  intro took me so long I'm gonna kms lol", "I'll fight you over pineapple
  pizza".
- Words that only look like rude words: "Essex", "maine coon", "Ho Chi Minh",
  Italian "ho" (I have), "Pussy Riot" (the band), "cut me some slack",
  "therapist", "Scunthorpe", "cocktail", "analysis", "dominate the game".
- Messages in other languages follow the same rules: "caralho" or "puta madre"
  as casual swearing are `ok`; "puta" aimed at the recipient is `rude`.
- Ordinary questions that share words with the coded ones: "do you send
  memes?", "what's on the menu at your café?", "are you on steam?", "how big
  is your cat?".
- Links: judge a GIF or video link by the words in its URL. If the words don't
  say what it shows, use `ok` unless they suggest sexual content.

## Borderline guidance

- "sexy", "hot", "daddy", "mommy" and "kinky" are not rude by themselves. They
  are rude when they are part of a sexual proposition or a sexual remark about
  the recipient ("mommy can you sit on me", "be my kinky slut").
- Body parts: comments about the face, eyes, hair, smile, hands or style are
  `ok`. Comments that sexualise the chest, butt, thighs, feet, lips or
  genitals are `rude`. Pure compliments on lips or legs with no sexual angle
  ("your lipstick is a great colour") are `ok`.
- Unsolicited fetish questions to a stranger ("do you have a foot fetish?",
  "are you into choking?") are `rude` unless they plainly ask about something
  the recipient wrote ("you said you're into choking, is that a joke?" is
  `ok`).
- When a message is mostly fine but contains one clearly rude element, it is
  `rude`.

## Paraphrasing

The originals are private messages between real people, so the corpus holds
paraphrases, never the originals. A good paraphrase is a message a different
person could plausibly have sent that the classifier should treat exactly like
the original.

For each message, write a paraphrase that:

1. **Has the same label for the same reason** under the rubric. A rude message
   stays rude in the same category. An ok message stays ok, and if it was a
   hard case (casual swearing, a word that only looks rude, a quote of a rude
   profile, a non-sexual compliment about the body) it stays a hard case of the
   same kind.
2. **Keeps the words that decide the label exactly as spelled**: rude or
   borderline terms, misspellings, leetspeak, self-censoring (asterisks, dots,
   spaces inside words, symbols), emoji, slang and euphemisms. Rewrite
   everything else in different words. Apart from those deciding words, no run
   of more than four consecutive words may match the original.
3. **Keeps the style**: same language, register, rough length, capitalisation,
   punctuation and texting quirks ("ur", "u", stretched letters, no
   punctuation, run-on sentences, typos).
4. **Keeps the structure**: a quote block (lines starting with `>` ending in a
   `>- Name` attribution) stays a quote block in the same position. Rewrite the
   quoted text as well, keeping any rude or borderline words it had, and use a
   different made-up display name in the attribution. Greentext without an
   attribution stays greentext.
5. **Removes anything that could identify a person**: replace names with
   different common names, including a word or phrase used as someone's name
   ("hey Bumblebee", a pun on their name) even when it's an ordinary word or a
   character's name; usernames and handles (Discord, Instagram, X,
   Telegram, Snapchat and so on) with invented ones; phone numbers with
   fictional ones (`+1 555-01xx`) and email addresses with ones at
   `example.com`; towns, schools, workplaces and other specific
   places with different ones of the same kind; specific dates and ages with
   nearby values. Replace links with invented links of the same kind: a GIF
   link stays a link on the same GIF host with a different id but the same
   descriptive words in its file name; other links get an invented path.
   Don't change the names of well-known public figures, games, shows, bands or
   brands when the label depends on them.

Leave a message out instead when:

- the message sexualises minors, describes a way to kill or harm oneself,
  encourages or wishes self-harm or suicide on anyone, or threatens sexual
  violence or uses it as an insult, or
- you can't write a paraphrase that satisfies the rules above, for example
  when the whole point of the message is one person's identity.
