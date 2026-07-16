from .legacy import LegacyAdapter
from .powertraces import PowerTracesAdapter
from .trace2flex import Trace2FlexAdapter

ADAPTERS = (Trace2FlexAdapter(), PowerTracesAdapter(), LegacyAdapter())

__all__ = ["ADAPTERS", "LegacyAdapter", "PowerTracesAdapter", "Trace2FlexAdapter"]

