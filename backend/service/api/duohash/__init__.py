import hashlib

def sha512(s: str) -> str:
    m = hashlib.sha512()
    m.update(s.encode())  # encode the string into bytes
    return m.hexdigest()

def md5(s: str) -> str:
    m = hashlib.md5()
    m.update(s.encode())
    return m.hexdigest()
