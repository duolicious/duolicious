from serviceshared.antiabuse.normalize import normalize_string
from serviceshared.antiabuse.antispam.urldetector.tld import tlds
from serviceshared.gifproviders import GIF_PROVIDERS
import re
import unicodedata
from enum import Enum
from typing import Tuple, List, Iterator

class UrlType(Enum):
    NONE = 0
    VERY_SAFE = 1
    SOMEWHAT_SAFE = 2
    UNSAFE = 3

DOT_VARIATIONS_GROUP = (
    r'\s*\b(?:dot|d0t|\.|;|:|,)\b\s*|'
    r'\s*\[(?:dot|d0t|\.|;|:|,)\]\s*|'
    r'\s*\{(?:dot|d0t|\.|;|:|,)\}\s*|'
    r'\s*\((?:dot|d0t|\.|;|:|,)\)\s*|'
    r'\s*(?:\.|;|:|,)\s*'
)

EXTRANEOUS_SPACES = re.compile(r'\s+')

# A set of TLDs we consider "common" and always safe to unify
COMMON_TLDS = {'com', 'net', 'org', 'gg', 'co', 'io'}

VERY_SAFE_DOMAINS = set(GIF_PROVIDERS)

# These domains are typically used to help users describe who they are
SOMEWHAT_SAFE_DOMAINS = {
    'backloggd.com',
    'facebook.com',
    'fandom.com',
    'funnyjunk.com',
    'imdb.com',
    'imgur.com',
    'last.fm',
    'letterboxd.com',
    'rateyourmusic.com',
    'reddit.com',
    'spotify.com',
    'stats.fm',
    'steamcommunity.com',
    'substack.com',
    'twitter.com',
    'vocaroo.com',
    'x.com',
    'youtu.be',
    'youtube.com',
}

# These domains are typically used for self-promotion
UNSAFE_DOMAINS = {
    'bandcamp.com',
    'discord.com',
    'discordapp.com',
    'instagram.com',
    'onlyfans.com',
    'paypal.com',
    'paypal.me',
    'throne.com',
    'twitch.tv',
}

TLD_GROUP = '|'.join(map(re.escape, tlds))

URL_GROUP = (
    r"""("""
    r"""(https?://)?"""                      # optional scheme or www.
    r"""([a-zA-Z0-9]+\.)*"""                 # optional subdomain(s)
    r"""([a-zA-Z0-9\-]+)"""                  # domain name
    rf"""({DOT_VARIATIONS_GROUP})"""         # mandatory dot
    rf"""({TLD_GROUP})(?=$|\s|[/:])"""       # known TLD
    r"""(\:[0-9]+)?"""                       # optional port
    r"""(/[^\s]*)?"""                        # optional path
    r""")"""
)

URL_PATTERN = re.compile(URL_GROUP, re.IGNORECASE)

def has_url(
    text: str,
    include_safe: bool = False,
    do_normalize: bool = True
) -> List[Tuple[UrlType, str]]:
    if do_normalize:
        text = normalize_string(text, [])

    matches = URL_PATTERN.findall(text)

    def go() -> Iterator[Tuple[UrlType, str]]:
        for url, scheme, www, domain, dot, tld, port, path in matches:
            normalized_domain = f'{domain.lower()}.{tld.lower()}'

            if normalized_domain in VERY_SAFE_DOMAINS and include_safe:
                yield UrlType.VERY_SAFE, url
            elif normalized_domain in VERY_SAFE_DOMAINS:
                pass
            elif normalized_domain in SOMEWHAT_SAFE_DOMAINS and include_safe:
                yield UrlType.SOMEWHAT_SAFE, url
            elif normalized_domain in SOMEWHAT_SAFE_DOMAINS:
                pass
            elif normalized_domain in UNSAFE_DOMAINS:
                yield UrlType.UNSAFE, url
            elif tld.lower() in COMMON_TLDS:
                yield UrlType.UNSAFE, url
            elif scheme or www:
                yield UrlType.UNSAFE, url
            elif not re.compile(r'\s+').search(dot):
                yield UrlType.UNSAFE, url

    return list(go())
