from confusable_homoglyphs import confusables
import re
import unicodedata
from functools import cache
from typing import Callable
import spacy
from spacy.tokens import Token

_spacy_nlp = spacy.load("en_core_web_sm")


def remove_modifiers(text: str) -> str:
    document = _spacy_nlp(text)
    modifier_pos = {"ADJ", "ADV"}
    was_last_token_dropped = False

    def do_keep(token: Token) -> bool:
        nonlocal was_last_token_dropped

        do_drop = (
                token.pos_ in modifier_pos or
                token.pos_ == 'PUNCT' and was_last_token_dropped)

        was_last_token_dropped = do_drop

        return not do_drop

    kept_tokens = [token.text for token in document if do_keep(token)]

    # rebuild the sentence
    cleaned = " ".join(kept_tokens)

    # tidy whitespace around punctuation and collapse doubles
    cleaned = re.sub(r"\s+([,.;:!?])", r"\1", cleaned)
    cleaned = re.sub(r"\s{2,}", " ", cleaned)

    return cleaned.strip()


_censored_chars = 'x*#_.-';


_char_map = {
    "a": "a@4" + _censored_chars,
    "c": "ck",
    "e": "e3" + _censored_chars,
    "g": "gб9",
    "i": "i1!ly" + _censored_chars,
    "l": "l1!",
    "o": "o0" + _censored_chars,
    "s": "sz5$",
    "t": "tт",
    "u": "uv" + _censored_chars,
}


_vowel_chars = {
    "a",
    "e",
    "i",
    "o",
    "u",
}


_non_repeatable_vowels = {
    'o',
    'e',
}


_punctuation = {
    '!',
    ',',
    '.',
    '?',
}


_closed_class_slang_words = {
    "yourself": [
        "urself",
        "your self",
        "ur self",
    ],
    "myself": [
        "my self",
    ],
    "you": [
        "u",
    ],
    "your": [
        "ur",
    ],
    "are": [
        "r",
    ],
    "be": [
        "b",
    ],
    "fuck": [
        "fck",
        "fk",
        "flck",
        "fuc",
        "fuk",
    ],
    "dick": [
        "dik"
    ],
}


_closed_class_slang_suffixes = {
    "ing": [
        "in",
    ],
    "ed": [
        "d",
    ],
}


# This list takes precedence over unsafe phrases
_closed_class_safe_phrases = {
    'essex',
    'k-on',
    'l+o+l+',
    'p+l+s+',
    'p+l+z+',
    'puzzles',
}


_split_pattern = re.compile(r'[^\S\n\r]+')


# Characters which were repeated more than once
_repeated_characters_pattern = re.compile(r'(.)\1+', re.IGNORECASE)

_zero_width_chars = re.compile(r'[\u200B\u200C\u200D\uFEFF]')


def _get_latin_homoglyph(char: str) -> str:
    """
    Returns a Latin homoglyph for the given character if available.
    If no Latin homoglyph is found, returns the original character.
    """
    # confusables.is_confusable returns a list of dictionaries, one per confusable character
    # Each dictionary can contain a 'homoglyphs' key, which is a list of homoglyph entries.
    info_seq = confusables.is_confusable(char, preferred_aliases=['latin']) or []

    for info in info_seq:
        # Extract the first Latin homoglyph character if one exists
        latin_homoglyphs = (
                h['c']
                for h in info.get('homoglyphs', [])
                if info.get('alias') not in ['LATIN', 'COMMON']
        )
        latin_homoglyph = next(latin_homoglyphs, None)
        if latin_homoglyph:
            return latin_homoglyph

    return char


def _normalize_homoglyphs(s: str) -> str:
    """
    Normalizes an input string by replacing characters that are confusable with
    Latin homoglyphs.
    """
    return ''.join(_get_latin_homoglyph(char) for char in s)


def verb_forms(verb: str, exclude: list[str]) -> list[str]:
    """
    Return a list of common English derivations for *verb*:
        base, -s, -ed/-d, -ing, -able, -er, -ers
    with simple spelling rules:
        • drop final e before -ing/-able/-er/-ers. But also add -eable to
          account for misspellings.
        • add only 'd' to verbs ending in e  (dance → danced)
        • double final consonant (except w/x/y) for CVC verbs
          before vowel-initial suffixes  (stop → stopped/stopping/stoppable)

    NOTE: Ignores irregular spellings (go→went, run→ran, etc.).
    """
    def double_final_consonant(w: str) -> str:
        """CVC doubling heuristic (ignores w/x/y)."""
        if (len(w) >= 3 and
            w[-1] not in _vowel_chars | set('wxy') and
            w[-2] in _vowel_chars and
            w[-3] not in _vowel_chars):
            return w + w[-1]
        return w

    def derive(w: str) -> set[str]:
        """Derivations for a single verb form (no 'un-' added here)."""
        forms = {w}

        def add(form: str, suffix: str) -> None:
            if suffix not in exclude:
                forms.add(form + suffix)

        if w.endswith('e'):
            stem = w[:-1]
            add(w, 'd')
            add(stem, 'ing')       # dancing
            add(stem, 'able')      # dancable
            add(stem, 'eable')     # danceable
            add(stem, 'er')
            add(stem, 'ers')
        else:
            base = double_final_consonant(w)
            add(base, 'ed')        # stopped
            add(base, 'ing')       # stopping
            add(base, 'able')      # stoppable
            add(base, 'er')
            add(base, 'ers')

        add(w, 's')           # stops / loves

        return forms

    # 1. normal verb
    derivs = derive(verb)

    # 2. add un- prefixed set if requested and verb itself isn’t already “un…”
    if not verb.startswith("un"):
        derivs |= {"un" + f for f in derivs}

    return sorted(derivs)


def verb_forms_for_each(
    verb_list: list[str],
    exclude: list[str] = []
) -> list[str]:
    return [
        verb_form
        for verb in verb_list
        for verb_form in verb_forms(verb, exclude)
    ]


def char_to_regex(c: str, is_initial: bool, is_final: bool, is_short: bool) -> str:
    is_medial = not is_initial and not is_final

    is_elidable = is_medial and not is_short and c in _vowel_chars

    is_repeatable = not is_short or c not in _non_repeatable_vowels

    start_quantifier_number = 0 if is_elidable else 1

    end_quantifier_number = (
            ''
            if is_repeatable
            else str(start_quantifier_number))

    re_quantifier = (
        '{' +
        str(start_quantifier_number) +
        ',' +
        str(end_quantifier_number) +
        '}'
    )

    re_chars = _char_map[c] if c in _char_map else c

    # Don't match punctuation at the end of a word
    if is_final:
        re_chars = ''.join(c for c in re_chars if c not in _punctuation)

    return rf'[{re_chars}]{re_quantifier}'


def suffix_class_instance_to_regex(suffix_class_instance: str) -> str:
    suffix_class_instance_with_elision = ''.join(
        c
        for i, c in enumerate(suffix_class_instance)
        if c not in _vowel_chars
        or i == 0
        or i == len(suffix_class_instance) - 1
    )

    is_short = len(suffix_class_instance_with_elision) <= 3

    return '(' + ''.join(
        char_to_regex(
            c=c,
            is_initial=i == 0,
            is_final=i == len(suffix_class_instance) - 1,
            is_short=is_short,
        )
        for i, c in enumerate(suffix_class_instance)
    ) + ')'


def suffix_class_to_regex(suffix_class: list[str]) -> str:
    return '(' + '|'.join(
        suffix_class_instance_to_regex(suffix_class_instance)
        for suffix_class_instance in suffix_class
    ) + ')'


def word_class_instance_to_regex(word_class_instance: str) -> str:
    for suffix in _closed_class_slang_suffixes:
        if word_class_instance.endswith(suffix):
            without_suffix = word_class_instance[:-len(suffix)]

            with_suffixes = [
                f'{without_suffix}{suffix_class_instance}'
                for suffix_class_instance in _closed_class_slang_suffixes[suffix]
            ]

            return suffix_class_to_regex([word_class_instance] + with_suffixes)

    return suffix_class_to_regex([word_class_instance])



def word_class_to_regex(word_class: list[str]) -> str:
    return '(' + '|'.join(
        word_class_instance_to_regex(word_class_instance)
        for word_class_instance in word_class
    ) + ')'


def word_to_regex(word: str) -> str:
    if word in _closed_class_slang_words:
        return word_class_to_regex([word] + _closed_class_slang_words[word])
    else:
        return word_class_to_regex([word])


def phrase_to_regex(phrase: str) -> str:
    return '(' + '[ -]?'.join(
            word_to_regex(word) for word in phrase.split(' ')
    ) + ')'


@cache
def phrase_to_pattern(phrase: str) -> re.Pattern[str]:
    needle = phrase_to_regex(phrase)

    return re.compile(
            r'((?<=[^a-z0-9])|^)'
            f'{needle}'
            r'((?=[^a-z0-9])|$)',
            re.IGNORECASE)


@cache
def make_sub_unless_safe(phrase: str) -> Callable[[re.Match[str]], str]:
    def sub_unless_safe(match: re.Match[str]) -> str:
        matched_text = match.group(0)

        for re_safe_phrase in _closed_class_safe_phrases:
            safe_pattern = re.compile(re_safe_phrase, re.IGNORECASE)
            if safe_pattern.fullmatch(matched_text):
                return matched_text

        return phrase

    return sub_unless_safe


def _normalize_spelling(haystack: str, normalizeable_phrases: list[str]) -> str:
    for phrase in normalizeable_phrases:
        sub_unless_safe = make_sub_unless_safe(phrase)

        pattern = phrase_to_pattern(phrase)

        haystack = pattern.sub(sub_unless_safe, haystack)

    return haystack


def _remove_zero_width_characters(s: str) -> str:
    return _zero_width_chars.sub('', s)


def normalize_string(
    s: str,
    normalizeable_phrases: list[str],
    do_remove_modifiers: bool = False
) -> str:
    normalized_input = unicodedata.normalize('NFKD', s)
    normalized_input = ''.join(
        char for char in normalized_input if not unicodedata.combining(char)
    )

    # Mitigate homoglyph attacks
    normalized_input = _normalize_homoglyphs(normalized_input)

    # Normalize whitespace
    normalized_input = ' '.join(_split_pattern.split(normalized_input))

    # Remove repeated characters
    normalized_input = _repeated_characters_pattern.sub(
        r'\1\1', normalized_input)

    # Remove zero width characters
    normalized_input = _remove_zero_width_characters(normalized_input)

    # Remove adverbs and adjectives
    if do_remove_modifiers:
        normalized_input = remove_modifiers(normalized_input)

    # Replace slang
    normalized_input = _normalize_spelling(normalized_input, normalizeable_phrases)

    return normalized_input
