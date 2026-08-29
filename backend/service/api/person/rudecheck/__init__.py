from collections.abc import Awaitable, Callable

import service.api.duotypes as t
from serviceshared.antiabuse import bannedphoto
from serviceshared.antiabuse.antirude import displayname, education, occupation

# Rude-text checks that share the same shape (reject the field's value if the
# checker flags it). `base64_file` inspects a hash and has its own message, so
# it's handled separately in `reject_rude_or_banned`.
_RUDE_TEXT_CHECKS: dict[str, Callable[[str], Awaitable[bool]]] = {
    'name': displayname.is_rude,
    'occupation': occupation.is_rude,
    'education': education.is_rude,
}


async def reject_rude_or_banned(field_name: str, req: object) -> None:
    """Anti-abuse checks that need the async DB, so they run here rather than in
    the (synchronous) pydantic validators for these fields. Every handler
    accepting one of these fields must call this.

    A field can legitimately be set to null (e.g. clearing occupation), so the
    check is skipped when its value is None."""
    value = getattr(req, field_name, None)
    if value is None:
        return

    if field_name == 'base64_file':
        if await bannedphoto.is_banned_photo(value.md5_hash):
            raise t.FieldValidationError(
                'base64_file', 'That pic breaks the rules 🙈')
        return

    checker = _RUDE_TEXT_CHECKS.get(field_name)
    if checker is not None and await checker(value):
        raise t.FieldValidationError(field_name, 'Too rude')

