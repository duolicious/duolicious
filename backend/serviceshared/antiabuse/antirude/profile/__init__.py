from serviceshared.antiabuse.normalize import normalize_string
from serviceshared.antiabuse.normalize.normalizationlists import profile

import re


_rude_pattern = '|'.join(f'(\\b{re.escape(s)}\\b)' for s in profile)


_rude_matcher = re.compile(_rude_pattern, re.IGNORECASE)


def is_rude(s: str) -> bool:
    normalized_input = normalize_string(s, profile)

    return bool(_rude_matcher.search(normalized_input))
