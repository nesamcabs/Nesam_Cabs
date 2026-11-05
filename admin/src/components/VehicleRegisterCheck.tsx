import { useEffect, useState } from "react";
import { getVehicleLookup, type VehicleLookupView } from "../services/vendorReviewService";

/**
 * What a partner declared for a vehicle, to be compared with the national
 * vehicle register (VAHAN) record the server fetched at onboarding. The
 * comparison is a reviewer aid: a mismatch is a question to ask, never an
 * automatic rejection, because register data can lag a renewal.
 */
export interface DeclaredVehicle {
  plate: string;
  category?: string;
  insuranceUpto?: string;
  fitnessUpto?: string;
  permitUpto?: string;
}

const CATEGORY_LABEL: Record<string, string> = { "Premium SUV": "Innova Crysta" };
const label = (c?: string) => (c ? CATEGORY_LABEL[c] ?? c : "—");

function mismatches(d: DeclaredVehicle, r: VehicleLookupView["record"]): string[] {
  const out: string[] = [];
  if (d.category && r.category && d.category !== r.category) out.push(`Declared type ${label(d.category)}, register suggests ${label(r.category)}.`);
  const dates: [string, string | undefined, string][] = [
    ["Insurance", d.insuranceUpto, r.validity.insuranceUpto],
    ["FC", d.fitnessUpto, r.validity.fitnessUpto],
    ["Permit", d.permitUpto, r.validity.permitUpto],
  ];
  for (const [name, declared, register] of dates) {
    if (declared && register && declared !== register) out.push(`${name} valid till ${declared} on the document, ${register} on the register.`);
  }
  return out;
}

export function VehicleRegisterCheck({ declared }: { declared: DeclaredVehicle }) {
  const [state, setState] = useState<"loading" | "none" | "error" | "ok">("loading");
  const [view, setView] = useState<VehicleLookupView | null>(null);

  useEffect(() => {
    let alive = true;
    setState("loading");
    getVehicleLookup(declared.plate)
      .then((v) => {
        if (!alive) return;
        setView(v);
        setState(v ? "ok" : "none");
      })
      .catch(() => alive && setState("error"));
    return () => {
      alive = false;
    };
  }, [declared.plate]);

  if (state === "loading") return <div className="text-[11px] text-faint">Checking the vehicle register…</div>;
  if (state === "error") return <div className="text-[11px] text-brand">Couldn't read the vehicle register record.</div>;
  if (state === "none" || !view) {
    return (
      <div className="text-[11px] rounded-lg border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2">
        Not verified against the vehicle register. Check the RC photo against the details declared.
      </div>
    );
  }
  const r = view.record;
  const diffs = mismatches(declared, r);
  const problems: string[] = [];
  if (r.registrationActive === false) problems.push(`Registration status: ${r.registrationStatus}.`);
  if (r.usage === "private") problems.push("Listed under a private (non-transport) class.");
  const when = view.fetchedAtMs ? new Date(view.fetchedAtMs).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "";
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 space-y-1" data-testid="register-check">
      <div className="text-[11px] font-bold text-emerald-800">
        Vehicle register{when ? ` · ${when}` : ""}
      </div>
      <div className="text-[12px] text-ink font-semibold">
        {[r.make, r.model, r.variant].filter(Boolean).join(" ")} · {[r.fuelType, r.seatClass ? `${r.seatClass} seats` : "", r.manufactureYear].filter(Boolean).join(" · ")}
      </div>
      <div className="text-[11px] text-muted">
        Class {r.vehicleClass || "—"} · suggested {label(r.category)}{r.specClass ? ` (${r.specClass})` : ""} · owner {r.ownerNameMasked || "—"}
      </div>
      <div className="text-[11px] text-muted">
        Register validity: insurance {r.validity.insuranceUpto || "—"} · FC {r.validity.fitnessUpto || "—"} · permit {r.validity.permitUpto || "—"}
      </div>
      {[...problems, ...diffs].map((m) => (
        <div key={m} className="text-[11px] font-semibold text-amber-800">⚠ {m}</div>
      ))}
    </div>
  );
}
