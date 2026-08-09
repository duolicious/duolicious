"""
One module of environment variables per service — `duoenv.api`,
`duoenv.cron` — plus `duoenv.shared` for variables read by libraries both
services import. Each module reads and validates its variables at import
time, so importing a module *is* validating it: a required variable that
is missing, or any variable that fails to parse, raises before the
service can start.

`service.firehol` is excluded: its container ships only `service/firehol`,
so it cannot import this package and keeps its own env read.
"""
