import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  BUILTIN_PROFILES, MACHINE_FACTORY, GEN3D_PRINTER_ID, type PrinterProfile,
} from "@/lib/printer-profiles";
import { uuid } from "@/lib/uuid";
import { useExportStore } from "@/stores/exportStore";

/** Fields a user can set when creating/editing a custom printer. */
export type PrinterDraft = Omit<PrinterProfile, "id" | "builtIn">;

interface PrinterStore {
  /** User-created printers (persisted). Built-ins are merged in at read time. */
  customPrinters: PrinterProfile[];
  selectedId: string;
  managerOpen: boolean;
  machineModalOpen: boolean;
  /** Saved default for the editable machine profile — the "Reset to default" target. */
  savedDefaultMachine: PrinterProfile;

  selectPrinter: (id: string) => void;
  addPrinter: (data: PrinterDraft) => string;
  updatePrinter: (id: string, patch: Partial<PrinterDraft>) => void;
  deletePrinter: (id: string) => void;
  openManager: () => void;
  closeManager: () => void;
  openMachineSettings: () => void;
  closeMachineSettings: () => void;
  /** Persist the active editable printer as the new default. */
  saveMachineAsDefault: () => void;
  /** Revert the active editable printer to the saved default. */
  resetMachineToDefault: () => void;
  /** Revert the active printer AND the saved default to the factory Gen 3D profile. */
  resetMachineToFactory: () => void;
}

/** Gen 3D printer (editable default) listed first, then the read-only presets. */
function allPrinters(custom: PrinterProfile[]): PrinterProfile[] {
  const gen3d = custom.find((p) => p.id === GEN3D_PRINTER_ID);
  const rest = custom.filter((p) => p.id !== GEN3D_PRINTER_ID);
  return [...(gen3d ? [gen3d] : []), ...BUILTIN_PROFILES, ...rest];
}

function resolve(id: string, custom: PrinterProfile[]): PrinterProfile {
  const list = allPrinters(custom);
  return list.find((p) => p.id === id) ?? list[0];
}

/** Push a printer's slicer defaults into the export store so the slicer + backend follow. */
function syncExport(p: PrinterProfile) {
  const ex = useExportStore.getState();
  ex.setPresetId(p.id);
  ex.updateSettings({
    printingTemperature: p.nozzleTemp,
    buildPlateTemperature: p.bedTemp,
    buildPlateTemperatureInitialLayer: p.bedTemp,
    printSpeed: p.printSpeed,
  });
}

/** Whether the active machine profile differs from the saved default (ignores id/builtIn). */
export function isMachineDirty(active: PrinterProfile, saved: PrinterProfile): boolean {
  const keys = new Set<keyof PrinterProfile>([
    ...(Object.keys(active) as (keyof PrinterProfile)[]),
    ...(Object.keys(saved) as (keyof PrinterProfile)[]),
  ]);
  keys.delete("id");
  keys.delete("builtIn");
  for (const k of keys) if (active[k] !== saved[k]) return true;
  return false;
}

export const usePrinterStore = create<PrinterStore>()(
  persist(
    (set, get) => ({
      customPrinters: [{ ...MACHINE_FACTORY }],
      selectedId: GEN3D_PRINTER_ID,
      managerOpen: false,
      machineModalOpen: false,
      savedDefaultMachine: { ...MACHINE_FACTORY },

      selectPrinter: (id) => {
        const p = resolve(id, get().customPrinters);
        set({ selectedId: p.id });
        syncExport(p);
      },

      addPrinter: (data) => {
        const id = uuid();
        const printer: PrinterProfile = { ...data, id, builtIn: false };
        set((s) => ({ customPrinters: [...s.customPrinters, printer], selectedId: id }));
        syncExport(printer);
        return id;
      },

      updatePrinter: (id, patch) =>
        set((s) => {
          const customPrinters = s.customPrinters.map((p) =>
            p.id === id ? { ...p, ...patch } : p,
          );
          // If the edited printer is selected, re-sync slicer defaults to the new values.
          if (s.selectedId === id) {
            const updated = customPrinters.find((p) => p.id === id);
            if (updated) syncExport(updated);
          }
          return { customPrinters };
        }),

      deletePrinter: (id) =>
        set((s) => {
          // The Gen 3D default is not deletable.
          if (id === GEN3D_PRINTER_ID) return s;
          const customPrinters = s.customPrinters.filter((p) => p.id !== id);
          let selectedId = s.selectedId;
          if (selectedId === id) {
            const fallback = resolve(GEN3D_PRINTER_ID, customPrinters);
            selectedId = fallback.id;
            syncExport(fallback);
          }
          return { customPrinters, selectedId };
        }),

      openManager: () => set({ managerOpen: true }),
      closeManager: () => set({ managerOpen: false }),
      openMachineSettings: () => set({ machineModalOpen: true }),
      closeMachineSettings: () => set({ machineModalOpen: false }),

      saveMachineAsDefault: () =>
        set((s) => {
          const active = resolve(s.selectedId, s.customPrinters);
          return { savedDefaultMachine: { ...active } };
        }),

      resetMachineToDefault: () =>
        set((s) => {
          const def = s.savedDefaultMachine;
          const customPrinters = s.customPrinters.map((p) =>
            p.id === s.selectedId ? { ...def, id: p.id, builtIn: p.builtIn } : p,
          );
          const updated = customPrinters.find((p) => p.id === s.selectedId);
          if (updated) syncExport(updated);
          return { customPrinters };
        }),

      resetMachineToFactory: () =>
        set((s) => {
          const customPrinters = s.customPrinters.map((p) =>
            p.id === GEN3D_PRINTER_ID ? { ...MACHINE_FACTORY } : p,
          );
          // Ensure the gen3d printer exists.
          if (!customPrinters.some((p) => p.id === GEN3D_PRINTER_ID)) {
            customPrinters.unshift({ ...MACHINE_FACTORY });
          }
          if (s.selectedId === GEN3D_PRINTER_ID) syncExport(MACHINE_FACTORY);
          return { customPrinters, savedDefaultMachine: { ...MACHINE_FACTORY } };
        }),
    }),
    {
      name: "g3d-printers",
      // Persist only user data — built-ins and transient UI state stay out of storage.
      partialize: (s) => ({
        customPrinters: s.customPrinters,
        selectedId: s.selectedId,
        savedDefaultMachine: s.savedDefaultMachine,
      }),
      // Ensure the Gen 3D default always exists and the saved default is present.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<PrinterStore>;
        const customPrinters = p.customPrinters ? [...p.customPrinters] : [];
        if (!customPrinters.some((cp) => cp.id === GEN3D_PRINTER_ID)) {
          customPrinters.unshift({ ...MACHINE_FACTORY });
        }
        return {
          ...current,
          ...p,
          customPrinters,
          savedDefaultMachine: p.savedDefaultMachine ?? { ...MACHINE_FACTORY },
          selectedId: p.selectedId ?? GEN3D_PRINTER_ID,
        };
      },
    },
  ),
);

/** Non-React read of the active printer (for hooks/event handlers). */
export function getSelectedPrinter(): PrinterProfile {
  const { selectedId, customPrinters } = usePrinterStore.getState();
  return resolve(selectedId, customPrinters);
}

/** All printers: Gen 3D default, built-ins, then the user's custom ones. */
export function useAllPrinters(): PrinterProfile[] {
  const custom = usePrinterStore((s) => s.customPrinters);
  return useMemo(() => allPrinters(custom), [custom]);
}

/** The currently selected printer profile, resolved against the full list. */
export function useSelectedPrinter(): PrinterProfile {
  const selectedId = usePrinterStore((s) => s.selectedId);
  const custom = usePrinterStore((s) => s.customPrinters);
  return useMemo(() => resolve(selectedId, custom), [selectedId, custom]);
}
