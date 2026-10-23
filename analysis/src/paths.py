"""Filesystem paths for the analysis layer.

Defaults point into the repo for local dev; the server worker overrides them
via LPV_PUBLIC_DIR / LPV_HISTORY_DB / LPV_ANALYSIS_CACHE_DIR (see deploy/).
"""
import os
from pathlib import Path

ANALYSIS_ROOT = Path(__file__).resolve().parent.parent
PROJECT_ROOT = ANALYSIS_ROOT.parent

CACHE_DIR = Path(os.environ.get("LPV_ANALYSIS_CACHE_DIR", ANALYSIS_ROOT / ".cache"))
GOLD_DIR = Path(os.environ.get("LPV_GOLD_DIR", ANALYSIS_ROOT / "data"))  # golden dataset outputs (parquet/csv)

WEBAPP_PUBLIC = Path(os.environ.get("LPV_PUBLIC_DIR", PROJECT_ROOT / "webapp" / "public"))
DATA_DIR = WEBAPP_PUBLIC / "data"
GEMEENTEN_DIR = DATA_DIR / "gemeenten"
DERIVED_DIR = DATA_DIR / "derived"
MUNICIPALITIES_JSON = WEBAPP_PUBLIC / "municipalities.json"
# Usage history written by data-pipeline/src/history.ts.
HISTORY_DB = Path(os.environ.get("LPV_HISTORY_DB", PROJECT_ROOT / "data-pipeline" / ".data" / "history.db"))

for d in (CACHE_DIR, GOLD_DIR, DERIVED_DIR):
    d.mkdir(parents=True, exist_ok=True)
