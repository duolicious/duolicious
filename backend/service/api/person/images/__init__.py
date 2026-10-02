from starlette.concurrency import run_in_threadpool

import service.api.duotypes as t

async def load_image(base64_file: t.Base64File) -> None:
    try:
        await run_in_threadpool(base64_file.image.load)
    except Exception:
        raise t.FieldValidationError('base64_file', 'Image invalid')
