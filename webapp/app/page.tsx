"use client";

import { useState, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import MunicipalitySelector from "@/components/MunicipalitySelector";
import AddressSearchInput from "@/components/AddressSearchInput";
import FilterPanel from "@/components/FilterPanel";
import StatsPanel from "@/components/StatsPanel";
import LocationDetailPanel from "@/components/LocationDetailPanel";
import AboutModal from "@/components/AboutModal";
import ShareModal from "@/components/ShareModal";
import {
  Municipality,
  CropoutData,
  DetailBundle,
  ChargeFeature,
  BoundaryFeature,
  Filters,
  DEFAULT_FILTERS,
} from "@/types/charging";

const MapDeck = dynamic(() => import("@/components/MapDeck"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-gray-100">
      <p className="text-gray-500">Kaart laden…</p>
    </div>
  ),
});

const NL_BOUNDS: [number, number, number, number] = [3.31, 50.75, 7.21, 53.47];
const DEFAULT_SLUG = "utrecht";

export default function Home() {
  const [municipalities, setMunicipalities] = useState<Municipality[]>([]);
  const [selectedMunicipality, setSelectedMunicipality] = useState<string>("");
  const [chargeFeatures, setChargeFeatures] = useState<ChargeFeature[]>([]);
  const [boundaryFeatures, setBoundaryFeatures] = useState<BoundaryFeature[]>([]);
  const [bounds, setBounds] = useState<[number, number, number, number] | null>(null);
  const [details, setDetails] = useState<DetailBundle>({});
  const [gemeenteName, setGemeenteName] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [selected, setSelected] = useState<ChargeFeature | null>(null);
  const [showAbout, setShowAbout] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const isNational = selectedMunicipality === "nederland";

  // Load municipalities once.
  useEffect(() => {
    fetch("/municipalities.json")
      .then((r) => r.json())
      .then((data: Municipality[]) => {
        const sorted = data.sort((a, b) => {
          if (a.slug === "nederland") return 1;
          if (b.slug === "nederland") return -1;
          return a.name.localeCompare(b.name);
        });
        setMunicipalities(sorted);

        const params = new URLSearchParams(window.location.search);
        const raw = params.get("gemeente");
        const param = raw === "alle-gemeenten" ? "nederland" : raw;
        const last = localStorage.getItem("lastSelectedMunicipality");
        if (param && sorted.find((m) => m.slug === param)) setSelectedMunicipality(param);
        else if (last && sorted.find((m) => m.slug === last)) setSelectedMunicipality(last);
        else setSelectedMunicipality(sorted.find((m) => m.slug === DEFAULT_SLUG) ? DEFAULT_SLUG : sorted[0].slug);
      })
      .catch((e) => console.error("municipalities load failed", e));
  }, []);

  // Persist selection to URL + localStorage.
  useEffect(() => {
    if (!selectedMunicipality || municipalities.length === 0) return;
    localStorage.setItem("lastSelectedMunicipality", selectedMunicipality);
    const url = new URL(window.location.href);
    url.searchParams.set("gemeente", isNational ? "alle-gemeenten" : selectedMunicipality);
    window.history.replaceState({}, "", url.toString());
  }, [selectedMunicipality, municipalities, isNational]);

  // Load data when municipality changes.
  useEffect(() => {
    if (!selectedMunicipality) return;
    let cancelled = false;
    setLoading(true);
    setSelected(null);

    const load = async () => {
      if (selectedMunicipality === "nederland") {
        const [pRes, fRes, provRes] = await Promise.all([
          fetch("/data/nederland-passenger.geojson"),
          fetch("/data/nederland-freight.geojson"),
          fetch("/data/provinces.geojson"),
        ]);
        const [p, f, prov] = (await Promise.all([pRes.json(), fRes.json(), provRes.json()])) as CropoutData[];
        if (cancelled) return;
        setChargeFeatures([
          ...(p.features as ChargeFeature[]),
          ...(f.features as ChargeFeature[]),
        ]);
        setBoundaryFeatures(prov.features as BoundaryFeature[]);
        setBounds(NL_BOUNDS);
        setDetails({});
        setGemeenteName("Nederland");
      } else {
        const [cropRes, detRes] = await Promise.all([
          fetch(`/data/gemeenten/${selectedMunicipality}.geojson`),
          fetch(`/data/gemeenten/${selectedMunicipality}.details.json`),
        ]);
        const crop = (await cropRes.json()) as CropoutData;
        const bundle = (await detRes.json()) as DetailBundle;
        if (cancelled) return;
        const charges = crop.features.filter((f) => f.properties.type === "charge") as ChargeFeature[];
        const boundaries = crop.features.filter((f) => f.properties.type === "boundary") as BoundaryFeature[];
        setChargeFeatures(charges);
        setBoundaryFeatures(boundaries);
        setBounds(crop.metadata.bounds ?? null);
        setDetails(bundle);
        setGemeenteName(crop.metadata.gemeente ?? selectedMunicipality);
      }
    };

    load()
      .catch((e) => console.error("data load failed", e))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [selectedMunicipality]);

  const { passengerCount, freightCount } = useMemo(() => {
    let p = 0;
    let f = 0;
    for (const feat of chargeFeatures) {
      if (feat.properties.layer === "freight") f++;
      else p++;
    }
    return { passengerCount: p, freightCount: f };
  }, [chargeFeatures]);

  const selectedDetail = selected ? details[selected.properties.locationId] ?? null : null;

  const handleAddressSelected = (slug: string) => {
    setSelectedMunicipality(slug);
    setMobileSidebarOpen(false);
  };

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="bg-white shadow-sm z-20">
        <div className="px-3 py-2 md:px-4 md:py-3 flex items-center gap-2 md:gap-4">
          <h1 className="text-lg md:text-xl font-bold text-gray-900 flex-shrink-0">
            🔌 <span className="hidden sm:inline">Laadpalenviewer</span>
          </h1>
          <div className="flex-1 min-w-0 max-w-[200px] sm:max-w-xs md:max-w-md">
            <MunicipalitySelector
              municipalities={municipalities}
              selected={selectedMunicipality}
              onChange={(slug) => {
                setSelectedMunicipality(slug);
                setMobileSidebarOpen(false);
              }}
            />
          </div>
          <div className="hidden md:block flex-1 max-w-md">
            <AddressSearchInput municipalities={municipalities} onAddressSelected={handleAddressSelected} />
          </div>
          {loading && (
            <div className="flex items-center gap-2 text-xs md:text-sm text-gray-500">
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="hidden sm:inline">Laden…</span>
            </div>
          )}
          <div className="hidden lg:flex gap-2 ml-auto">
            <button
              onClick={() => setShowShare(true)}
              className="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition"
            >
              Delen
            </button>
            <button
              onClick={() => setShowAbout(true)}
              className="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition"
            >
              Over
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <div className="flex-1 flex overflow-hidden relative">
        {mobileSidebarOpen && (
          <div className="md:hidden fixed inset-0 bg-black/50 z-30" onClick={() => setMobileSidebarOpen(false)} />
        )}
        <aside
          className={`fixed md:relative inset-y-0 left-0 z-40 md:z-auto w-[85vw] max-w-[320px] md:w-80
            bg-gray-50 p-3 md:p-4 overflow-y-auto space-y-3 md:space-y-4
            transform transition-transform duration-300 ease-in-out
            ${mobileSidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"} shadow-xl md:shadow-none`}
        >
          <StatsPanel gemeente={gemeenteName} chargeFeatures={chargeFeatures} />
          <FilterPanel
            filters={filters}
            onChange={setFilters}
            passengerCount={passengerCount}
            freightCount={freightCount}
          />
          {isNational && (
            <p className="text-xs text-gray-500 px-1">
              Landelijk overzicht: alle laadpunten worden getoond zonder details. Kies een gemeente om
              details (laadpunten, connectoren, tarieven) te laden.
            </p>
          )}
        </aside>

        <main className="flex-1 relative">
          <MapDeck
            chargeFeatures={chargeFeatures}
            boundaryFeatures={boundaryFeatures}
            bounds={bounds}
            filters={filters}
            selectedLocationId={selected?.properties.locationId ?? null}
            onSelect={setSelected}
          />

          <LocationDetailPanel
            selected={selected}
            detail={selectedDetail}
            loading={false}
            onClose={() => setSelected(null)}
          />

          {/* Mobile filter button */}
          <button
            onClick={() => setMobileSidebarOpen(true)}
            className="md:hidden fixed bottom-6 left-4 z-20 bg-blue-600 text-white px-4 py-3 rounded-full shadow-lg hover:bg-blue-700 transition text-sm font-medium"
          >
            Filters & stats
          </button>
        </main>
      </div>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 px-3 md:px-4 py-2">
        <div className="max-w-7xl mx-auto flex justify-between items-center text-xs text-gray-500">
          <button onClick={() => setShowAbout(true)} className="text-blue-600 hover:underline">
            Info over databronnen
          </button>
          <span>Bronnen: NDW OCPI · PDOK/CBS · Open Charge Map</span>
        </div>
      </footer>

      <AboutModal isOpen={showAbout} onClose={() => setShowAbout(false)} />
      <ShareModal
        isOpen={showShare}
        onClose={() => setShowShare(false)}
        municipality={selectedMunicipality}
        municipalityName={municipalities.find((m) => m.slug === selectedMunicipality)?.name || selectedMunicipality}
      />
    </div>
  );
}
