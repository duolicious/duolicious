from serviceshared.antiabuse.normalize import normalize_string
from serviceshared.antiabuse.normalize.normalizationlists import chat
import re


_needle = '(' + '|'.join(f'{re.escape(s)}' for s in chat) + ')'


_rude_pattern = (
    r'((?<=[^a-z0-9])|^)' +
    f'{_needle}' +
    r'((?=[^a-z0-9])|$)')


_rude_matcher = re.compile(_rude_pattern, re.IGNORECASE)


def is_rude(s: str) -> bool:
    return \
            bool(_rude_matcher.search(
                normalize_string(s, chat, do_remove_modifiers=False))) or \
            bool(_rude_matcher.search(
                normalize_string(s, chat, do_remove_modifiers=True)))
