"""Phase 2-5 models on the gemeente-grain golden dataset.

All transparent and documented. Where real grid-capacity data is not ingested
(open Capaciteitskaart is viewer-only), congestion is a MODELLED index, flagged.
"""
from __future__ import annotations
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import cross_val_predict, KFold
from sklearn.metrics import r2_score, mean_absolute_error

# Demand model features (socio-demographic drivers of charging demand).
FEATURES = [
    "inwoners", "huishoudens", "autos_totaal", "autos_per_huishouden",
    "inkomen_per_inwoner", "stedelijkheid", "adresdichtheid",
]
TARGET = "chargers_passenger"

# Load-model constants (documented, tunable).
# NDW omits max_electric_power for ~90% of connectors, so power MUST be assumed.
ASSUMED_EVSE_KW = 11.0    # blended assumed draw per EVSE (mostly AC)
AVG_FREIGHT_KW = 150.0    # typical HPC/truck connector draw
CONCURRENCY = 0.30        # planning concurrency for the potential peak


def _pct_rank(s: pd.Series) -> pd.Series:
    return (s.rank(pct=True) * 100).round(0)


def add_models(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()

    # ---- P2: demand (peer benchmark) ----
    X = df[FEATURES].apply(lambda c: c.fillna(c.median()), axis=0)
    y = df[TARGET].fillna(0).astype(float)
    model = RandomForestRegressor(n_estimators=300, min_samples_leaf=3, random_state=42, n_jobs=-1)
    cv = KFold(n_splits=5, shuffle=True, random_state=42)
    oof = cross_val_predict(model, X, y, cv=cv, n_jobs=-1)
    oof = np.clip(oof, 0, None)
    df["expected_chargers"] = oof.round(0)
    df["supply_gap"] = (y - oof).round(0)  # actual - expected; <0 = underserved

    pop = df["inwoners"].fillna(df["population"]).replace(0, np.nan)
    df["demand_per_1000_inw"] = (df["expected_chargers"] / pop * 1000).round(2)

    # fit on all for feature importance + reported metrics
    model.fit(X, y)
    metrics = {
        "r2_oof": round(float(r2_score(y, oof)), 3),
        "mae_oof": round(float(mean_absolute_error(y, oof)), 1),
        "feature_importance": dict(zip(FEATURES, model.feature_importances_.round(3).tolist())),
    }

    # ---- P3: optimal siting (gap-driven priority) ----
    deficit = (df["expected_chargers"] - y).clip(lower=0)  # how many short
    rel_deficit = (deficit / df["expected_chargers"].replace(0, np.nan)).fillna(0)
    occ = df["avg_occupancy"].fillna(df["avg_occupancy"].median() if df["avg_occupancy"].notna().any() else 0)
    occ_norm = occ / 100.0
    # priority blends absolute shortfall, relative shortfall, and usage pressure
    raw = 0.5 * rel_deficit + 0.3 * (deficit / (deficit.max() or 1)) + 0.2 * occ_norm
    df["siting_priority"] = (raw / (raw.max() or 1) * 100).round(0)

    # ---- P4: congestion risk + net impact ----
    # EVSE count: prefer live snapshot total; fall back to locations if no snapshot.
    evse = df["evse_total"].fillna(df["chargers_passenger"].fillna(0) + df["chargers_freight"].fillna(0))
    # Potential peak (planning): all EVSEs x assumed kW x concurrency.
    df["potential_peak_load_kw"] = (evse * ASSUMED_EVSE_KW * CONCURRENCY).round(0)
    # Live peak now (grounded in OCPI status): EVSEs charging now x assumed kW.
    df["live_peak_load_kw"] = (df["charging_now"] * ASSUMED_EVSE_KW).round(0)
    # Scenario base = potential peak; kept as est_peak_load_kw for the scorecard slider.
    df["est_peak_load_kw"] = df["potential_peak_load_kw"]
    df["load_per_1000_inw_kw"] = (df["potential_peak_load_kw"] / pop * 1000).round(1)
    df["congestion_index"] = _pct_rank(df["load_per_1000_inw_kw"])  # 0-100 relative

    # ---- P5: municipal percentiles (for scorecard) ----
    df["supply_pct"] = _pct_rank(df["chargers_per_1000_inw"])
    df["occupancy_pct"] = _pct_rank(df["avg_occupancy"]) if df["avg_occupancy"].notna().any() else np.nan
    df["gap_pct"] = _pct_rank(-df["supply_gap"])  # high = more underserved

    df.attrs["model_metrics"] = metrics
    print(f"  [models] demand OOF R²={metrics['r2_oof']} MAE={metrics['mae_oof']}; "
          f"top feature={max(metrics['feature_importance'], key=metrics['feature_importance'].get)}")
    return df
