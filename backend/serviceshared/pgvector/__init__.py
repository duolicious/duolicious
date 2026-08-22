import numpy
import numpy.typing as npt
from collections.abc import Iterable


def to_pgvector(values: Iterable[float]) -> str:
    """Format a vector as a pgvector text literal for `::vector`."""
    return '[' + ','.join(repr(float(x)) for x in values) + ']'


def parse_pgvector(text: str) -> npt.NDArray[numpy.float32]:
    """Parse a pgvector text literal, e.g. from a `::TEXT`-cast column."""
    return numpy.array(text.strip('[]').split(','), dtype=numpy.float32)
