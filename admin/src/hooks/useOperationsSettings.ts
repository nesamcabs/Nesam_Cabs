import { useEffect, useState } from "react";
import { subscribeToDocument } from "../services/adminFirestoreService";
import { DEFAULT_UNASSIGNED_THRESHOLDS, normalizeThresholds, type UnassignedThresholds } from "../domain/bookingFlow";

export interface OperationsSettings extends UnassignedThresholds {
  /** True once the settings document has been read (or failed to). */
  loaded: boolean;
}

/** settings/operations — the unassigned-pickup alert windows, with safe defaults. */
export function useOperationsSettings(): OperationsSettings {
  const [s, setS] = useState<OperationsSettings>({ ...DEFAULT_UNASSIGNED_THRESHOLDS, loaded: false });
  useEffect(
    () =>
      subscribeToDocument<{ unassignedAlertHours?: number; unassignedCriticalHours?: number }>(
        "settings/operations",
        (d) => setS({ ...normalizeThresholds({ warningHours: d?.unassignedAlertHours, criticalHours: d?.unassignedCriticalHours }), loaded: true }),
        () => setS((p) => ({ ...p, loaded: true })),
      ),
    [],
  );
  return s;
}
