from starlette.responses import RedirectResponse

from serviceshared.util import append_query


def resolve_redirect_target(state: str, targets: dict[str, str]) -> str | None:
    _, _, target = state.rpartition('.')
    return targets.get(target) or None


def redirect(target_url: str, **params: str) -> RedirectResponse:
    return RedirectResponse(append_query(target_url, params), status_code=302)
