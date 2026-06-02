"use client";

import type { Filters } from "@/types/charging";
import { LEGEND } from "@/lib/colors";

interface FilterPanelProps {
  filters: Filters;
  onChange: (f: Filters) => void;
  passengerCount: number;
  freightCount: number;
}

const POWER_STEPS = [0, 50, 150, 350, 1000];

export default function FilterPanel({ filters, onChange, passengerCount, freightCount }: FilterPanelProps) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });

  return (
    <div className="bg-white rounded-lg shadow-sm p-4 space-y-4">
      <h3 className="text-sm font-semibold text-gray-900">Kaartlagen</h3>

      {/* Layer toggles */}
      <div className="space-y-2">
        <label className="flex items-center justify-between gap-2 cursor-pointer">
          <span className="flex items-center gap-2 text-sm text-gray-800">
            <input
              type="checkbox"
              checked={filters.showPassenger}
              onChange={(e) => set({ showPassenger: e.target.checked })}
              className="w-4 h-4 accent-blue-600"
            />
            <span className="w-3 h-3 rounded-full" style={{ background: LEGEND.available }} />
            Personenauto
          </span>
          <span className="text-xs text-gray-500 tabular-nums">{passengerCount.toLocaleString("nl-NL")}</span>
        </label>

        <label className="flex items-center justify-between gap-2 cursor-pointer">
          <span className="flex items-center gap-2 text-sm text-gray-800">
            <input
              type="checkbox"
              checked={filters.showFreight}
              onChange={(e) => set({ showFreight: e.target.checked })}
              className="w-4 h-4 accent-amber-500"
            />
            <span className="w-3 h-3 rounded-full" style={{ background: LEGEND.freight }} />
            Logistiek / vracht
          </span>
          <span className="text-xs text-gray-500 tabular-nums">{freightCount.toLocaleString("nl-NL")}</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={filters.showBoundary}
            onChange={(e) => set({ showBoundary: e.target.checked })}
            className="w-4 h-4 accent-indigo-600"
          />
          <span className="w-3 h-3 rounded-sm border-2" style={{ borderColor: LEGEND.boundary }} />
          <span className="text-sm text-gray-800">Gemeente-/provinciegrens</span>
        </label>
      </div>

      {/* Power filter */}
      <div className="pt-2 border-t border-gray-100">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">Min. vermogen</span>
          <span className="text-xs text-gray-500">
            {filters.minPowerKw === 0 ? "alle" : `≥ ${filters.minPowerKw} kW`}
          </span>
        </div>
        <div className="flex gap-1">
          {POWER_STEPS.map((kw) => (
            <button
              key={kw}
              onClick={() => set({ minPowerKw: kw })}
              className={`flex-1 px-1 py-1.5 text-xs rounded transition ${
                filters.minPowerKw === kw
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {kw === 0 ? "Alle" : kw}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
