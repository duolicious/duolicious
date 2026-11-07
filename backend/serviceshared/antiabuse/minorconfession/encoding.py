from tokenizers import Tokenizer

_MAX_LENGTH = 320
_MAX_HEADER_LENGTH = 64
_MAX_TARGET_LENGTH = 96
_MAX_CHARS = 300


def _trim(text: str) -> str:
    text = ' '.join(text.split())
    return text if len(text) <= _MAX_CHARS else text[:_MAX_CHARS] + '…'


def encode(
    tokenizer: Tokenizer,
    claimed_age: int,
    about: str,
    before: list[tuple[bool, str]],
    target: str,
) -> list[int]:
    special = set(tokenizer.get_added_tokens_decoder())
    cls, sep = tokenizer.encode('').ids

    def ids(text: str) -> list[int]:
        return [
            i for i in tokenizer.encode(' ' + text, add_special_tokens=False).ids
            if i not in special]

    header = ids(f'claimed age {claimed_age}. profile: {_trim(about)}')[
        :_MAX_HEADER_LENGTH]
    message = [
        *ids('>> me:'),
        *ids(_trim(target))[:_MAX_TARGET_LENGTH],
        sep,
    ]
    budget = _MAX_LENGTH - len(header) - len(message) - 2

    turns: list[int] = []
    for is_me, body in reversed(before):
        prefix = ids('me:' if is_me else 'them:')
        room = budget - len(prefix) - 1
        if room <= 0:
            break
        turn = [*prefix, *ids(_trim(body))[-room:], sep]
        turns = turn + turns
        budget -= len(turn)

    return [cls, *header, sep, *turns, *message]
