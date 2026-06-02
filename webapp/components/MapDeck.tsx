"use client";

import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import Map, { NavigationControl, MapRef, Popup } from "react-map-gl/maplibre";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { ScatterplotLayer, GeoJsonLayer } from "@deck.gl/layers";
import type { PickingInfo } from "@deck.gl/core";
import "maplibre-gl/dist/maplibre-gl.css";
import type { ChargeFeature, BoundaryFeature, Filters } from "@/types/charging";
import { statusColor, freightColor, BOUNDARY_LINE, LEGEND, type RGBA } from "@/lib/colors";

interface MapDeckProps {
  chargeFeatures: ChargeFeature[];
  boundaryFeatures: BoundaryFeature[];
  bounds: [number, number, number, number] | null;
  filters: Filters;
  selectedLocationId: string | null;
  onSelect: (feature: ChargeFeature | null) => void;
}

const NL_BOUNDS: [[number, number], [number, number]] = [
  [3.31, 50.75],
  [7.21, 53.47],
];

const cursorStyle = (hovering: boolean) => `
  .maplibregl-map, .maplibregl-canvas-container, .maplibregl-canvas {
    cursor: ${hovering ? "pointer" : "default"} !important;
  }
`;

export default function MapDeck({
  chargeFeatures,
  boundaryFeatures,
  bounds,
  filters,
  selectedLocationId,
  onSelect,
}: MapDeckProps) {
  const mapRef = useRef<MapRef>(null);
  const [deckOverlay, setDeckOverlay] = useState<MapboxOverlay | null>(null);
  const [hovered, setHovered] = useState<ChargeFeature | null>(null);

  useEffect(() => {
    const overlay = new MapboxOverlay({ interleaved: true, layers: [] });
    setDeckOverlay(overlay);
    return () => overlay.finalize();
  }, []);

  // Split + power-filter the charge features once.
  const { passenger, freight } = useMemo(() => {
    const p: ChargeFeature[] = [];
    const f: ChargeFeature[] = [];
    for (const feat of chargeFeatures) {
      if (feat.properties.maxPowerKw < filters.minPowerKw) continue;
      if (feat.properties.layer === "freight") f.push(feat);
      else p.push(feat);
    }
    return { passenger: p, freight: f };
  }, [chargeFeatures, filters.minPowerKw]);

  const handleHover = useCallback((info: PickingInfo<ChargeFeature>) => {
    setHovered(info.object ?? null);
  }, []);

  const handleClick = useCallback(
    (info: PickingInfo<ChargeFeature>) => {
      if (info.object) onSelect(info.object);
    },
    [onSelect],
  );

  const layers = useMemo(() => {
    const result: unknown[] = [];

    if (filters.showBoundary && boundaryFeatures.length) {
      result.push(
        new GeoJsonLayer({
          id: "boundaries",
          data: { type: "FeatureCollection", features: boundaryFeatures } as never,
          stroked: true,
          filled: false,
          getLineColor: BOUNDARY_LINE as RGBA,
          getLineWidth: 2,
          lineWidthMinPixels: 1.5,
          lineWidthMaxPixels: 3,
          pickable: false,
        }),
      );
    }

    const scatterCommon = {
      pickable: true,
      stroked: true,
      filled: true,
      radiusUnits: "pixels" as const,
      lineWidthMinPixels: 0.5,
      getLineColor: [255, 255, 255, 230] as RGBA,
      getLineWidth: 1,
      onHover: handleHover,
      onClick: handleClick,
      getPosition: (d: ChargeFeature) => d.geometry.coordinates,
    };

    if (filters.showPassenger) {
      result.push(
        new ScatterplotLayer<ChargeFeature>({
          ...scatterCommon,
          id: "passenger",
          data: passenger,
          radiusMinPixels: 3,
          radiusMaxPixels: 10,
          getRadius: (d) => (d.properties.locationId === selectedLocationId ? 11 : 5),
          getFillColor: (d) => statusColor(d.properties.status),
          updateTriggers: { getRadius: [selectedLocationId], getFillColor: [] },
        }),
      );
    }

    if (filters.showFreight) {
      result.push(
        new ScatterplotLayer<ChargeFeature>({
          ...scatterCommon,
          id: "freight",
          data: freight,
          radiusMinPixels: 5,
          radiusMaxPixels: 16,
          getRadius: (d) =>
            d.properties.locationId === selectedLocationId ? 16 : d.properties.isMegawatt ? 11 : 8,
          getFillColor: (d) => freightColor(d.properties.isMegawatt),
          getLineColor: (d) =>
            d.properties.isMegawatt ? ([124, 45, 18, 255] as RGBA) : ([255, 255, 255, 230] as RGBA),
          getLineWidth: (d) => (d.properties.isMegawatt ? 2 : 1),
          updateTriggers: { getRadius: [selectedLocationId] },
        }),
      );
    }

    return result;
  }, [
    passenger,
    freight,
    boundaryFeatures,
    filters.showPassenger,
    filters.showFreight,
    filters.showBoundary,
    selectedLocationId,
    handleHover,
    handleClick,
  ]);

  useEffect(() => {
    if (deckOverlay) deckOverlay.setProps({ layers: layers as never });
  }, [deckOverlay, layers]);

  // Fit to bounds whenever they change (municipality selection).
  useEffect(() => {
    if (bounds && mapRef.current) {
      mapRef.current.fitBounds(
        [
          [bounds[0], bounds[1]],
          [bounds[2], bounds[3]],
        ],
        { padding: 40, duration: 800 },
      );
    }
  }, [bounds]);

  const onMapLoad = useCallback(() => {
    if (mapRef.current && deckOverlay) {
      mapRef.current.getMap().addControl(deckOverlay as never);
    }
  }, [deckOverlay]);

  return (
    <div className="h-full w-full relative">
      <style>{cursorStyle(!!hovered)}</style>
      <Map
        ref={mapRef}
        initialViewState={{ longitude: 5.2913, latitude: 52.1326, zoom: 7 }}
        style={{ width: "100%", height: "100%" }}
        mapStyle="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
        maxBounds={NL_BOUNDS}
        onLoad={onMapLoad}
      >
        <NavigationControl position="top-right" />
        {hovered && (
          <Popup
            longitude={hovered.geometry.coordinates[0]}
            latitude={hovered.geometry.coordinates[1]}
            closeButton={false}
            closeOnClick={false}
            anchor="bottom"
            offset={12}
          >
            <div className="p-2 max-w-xs">
              <div className="font-semibold text-sm text-gray-900">{hovered.properties.name}</div>
              {hovered.properties.city && (
                <div className="text-xs text-gray-600">{hovered.properties.city}</div>
              )}
              {hovered.properties.operatorName && (
                <div className="text-xs text-gray-500 italic">{hovered.properties.operatorName}</div>
              )}
              <div className="text-xs mt-1 flex items-center gap-2">
                <span
                  className="inline-block px-1.5 py-0.5 rounded text-white"
                  style={{
                    background:
                      hovered.properties.layer === "freight"
                        ? hovered.properties.isMegawatt
                          ? LEGEND.freightMegawatt
                          : LEGEND.freight
                        : LEGEND[
                            (
                              {
                                AVAILABLE: "available",
                                CHARGING: "charging",
                                UNAVAILABLE: "unavailable",
                                UNKNOWN: "unknown",
                              } as const
                            )[hovered.properties.status]
                          ],
                  }}
                >
                  {hovered.properties.layer === "freight" ? "Vracht" : "Personenauto"}
                </span>
                {hovered.properties.maxPowerKw > 0 && <span>{hovered.properties.maxPowerKw} kW</span>}
              </div>
              <div className="text-xs text-blue-600 mt-1">Klik voor details</div>
            </div>
          </Popup>
        )}
      </Map>

      {/* Legend */}
      <div className="absolute bottom-4 left-4 bg-white/90 backdrop-blur-sm rounded-lg p-3 shadow-md text-xs">
        <div className="font-semibold mb-1">Personenauto (status)</div>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full" style={{ background: LEGEND.available }} />
            <span>Beschikbaar</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full" style={{ background: LEGEND.charging }} />
            <span>Bezet (laden)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full" style={{ background: LEGEND.unavailable }} />
            <span>Niet beschikbaar</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full" style={{ background: LEGEND.unknown }} />
            <span>Onbekend</span>
          </div>
        </div>
        <div className="font-semibold mt-2 mb-1">Logistiek / vracht</div>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full" style={{ background: LEGEND.freight }} />
            <span>Vracht-laadpunt</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full" style={{ background: LEGEND.freightMegawatt }} />
            <span>Megawatt charging</span>
          </div>
        </div>
      </div>
    </div>
  );
}
