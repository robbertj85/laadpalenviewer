"""Phase 1 analysis pipeline: golden dataset (gemeente) -> viewer layer."""
from __future__ import annotations
import sys
from .gold import build_gold
from .export import export_layer


def main() -> None:
    refresh = "--refresh" in sys.argv
    print("\n=== Laadpalenviewer analysis ===\n")
    gold = build_gold(refresh=refresh)
    export_layer(gold)
    print("\n=== Analysis done ===\n")


if __name__ == "__main__":
    main()
