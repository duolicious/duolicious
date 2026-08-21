from typing import Tuple
import hashlib
import uuid

def sha512(s: str) -> str:
    m = hashlib.sha512()
    m.update(s.encode())  # encode the string into bytes
    return m.hexdigest()

def md5(s: str) -> str:
    m = hashlib.md5()
    m.update(s.encode())
    return m.hexdigest()

def duo_uuid() -> str:
    return str(uuid.uuid4())
