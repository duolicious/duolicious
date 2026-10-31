from pathlib import Path
import re

from tokenizers import Tokenizer

from serviceshared.antiabuse.normalize import normalize_chat_message
from serviceshared.inference import any_window_above, onnx_session

_DIR = Path(__file__).parent

_ALWAYS_RUDE = re.compile(
    r"\b(1488|cunny|heil hitler|kikes?|lolicon|shotacon|sieg heil|trannoids?|"
    r"you(?: wi|['’])ll never be a (?:real )?woman|ywnbar?w)\b|(?<!s)nigger",
    re.IGNORECASE)

_TOKENIZER = Tokenizer.from_file(str(_DIR / 'tokenizer.json'))

_SESSION = onnx_session(str(_DIR / 'model.onnx'))


def is_rude(s: str) -> bool:
    text = normalize_chat_message(s)

    if _ALWAYS_RUDE.search(text):
        return True

    return any_window_above(_SESSION, _TOKENIZER.encode(text), 1.8)
