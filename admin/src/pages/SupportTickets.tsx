import { useState, useEffect } from "react";
import { callFunction } from "../services/callables";
import {
  subscribeToCollection,
  updateFirestoreDocument,
} from "../services/adminFirestoreService";

const SUPPORT_COLLECTION = "support_tickets";

const statusColor: Record<string, string> = {
  Open: "bg-yellow-50 text-yellow-700 border-yellow-200",
  "In Progress": "bg-blue-50 text-blue-700 border-blue-200",
  Resolved: "bg-green-50 text-green-700 border-green-200",
  Closed: "bg-gray-50 text-gray-600 border-gray-200",
};

export default function SupportTickets() {
  const [tickets, setTickets] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribeToCollection<any>(SUPPORT_COLLECTION, setTickets, setError);
    return () => unsub();
  }, []);

  const displayTickets = tickets;

  const updateStatus = async (id: string, status: string) => {
    setError(null);
    try {
      await callFunction("updateSupportRequest", { ticketId: id, status, note: "" });
    } catch {
      const ok = await updateFirestoreDocument(SUPPORT_COLLECTION, id, {
        status, updatedAt: new Date().toISOString(),
      });
      if (!ok) { setError("Ticket status was not saved. Check your access and connection, then try again."); return; }
    }
    setTickets((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, status, updatedAt: new Date().toISOString() } : item,
      ),
    );
    if (selected?.id === id) {
      setSelected((prev: any) => (prev ? { ...prev, status } : null));
    }
  };

  const filtered = displayTickets.filter((t) => {
    const matchSearch =
      search === "" ||
      (t.id && t.id.toLowerCase().includes(search.toLowerCase())) ||
      (t.customerName &&
        t.customerName.toLowerCase().includes(search.toLowerCase())) ||
      (t.description &&
        t.description.toLowerCase().includes(search.toLowerCase())) ||
      (t.message && t.message.toLowerCase().includes(search.toLowerCase()));
    const matchStatus = statusFilter === "All" || t.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const openCount = displayTickets.filter(
    (t) => t.status === "Open" || !t.status,
  ).length;

  return (
    <div className="p-6 space-y-5">
      {error && <div role="alert" className="ds-error">{error}</div>}
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-bold text-ink">Support Tickets</h1>
          <p className="text-[13px] text-faint mt-0.5">
            {openCount} open ticket{openCount !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total", value: displayTickets.length, color: "#c1232c" },
          {
            label: "Open",
            value: displayTickets.filter((t) => t.status === "Open" || !t.status)
              .length,
            color: "#F59E0B",
          },
          {
            label: "In Progress",
            value: displayTickets.filter((t) => t.status === "In Progress").length,
            color: "#3B82F6",
          },
          {
            label: "Resolved",
            value: displayTickets.filter((t) => t.status === "Resolved").length,
            color: "#10B981",
          },
        ].map((s) => (
          <div
            key={s.label}
            className="bg-white rounded-xl border border-line p-4 shadow-sm"
          >
            <div className="text-[11px] font-semibold text-faint uppercase tracking-wide mb-1">
              {s.label}
            </div>
            <div className="text-[22px] font-bold" style={{ color: s.color }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tickets…"
          className="px-3 py-2 text-[13px] border border-line rounded-lg focus:outline-none focus:border-brand w-60"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 text-[13px] border border-line rounded-lg focus:outline-none focus:border-brand"
        >
          {["All", "Open", "In Progress", "Resolved", "Closed"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-line shadow-sm overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="bg-surface-2 border-b border-line">
            <tr>
              {[
                "Ticket ID",
                "Customer",
                "Category",
                "Description",
                "Status",
                "Created",
                "Actions",
              ].map((h) => (
                <th
                  key={h}
                  className="text-left px-4 py-3 font-semibold text-muted text-[11px] uppercase tracking-wide"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-hover">
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-12 text-center text-faint text-[13px]"
                >
                  <div className="font-medium text-gray-700 mb-2">
                    {search || statusFilter !== "All"
                      ? "No tickets match your filters."
                      : "No support tickets on record."}
                  </div>
                </td>
              </tr>
            )}
            {filtered.map((t) => (
              <tr
                key={t.id}
                className="hover:bg-surface-2 cursor-pointer transition-colors"
                onClick={() => setSelected(t)}
              >
                <td className="px-4 py-3 font-mono text-[11px] text-muted">
                  {t.id}
                </td>
                <td className="px-4 py-3 font-semibold text-ink">
                  {t.customerName || "Customer"}
                </td>
                <td className="px-4 py-3 text-muted">
                  {t.category || "General"}
                </td>
                <td className="px-4 py-3 text-muted max-w-[220px] truncate">
                  {t.description || t.message || "—"}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold border ${statusColor[t.status] || statusColor["Open"]}`}
                  >
                    {t.status || "Open"}
                  </span>
                </td>
                <td className="px-4 py-3 text-faint text-[11px]">
                  {t.createdAt
                    ? typeof t.createdAt === "string"
                      ? t.createdAt.split("T")[0]
                      : new Date(
                          t.createdAt?.seconds * 1000,
                        ).toLocaleDateString("en-IN")
                    : "—"}
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    {t.status !== "Resolved" && t.status !== "Closed" && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const next =
                            t.status === "Open" || !t.status
                              ? "In Progress"
                              : "Resolved";
                          updateStatus(t.id, next);
                        }}
                        className="px-2 py-1 text-[11px] font-semibold text-brand border border-brand rounded hover:bg-brand hover:text-white transition-colors"
                      >
                        {t.status === "Open" || !t.status ? "Start" : "Resolve"}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Detail Modal */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start mb-4">
              <div>
                <h2 className="text-[16px] font-bold text-ink">
                  Ticket: {selected.id}
                </h2>
                <p className="text-[12px] text-faint mt-0.5">
                  {selected.customerName || "Customer"}
                </p>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="text-faint text-xl leading-none hover:text-ink"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-[13px]">
              {selected.category && (
                <div>
                  <span className="font-semibold text-muted text-[11px] uppercase tracking-wide">
                    Category
                  </span>
                  <div className="mt-0.5">{selected.category}</div>
                </div>
              )}
              <div>
                <span className="font-semibold text-muted text-[11px] uppercase tracking-wide">
                  Issue
                </span>
                <div className="mt-0.5 text-body">
                  {selected.description || selected.message || "—"}
                </div>
              </div>
              {selected.bookingId && (
                <div>
                  <span className="font-semibold text-muted text-[11px] uppercase tracking-wide">
                    Booking ID
                  </span>
                  <div className="mt-0.5 font-mono text-[12px]">
                    {selected.bookingId}
                  </div>
                </div>
              )}
              <div>
                <span className="font-semibold text-muted text-[11px] uppercase tracking-wide mb-2 block">
                  Update Status
                </span>
                <div className="flex gap-2 flex-wrap">
                  {["Open", "In Progress", "Resolved", "Closed"].map((s) => (
                    <button
                      key={s}
                      onClick={() => {
                        updateStatus(selected.id, s);
                        setSelected({ ...selected, status: s });
                      }}
                      className={`px-3 py-1.5 text-[12px] font-semibold rounded-lg border transition-colors ${
                        selected.status === s
                          ? "bg-brand text-white border-brand"
                          : "text-muted border-line hover:bg-hover"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
