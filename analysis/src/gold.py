"""Assemble the gemeente-grain golden dataset and derived metrics."""
from __future__ import annotations
import pandas as pd
from .ingest.cbs import fetch_cbs_gemeente
from .ingest.chargers import fetch_chargers
from .models import add_models
from .paths import GOLD_DIR


def build_gold(refresh: bool = False) -> pd.DataFrame:
    print("Building golden dataset (gemeente grain)...")
    chargers = fetch_chargers()
    cbs = fetch_cbs_gemeente(refresh=refresh)

    df = chargers.join(cbs, how="left")
    df["chargers_total"] = df["chargers_passenger"] + df["chargers_freight"]

    # Prefer CBS population; fall back to municipalities.json population.
    pop = df["inwoners"].fillna(df["population"]).replace(0, pd.NA)
    autos = df["autos_totaal"].replace(0, pd.NA)

    df["chargers_per_1000_inw"] = (df["chargers_total"] / pop * 1000).round(2)
    df["chargers_per_1000_auto"] = (df["chargers_total"] / autos * 1000).round(2)
    df["autos_per_charger"] = (autos / df["chargers_total"].replace(0, pd.NA)).round(1)
    df["power_per_1000_inw_kw"] = (df["total_power_kw"] / pop * 1000).round(1)

    # Phases 2-5 models (demand, siting, congestion/net-impact, municipal).
    df = add_models(df)

    GOLD_DIR.mkdir(parents=True, exist_ok=True)
    df.to_csv(GOLD_DIR / "gold_gemeente.csv")
    try:
        df.to_parquet(GOLD_DIR / "gold_gemeente.parquet")
    except Exception as e:  # pyarrow missing -> CSV still written
        print(f"  (parquet skipped: {e})")

    print(f"  golden dataset: {len(df)} gemeenten, {df.shape[1]} columns")
    return df
