import { useEffect, useState } from "react";
import { subscribeToCollection } from "../services/adminFirestoreService";

interface B2BPartner {
  id: string;
  name?: string;
  category?: string;
  status?: string;
}

export default function B2BIntegrations() {
  const [partners, setPartners] = useState<B2BPartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () =>
      subscribeToCollection<B2BPartner>(
        "b2b_partners",
        (data) => {
          setPartners(data);
          setError(null);
          setLoading(false);
        },
        (message) => {
          setError(message);
          setLoading(false);
        },
      ),
    [],
  );

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-ink">Corporate & B2B Partners</h1>
        <p className="text-xs text-muted">Corporate clients and travel partners that book through NESAM.</p>
      </div>

      {error && (
        <div role="alert" className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs font-semibold">
          {error}
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-xl border border-line p-12 text-center text-[13px] text-faint">
          Loading partners…
        </div>
      ) : partners.length === 0 ? (
        <div className="bg-white rounded-xl border border-line p-12 text-center">
          <p className="text-[14px] font-bold text-ink">No B2B partners found.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-line shadow-sm divide-y divide-hover">
          {partners.map((p) => (
            <div key={p.id} className="p-4 flex items-center justify-between text-[13px]">
              <div>
                <div className="font-semibold text-ink">{p.name || p.id}</div>
                <div className="text-[11px] text-faint">{p.category || "—"}</div>
              </div>
              <span className="text-[11px] font-semibold text-body">{p.status || "—"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
