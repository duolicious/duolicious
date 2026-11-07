from pathlib import Path

from tokenizers import Tokenizer

from serviceshared.inference import any_window_above, onnx_session

_DIR = Path(__file__).parent

_THRESHOLD = -4.93

_TOKENIZER = Tokenizer.from_file(str(_DIR / 'tokenizer.json'))

_SESSION = onnx_session(str(_DIR / 'model.onnx'))


def may_confess_minor(message: str) -> bool:
    return any_window_above(_SESSION, _TOKENIZER.encode(message), _THRESHOLD)
