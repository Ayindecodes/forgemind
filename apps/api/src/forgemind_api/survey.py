"""Everything read out of one checkout: the inspection, and each scan after
it.

A scan that could not cover the whole repository says so among the analysis's
concerns, where what was left out of the inspection is said too.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from pathlib import Path

from forgemind_api.credentials import scan_credentials
from forgemind_api.inspection import Inspection, inspect_tree
from forgemind_api.scanning import Scanned


@dataclass(frozen=True)
class Survey:
    inspection: Inspection
    scans: tuple[Scanned, ...]


def survey(root: Path) -> Survey:
    """Inspects and scans the checkout at `root`. Nothing in it is run."""
    inspection = inspect_tree(root)
    scans = (scan_credentials(root),)
    concerns = [
        *inspection.data["concerns"],
        *(concern for scanned in scans for concern in scanned.concerns),
    ]
    return Survey(
        replace(inspection, data={**inspection.data, "concerns": concerns}), scans
    )
