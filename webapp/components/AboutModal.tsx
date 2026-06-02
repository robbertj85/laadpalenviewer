"use client";

import { X } from "lucide-react";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function AboutModal({ isOpen, onClose }: Props) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">Over Laadpalenviewer</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-4 space-y-4 text-sm text-gray-700">
          <p>
            Laadpalenviewer toont laadpunten in Nederland op een interactieve kaart, opgesplitst in twee lagen:
            <strong> personenauto&apos;s</strong> en <strong>logistiek/vracht</strong> (zware voertuigen en
            megawatt charging).
          </p>
          <div>
            <h3 className="font-medium text-gray-900 mb-1">Databronnen</h3>
            <ul className="list-disc list-inside space-y-1">
              <li>
                <strong>NDW DOT-NL (OCPI)</strong> — alle publiek toegankelijke laadpunten in Nederland.
                Open data via opendata.ndw.nu.
              </li>
              <li>
                <strong>Vracht/logistiek</strong> — classificatie van NDW-data op zeer hoog vermogen
                (DC ≥ 350 kW), megawatt/MCS-standaard en exploitant, aangevuld met bekende truckhubs
                (Milence, WattHub) en Open Charge Map. Reguliere snelladers (150–350 kW) voor
                personenauto&apos;s blijven in de personenauto-laag.
              </li>
              <li>
                <strong>Gemeente- en provinciegrenzen</strong> — PDOK CBS Gebiedsindelingen (WFS).
              </li>
              <li>
                <strong>Adres zoeken</strong> — PDOK Locatieserver.
              </li>
            </ul>
          </div>
          <div>
            <h3 className="font-medium text-gray-900 mb-1">Detailniveau</h3>
            <p>
              Op landelijk niveau worden alle laadpunten getoond zonder details (snel). Bij het kiezen van
              een gemeente worden alle details (laadpunten, connectoren, tarieven) direct geladen, zodat
              klikken op een marker meteen volledige informatie toont.
            </p>
          </div>
          <p className="text-xs text-gray-500">
            Classificatie en deduplicatie zijn heuristisch; controleer voor operationeel gebruik altijd de bron.
          </p>
        </div>
      </div>
    </div>
  );
}
