from serviceshared.antiabuse.normalize import normalize_string
from serviceshared.antiabuse.normalize.normalizationlists import solitication
import re


_solicitation_pattern = '|'.join(f'(\\b{re.escape(s)}\\b)' for s in solitication)


_solicitation_matcher = re.compile(_solicitation_pattern, re.IGNORECASE)


def has_solicitation(s: str) -> bool:
    normalized_input = normalize_string(s, solitication)

    return bool(_solicitation_matcher.search(normalized_input))
