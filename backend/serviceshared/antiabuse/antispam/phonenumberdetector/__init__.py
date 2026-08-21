import re

def detect_phone_numbers(text: str) -> list[str]:
    """
    Attempt to match phone number formats with optional country code,
    optional area code, and 2–3 groups of 2–4 digits (plus an optional extension).
    Then apply a digit-count filter to weed out very short or very long matches.
    Additionally, skip date-like strings (e.g. YYYY-MM-DD).
    """
    phone_number_pattern = re.compile(
        r"""
        # Optional country code, e.g. "+1", "+44", up to +XXX
        (?:\+?\d{1,3}[ -]?)?

        # Optional area code, e.g. "2", "(02)", "(555)", or 1-4 digits
        (?:\(\d{1,4}\)|\d{1,4})?

        # Optional separator
        [ -]?

        # First group: 3 or 4 digits
        \d{3,4}

        # Optional separator
        [ -]?

        # Second group: 2 to 4 digits
        \d{2,4}

        # Optional third group (extension or splitting): 2 to 4 digits
        (?:[ -]?\d{2,4})?

        \b
        """,
        re.VERBOSE
    )

    # Simple date pattern YYYY-MM-DD
    date_pattern = re.compile(r'^\d{4}-\d{2}-\d{2}$')

    raw_matches = phone_number_pattern.findall(text)

    valid_matches = []
    for match in raw_matches:
        candidate = match.strip()

        # ------------------------------
        # Skip date-like patterns:
        if date_pattern.match(candidate):
            continue
        # ------------------------------

        # Count digits only
        digits_only = re.sub(r'\D', '', candidate)

        # Decide minimum and maximum allowed digit counts
        # Example rule:
        #   - If it starts with '+', require 9–14 digits
        #   - Otherwise require 7–14 digits
        if candidate.startswith('+'):
            if 9 <= len(digits_only) <= 14:
                valid_matches.append(candidate)
        else:
            if 7 <= len(digits_only) <= 14:
                valid_matches.append(candidate)

    return valid_matches
