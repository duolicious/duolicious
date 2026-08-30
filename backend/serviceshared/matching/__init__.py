"""The matching models, as application-level database triggers.

Each model declares which tables and columns it reads (`watched`) and how
to recompute one person (`person_changed`); the trigger layer
(serviceshared/database/triggers.py) does the rest. Adding a model means
adding a module here and appending it to `MODELS` -- the entrypoints
install that tuple at startup, and no call site anywhere changes.
"""
from serviceshared.database.triggers import Trigger
from serviceshared.matching import clubs, personality

MODELS: tuple[Trigger, ...] = (
    personality.MODEL,
    clubs.MODEL,
)
