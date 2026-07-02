"""Async wrappers around the blocking boto3 API.

boto3's client/resource methods are synchronous and would block the event
loop, so each wrapper offloads the underlying call to a worker thread via
`asyncio.to_thread`.
"""
import asyncio
import io
from typing import Protocol, TypedDict


class SupportsPutObject(Protocol):
    def put_object(self, *, Key: str, Body: bytes | io.BytesIO) -> object: ...


class DeleteError(TypedDict):
    Key: str
    Message: str


class DeleteObjectsResponse(TypedDict, total=False):
    Errors: list[DeleteError]


class SupportsDeleteObjects(Protocol):
    def delete_objects(
        self,
        *,
        Bucket: str,
        Delete: dict[str, object],
    ) -> DeleteObjectsResponse: ...


async def put_object(
    bucket: SupportsPutObject,
    *,
    Key: str,
    Body: bytes | io.BytesIO,
) -> object:
    """Async counterpart of boto3's `Bucket.put_object`."""
    return await asyncio.to_thread(bucket.put_object, Key=Key, Body=Body)


async def delete_objects(
    client: SupportsDeleteObjects,
    *,
    Bucket: str,
    Delete: dict[str, object],
) -> DeleteObjectsResponse:
    """Async counterpart of boto3's `client.delete_objects`."""
    return await asyncio.to_thread(
        client.delete_objects,
        Bucket=Bucket,
        Delete=Delete,
    )
