"""
Dependency-light timestamp helpers used by the chat protocol and service.
"""
import datetime


FMT_ISO_8601_TIMESTAMP = '%Y-%m-%dT%H:%M:%S.%fZ'


def now_microseconds() -> int:
    """
    The current time as a count of microseconds since the Unix epoch.
    """
    return int(datetime.datetime.now().timestamp() * 1_000_000)


def format_timestamp(microseconds: int) -> str:
    """
    Converts a timestamp in microseconds to an ISO 8601 string.
    """
    timestamp_sec = microseconds / 1e6
    dt = datetime.datetime.utcfromtimestamp(timestamp_sec)
    return dt.strftime(FMT_ISO_8601_TIMESTAMP)


def format_datetime(dt: datetime.datetime) -> str:
    """
    Converts a datetime to an ISO 8601 string in UTC. Naive datetimes (e.g. the
    `TIMESTAMP` columns, which store UTC) are assumed to be in UTC.
    """
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    return dt.astimezone(datetime.timezone.utc).strftime(FMT_ISO_8601_TIMESTAMP)
