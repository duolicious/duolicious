from dataclasses import dataclass
from typing import List, Optional
import json
import os
from batcher import Batcher
from httpxclient import make_http_client

# This should typically be: https://exp.host/--/api/v2/push/send?useFcmV1=true
NOTIFICATION_API_URL = os.environ.get(
    'DUO_NOTIFICATION_API_URL',
    'http://localhost'
)

@dataclass
class Notification:
    token: str
    title: str
    body: str
    data: Optional[object]

async def process_notification_batch(notifications: List[Notification]) -> None:
    data = [
        dict(
            to=notification.token,
            title=notification.title,
            body=notification.body,
            **(dict(data=notification.data) if notification.data else {}),
            sound='default',
            priority='high',
        )
        for notification in notifications
    ]

    headers = {
        'Accept': 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-type': 'application/json',
    }

    async with make_http_client() as client:
        response = await client.post(
            NOTIFICATION_API_URL,
            content=json.dumps(data).encode('utf-8'),
            headers=headers,
        )
        response.raise_for_status()

    parsed_data = response.json()

    for notification, data in zip(notifications, parsed_data["data"]):
        if data["status"] != "ok":
            raise Exception(f"Notification failed: {data}")

_batcher = Batcher[Notification](
    process_fn=process_notification_batch,
    flush_interval=1.0,
    min_batch_size=1,
    max_batch_size=100,
    retry=False,
)

def enqueue_mobile_notification(
    token: str | None,
    title: str,
    body: str,
    data: object = None
) -> None:
    if not token:
        return

    notification = Notification(token=token, title=title, body=body, data=data)

    _batcher.enqueue(notification)
