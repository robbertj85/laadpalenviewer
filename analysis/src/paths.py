"""Filesystem paths for the analysis layer."""
from pathlib import Path

ANALYSIS_ROOT = Path(__file__).resolve().parent.parent
PROJECT_ROOT = ANALYSIS_ROOT.parent

CACHE_DIR = ANALYSIS_ROOT / ".cache"
GOLD_DIR = ANALYSIS_ROOT / "data"  # golden dataset outputs (parquet/csv)

WEBAPP_PUBLIC = PROJECT_ROOT / "webapp" / "public"
DATA_DIR = WEBAPP_PUBLIC / "data"
GEMEENTEN_DIR = DATA_DIR / "gemeenten"
SNAPSHOTS_DIR = DATA_DIR / "snapshots"
DERIVED_DIR = DATA_DIR / "derived"
MUNICIPALITIES_JSON = WEBAPP_PUBLIC / "municipalities.json"

for d in (CACHE_DIR, GOLD_DIR, DERIVED_DIR):
    d.mkdir(parents=True, exist_ok=True)
