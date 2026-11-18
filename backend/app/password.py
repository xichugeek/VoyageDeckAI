import base64
import getpass
import hashlib
import hmac
import secrets


def _derive(password: str, salt: bytes) -> bytes:
    return hashlib.scrypt(
        password.encode("utf-8"), salt=salt, n=2**15, r=8, p=3, dklen=32, maxmem=2**26,
    )


def _unpack(encoded: str) -> tuple[bytes, bytes]:
    scheme, salt, digest = encoded.split("$")
    if scheme != "scrypt-v1":
        raise ValueError("Unsupported administrator password hash")
    decoded_salt = base64.b64decode(salt, altchars=b"-_", validate=True)
    decoded_digest = base64.b64decode(digest, altchars=b"-_", validate=True)
    if len(decoded_salt) != 16 or len(decoded_digest) != 32:
        raise ValueError("Invalid administrator password hash")
    return decoded_salt, decoded_digest


def hash_password(password: str) -> str:
    if not 14 <= len(password) <= 256:
        raise ValueError("Use a password between 14 and 256 characters")
    salt = secrets.token_bytes(16)
    encoded_salt = base64.urlsafe_b64encode(salt).decode("ascii")
    encoded_digest = base64.urlsafe_b64encode(_derive(password, salt)).decode("ascii")
    return f"scrypt-v1${encoded_salt}${encoded_digest}"


def validate_hash(encoded: str) -> None:
    _unpack(encoded)


def verify_password(password: str, encoded: str) -> bool:
    salt, expected = _unpack(encoded)
    return hmac.compare_digest(_derive(password, salt), expected)


if __name__ == "__main__":
    first = getpass.getpass("Administrator password: ")
    second = getpass.getpass("Confirm password: ")
    if first != second:
        raise SystemExit("Passwords do not match")
    try:
        print(hash_password(first))
    except ValueError as exc:
        raise SystemExit(str(exc)) from None
