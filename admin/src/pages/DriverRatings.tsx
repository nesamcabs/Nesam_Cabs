import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useDrivers } from "../hooks/useOfficeData";
import { useCanDo } from "../components/AccessContext";
import { ErrorBanner, Modal, Toast, useToast } from "../components/Feedback";
import { Badge, Button, DataTable, EmptyState, Icon, KpiCard, KpiGrid, PageHeader, Tabs } from "../components/ui";
import type { BadgeTone } from "../components/ui/Badge";
import { DriverRatingActionError, setRatingFollowUp, subscribeDriverRatings } from "../services/driverRatingService";
import {
  FOLLOW_UPS, LOW_RATING_MAX, ratingsCsv, reasonCounts, summariseDrivers, summariseFleet, toMillis,
  type DriverRating, type DriverSummary, type FollowUp, type Standing,
} from "../domain/driverRatings";
import { formatDateTime12 } from "../utils/time";

type Tab = "drivers" | "followup" | "all";
type Sort = "lowest" | "highest" | "most" | "low" | "recent";

const STANDING_TONE: Record<Standing, BadgeTone> = { Excellent: "green", Good: "blue", Watch: "amber", "At risk": "red", "Not rated": "neutral" };
const FOLLOW_TONE: Record<FollowUp, BadgeTone> = { None: "neutral", New: "red", "In review": "amber", Resolved: "green", Dismissed: "neutral" };
const PAGE = 100;

const when = (v: unknown) => { const t = toMillis(v); return t ? formatDateTime12(new Date(t)) : "—"; };
const avg = (n: number) => (n > 0 ? n.toFixed(1) : "—");

function Stars({ value, label }: { value: number; label?: string }) {
  const full = Math.round(value);
  return (
    <span className="ds-stars" role="img" aria-label={label ?? `${value.toFixed(1)} out of 5 stars`}>
      {"★".repeat(full)}<span>{"★".repeat(5 - full)}</span>
    </span>
  );
}

/** Five thin bars, 5 stars on top: how a driver's ratings are spread. */
function Spread({ row }: { row: DriverSummary }) {
  const max = Math.max(1, ...Object.values(row.breakdown));
  return (
    <div className="ds-spread" role="img" aria-label={([5, 4, 3, 2, 1] as const).map((s) => `${row.breakdown[s]} at ${s} stars`).join(", ")}>
      {([5, 4, 3, 2, 1] as const).map((s) => (
        <div key={s} className="ds-spread__row" data-low={s <= LOW_RATING_MAX ? "true" : undefined}>
          <small>{s}</small>
          <span><i style={{ width: `${(row.breakdown[s] / max) * 100}%` }} /></span>
          <small>{row.breakdown[s]}</small>
        </div>
      ))}
    </div>
  );
}

/** Every driver's star ratings, the reasons behind low ones, and the office's follow-up. */
export default function DriverRatings({ onOpenBooking }: { onOpenBooking?: (id: string) => void }) {
  const [ratings, setRatings] = useState<DriverRating[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("drivers");
  const [query, setQuery] = useState("");
  const [standing, setStanding] = useState<"All" | Standing>("All");
  const [sort, setSort] = useState<Sort>("lowest");
  const [stars, setStars] = useState("All");
  const [source, setSource] = useState("All");
  const [follow, setFollow] = useState("All");
  const [limit, setLimit] = useState(PAGE);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [openRating, setOpenRating] = useState<DriverRating | null>(null);
  const drivers = useDrivers();
  const canAct = useCanDo("Support", "edit");
  const { toast, show } = useToast(6000);

  useEffect(() => subscribeDriverRatings(setRatings, setError), []);
  useEffect(() => setLimit(PAGE), [tab, query, stars, source, follow]);

  const list = ratings ?? [];
  const rows = useMemo(() => summariseDrivers(list, drivers.rows ?? []), [list, drivers.rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const fleet = useMemo(() => summariseFleet(rows, list), [rows, list]);
  const reasons = useMemo(() => reasonCounts(list), [list]);
  const open = list.filter((r) => r.low && (r.followUp === "New" || r.followUp === "In review"));

  const q = query.trim().toLowerCase();
  const driverRows = useMemo(() => {
    const out = rows.filter((r) => (standing === "All" || r.standing === standing) && (!q || `${r.name} ${r.phone} ${r.vehicleNumber}`.toLowerCase().includes(q)));
    const by: Record<Sort, (a: DriverSummary, b: DriverSummary) => number> = {
      // Unrated drivers sort last in both directions: there is nothing to rank them by.
      lowest: (a, b) => (a.count ? a.average : 9) - (b.count ? b.average : 9) || b.count - a.count,
      highest: (a, b) => (b.count ? b.average : -1) - (a.count ? a.average : -1) || b.count - a.count,
      most: (a, b) => b.count - a.count,
      low: (a, b) => b.low - a.low || b.open - a.open,
      recent: (a, b) => (b.lastRatedAt ?? 0) - (a.lastRatedAt ?? 0),
    };
    return [...out].sort(by[sort]);
  }, [rows, standing, q, sort]);

  const ratingRows = useMemo(() => list.filter((r) => {
    if (tab === "followup" && !(r.low && (r.followUp === "New" || r.followUp === "In review"))) return false;
    if (stars !== "All" && r.stars !== Number(stars)) return false;
    if (source !== "All" && r.source !== source) return false;
    if (follow !== "All" && r.followUp !== follow) return false;
    return !q || `${r.driverName} ${r.customerName} ${r.tripCode} ${r.vehicleNumber} ${r.reason} ${r.feedback}`.toLowerCase().includes(q);
  }), [list, tab, stars, source, follow, q]);

  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob(["﻿", ratingsCsv(ratingRows)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `driver-ratings-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const selected = driverId ? rows.find((r) => r.driverId === driverId) ?? null : null;
  const loading = ratings === null && !error;

  return (
    <div className="ds-page-body">
      <Toast toast={toast} />
      {error && <ErrorBanner message={error} />}
      <PageHeader title="Driver ratings" actions={tab !== "drivers" ? <Button icon="download" onClick={exportCsv} disabled={ratingRows.length === 0}>Export CSV</Button> : undefined} />

      <KpiGrid>
        <KpiCard icon="star" label="Fleet average" value={avg(fleet.average)} note={`${fleet.ratings.toLocaleString("en-IN")} ratings · ${fleet.ratedDrivers} of ${fleet.drivers} drivers rated`} />
        <KpiCard icon="triangle-alert" label="Needs follow-up" value={fleet.openFollowUps} note={`${fleet.lowRatings} low ratings (${LOW_RATING_MAX} stars or fewer)`} onClick={() => setTab("followup")} />
        <KpiCard icon="user-round-check" label="Drivers at risk" value={fleet.atRisk} note="Average under 3.5, or 30%+ low ratings" onClick={() => { setTab("drivers"); setStanding("At risk"); }} />
        <KpiCard icon="message-square" label="Top complaint" value={reasons[0]?.reason ?? "None yet"} note={reasons[0] ? `${reasons[0].count} low rating${reasons[0].count === 1 ? "" : "s"}` : "Low ratings give a reason"} />
      </KpiGrid>

      <Tabs
        label="Driver ratings views"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "drivers", label: "By driver", count: rows.length, icon: "user-round-check" },
          { id: "followup", label: "Needs follow-up", count: open.length, tone: open.length ? "red" : undefined, icon: "triangle-alert" },
          { id: "all", label: "All ratings", count: list.length, icon: "star" },
        ]}
      />

      <div className="ds-filterbar">
        <label className="ds-field" style={{ minWidth: 260 }}><span>Search</span><input className="ds-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tab === "drivers" ? "Driver, phone or vehicle" : "Driver, customer, trip or feedback"} /></label>
        {tab === "drivers" ? (
          <>
            <label className="ds-field"><span>Standing</span><select className="ds-select" value={standing} onChange={(e) => setStanding(e.target.value as typeof standing)}>{(["All", "Excellent", "Good", "Watch", "At risk", "Not rated"] as const).map((s) => <option key={s}>{s}</option>)}</select></label>
            <label className="ds-field"><span>Sort by</span><select className="ds-select" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="lowest">Lowest rated first</option><option value="highest">Highest rated first</option><option value="most">Most ratings</option><option value="low">Most low ratings</option><option value="recent">Recently rated</option>
            </select></label>
          </>
        ) : (
          <>
            <label className="ds-field"><span>Stars</span><select className="ds-select" value={stars} onChange={(e) => setStars(e.target.value)}><option>All</option>{[1, 2, 3, 4, 5].map((s) => <option key={s} value={s}>{s} star{s > 1 ? "s" : ""}</option>)}</select></label>
            <label className="ds-field"><span>Trip type</span><select className="ds-select" value={source} onChange={(e) => setSource(e.target.value)}><option value="All">All</option><option value="booking">Booking</option><option value="local_taxi">Local Taxi</option></select></label>
            {tab === "all" && <label className="ds-field"><span>Follow-up</span><select className="ds-select" value={follow} onChange={(e) => setFollow(e.target.value)}><option>All</option>{["None", ...FOLLOW_UPS].map((f) => <option key={f}>{f}</option>)}</select></label>}
          </>
        )}
      </div>

      {loading ? <p className="text-[12px] text-muted">Loading ratings…</p> : tab === "drivers" ? (
        <>
          <div className="ds-toolbar-count"><strong>{driverRows.length} driver{driverRows.length === 1 ? "" : "s"}</strong></div>
          {driverRows.length === 0 ? <div className="ds-panel"><EmptyState title={rows.length ? "No drivers match" : "No drivers yet"} hint={rows.length ? "Try another search or standing." : "Drivers appear here once they are added."} /></div> : (
            <DataTable label="Driver ratings by driver" minWidth={1040} fixed hasActions>
              <colgroup><col style={{ width: 230 }} /><col style={{ width: 140 }} /><col style={{ width: 160 }} /><col style={{ width: 110 }} /><col style={{ width: 120 }} /><col style={{ width: 120 }} /><col style={{ width: 130 }} /><col style={{ width: 110 }} /></colgroup>
              <thead><tr><th>DRIVER</th><th>RATING</th><th>SPREAD</th><th className="ds-num">LOW (≤{LOW_RATING_MAX}★)</th><th className="ds-num">LAST 30 DAYS</th><th>STANDING</th><th>LAST RATED</th><th className="ds-actions">ACTION</th></tr></thead>
              <tbody>{driverRows.map((r) => (
                <tr key={r.driverId} className="ds-row-stripe" data-tone={r.standing === "At risk" ? "red" : r.standing === "Watch" ? "amber" : undefined}>
                  <td><strong>{r.name}</strong><small>{r.vehicleNumber || "No vehicle"}{r.isVendorDriver ? " · Vendor driver" : ""}</small>{r.phone && <small>{r.phone}</small>}</td>
                  <td>{r.count ? <><strong className="ds-rating-num">{avg(r.average)}</strong> <Stars value={r.average} /><small>{r.count} rating{r.count === 1 ? "" : "s"}</small></> : <small>No ratings yet</small>}</td>
                  <td>{r.count ? <Spread row={r} /> : <small>—</small>}</td>
                  <td className="ds-num">{r.low ? <><strong>{r.low}</strong><small>{Math.round(r.lowShare * 100)}%{r.open ? ` · ${r.open} open` : ""}</small></> : "0"}</td>
                  <td className="ds-num">{r.last30Average != null ? <><strong>{avg(r.last30Average)}</strong><small>{r.last30Count} rating{r.last30Count === 1 ? "" : "s"}</small></> : "—"}</td>
                  <td><Badge tone={STANDING_TONE[r.standing]}>{r.standing}</Badge></td>
                  <td><small style={{ display: "block" }}>{r.lastRatedAt ? when(r.lastRatedAt) : "—"}</small></td>
                  <td className="ds-actions"><div><Button size="sm" onClick={() => setDriverId(r.driverId)}>View</Button></div></td>
                </tr>
              ))}</tbody>
            </DataTable>
          )}
        </>
      ) : (
        <>
          <div className="ds-toolbar-count"><strong>{ratingRows.length} rating{ratingRows.length === 1 ? "" : "s"}</strong></div>
          {ratingRows.length === 0 ? <div className="ds-panel"><EmptyState title={tab === "followup" ? "Nothing needs follow-up" : "No ratings match"} hint={tab === "followup" ? "Low ratings appear here until someone follows up." : "Ratings appear here when customers rate a finished trip."} /></div> : (
            <>
              <RatingsTable rows={ratingRows.slice(0, limit)} onOpen={setOpenRating} onDriver={setDriverId} />
              {ratingRows.length > limit && <div className="mt-3"><Button onClick={() => setLimit((n) => n + PAGE)}>Show more ({ratingRows.length - limit} left)</Button></div>}
            </>
          )}
        </>
      )}
      <p className="ds-note mt-4">Customers are asked to rate their driver when a trip ends. A rating of {LOW_RATING_MAX} stars or fewer must include a reason and what went wrong, and is listed under Needs follow-up. The newest {list.length >= 2000 ? "2,000" : "ratings"} are listed here; every driver&apos;s average still counts all of their ratings.</p>

      {selected && <DriverSheet row={selected} ratings={list.filter((r) => r.driverId === selected.driverId)} onOpen={setOpenRating} onClose={() => setDriverId(null)} />}
      {openRating && <RatingSheet rating={openRating} canAct={canAct} onOpenBooking={onOpenBooking} onClose={() => setOpenRating(null)} onDone={(t) => { setOpenRating(null); show(t); }} />}
    </div>
  );
}

function RatingsTable({ rows, onOpen, onDriver }: { rows: DriverRating[]; onOpen: (r: DriverRating) => void; onDriver: (id: string) => void }) {
  return (
    <DataTable label="Driver ratings" minWidth={1040} fixed hasActions>
      <colgroup><col style={{ width: 150 }} /><col style={{ width: 170 }} /><col style={{ width: 150 }} /><col style={{ width: 110 }} /><col style={{ width: 280 }} /><col style={{ width: 120 }} /><col style={{ width: 100 }} /></colgroup>
      <thead><tr><th>DATE</th><th>DRIVER</th><th>CUSTOMER</th><th>RATING</th><th>REASON / FEEDBACK</th><th>FOLLOW-UP</th><th className="ds-actions">ACTION</th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.id} className="ds-row-stripe" data-tone={r.low && (r.followUp === "New" || r.followUp === "In review") ? "red" : undefined}>
          <td><strong>{when(r.createdAt)}</strong><small>{r.tripCode}{r.source === "local_taxi" ? " · Local Taxi" : ""}</small></td>
          <td><button type="button" className="ds-link" onClick={() => r.driverId && onDriver(r.driverId)}><strong>{r.driverName || "Unassigned"}</strong></button><small>{r.vehicleNumber}</small></td>
          <td><strong>{r.customerName || "Customer"}</strong><small>{r.serviceName}</small></td>
          <td><Stars value={r.stars} label={`${r.stars} out of 5 stars`} /></td>
          <td>{r.low ? <><span className="ds-cell-clip"><strong>{r.reason || "No reason given"}</strong></span><span className="ds-cell-clip">{r.feedback}</span></> : <span className="ds-cell-clip">{[r.tags.join(", "), r.comment].filter(Boolean).join(" — ") || <small>No comment</small>}</span>}</td>
          <td>{r.low ? <Badge tone={FOLLOW_TONE[r.followUp]}>{r.followUp === "None" ? "New" : r.followUp}</Badge> : <small>Not needed</small>}</td>
          <td className="ds-actions"><div><Button size="sm" onClick={() => onOpen(r)}>{r.low ? "Follow up" : "View"}</Button></div></td>
        </tr>
      ))}</tbody>
    </DataTable>
  );
}

function DriverSheet({ row, ratings, onOpen, onClose }: { row: DriverSummary; ratings: DriverRating[]; onOpen: (r: DriverRating) => void; onClose: () => void }) {
  const [only, setOnly] = useState<"all" | "low">("all");
  const shown = ratings.filter((r) => only === "all" || r.low);
  return (
    <Modal title={row.name} subtitle={`${row.vehicleNumber || "No vehicle"}${row.phone ? ` · ${row.phone}` : ""}`} eyebrow="Driver ratings" onClose={onClose} size="xl">
      <dl className="ds-facts" data-cols={4}>
        <div><dt>Average rating</dt><dd>{row.count ? <><strong className="ds-rating-num">{avg(row.average)}</strong> <Stars value={row.average} /></> : "Not rated yet"}</dd></div>
        <div><dt>Ratings</dt><dd>{row.count}{row.records < row.count ? ` (${row.records} listed here)` : ""}</dd></div>
        <div><dt>Low ratings (≤{LOW_RATING_MAX}★)</dt><dd>{row.low} · {Math.round(row.lowShare * 100)}%</dd></div>
        <div><dt>Standing</dt><dd><Badge tone={STANDING_TONE[row.standing]}>{row.standing}</Badge></dd></div>
      </dl>
      {row.count > 0 && (
        <div className="grid gap-5 mt-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
          <div><h3 className="text-[13px] font-bold text-ink mb-2">How the ratings are spread</h3><Spread row={row} /></div>
          <div>
            <h3 className="text-[13px] font-bold text-ink mb-2">Why customers rated low</h3>
            {row.topReasons.length ? <ul className="ds-reasons">{row.topReasons.map((t) => <li key={t.reason}><span>{t.reason}</span><strong>{t.count}</strong></li>)}</ul> : <small>No low ratings with a reason.</small>}
          </div>
          <div><h3 className="text-[13px] font-bold text-ink mb-2">Last 30 days</h3>{row.last30Average != null ? <p><strong className="ds-rating-num">{avg(row.last30Average)}</strong> <Stars value={row.last30Average} /> <small>from {row.last30Count} rating{row.last30Count === 1 ? "" : "s"}</small></p> : <small>No ratings in the last 30 days.</small>}</div>
        </div>
      )}
      <div className="flex items-center justify-between mt-5 mb-2">
        <h3 className="text-[13px] font-bold text-ink">Ratings</h3>
        <div className="flex gap-2"><Button size="sm" variant={only === "all" ? "primary" : "secondary"} onClick={() => setOnly("all")}>All ({ratings.length})</Button><Button size="sm" variant={only === "low" ? "primary" : "secondary"} onClick={() => setOnly("low")}>Low only ({ratings.filter((r) => r.low).length})</Button></div>
      </div>
      {shown.length === 0 ? <div className="ds-panel"><EmptyState title="No ratings to show" hint="Ratings appear here after customers rate their trips." /></div> : <RatingsTable rows={shown.slice(0, 200)} onOpen={onOpen} onDriver={() => {}} />}
    </Modal>
  );
}

function RatingSheet({ rating: r, canAct, onOpenBooking, onClose, onDone }: { rating: DriverRating; canAct: boolean; onOpenBooking?: (id: string) => void; onClose: () => void; onDone: (text: string) => void }) {
  const [status, setStatus] = useState<Exclude<FollowUp, "None">>(r.followUp === "None" ? "New" : r.followUp);
  const [note, setNote] = useState(r.adminNote);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsNote = status === "Resolved" || status === "Dismissed";
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (needsNote && note.trim().length < 3) return setError("Add a short note saying what was done.");
    setBusy(true);
    setError(null);
    try {
      await setRatingFollowUp(r.id, status, note);
      onDone(`Follow-up saved as ${status}.`);
    } catch (err) {
      setError(err instanceof DriverRatingActionError ? err.message : "The follow-up was not saved. Check your connection and try again.");
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`${r.stars}-star rating · ${r.driverName || "Driver"}`}
      subtitle={`${r.tripCode}${r.source === "local_taxi" ? " · Local Taxi" : ""} · ${when(r.createdAt)}`}
      eyebrow={r.low ? "Low rating" : "Rating"}
      onClose={onClose}
      busy={busy}
      footer={r.low && canAct ? <Button variant="primary" type="submit" form="rating-follow-up" loading={busy}>Save follow-up</Button> : undefined}
    >
      <dl className="ds-facts" data-cols={2}>
        <div><dt>Rating</dt><dd><Stars value={r.stars} label={`${r.stars} out of 5 stars`} /></dd></div>
        <div><dt>Service</dt><dd>{r.serviceName || "—"}</dd></div>
        <div><dt>Driver</dt><dd>{r.driverName || "—"}{r.vehicleNumber ? ` · ${r.vehicleNumber}` : ""}</dd></div>
        <div><dt>Customer</dt><dd>{r.customerName || "—"}{r.customerPhone ? ` · ${r.customerPhone}` : ""}</dd></div>
        {r.low ? (
          <>
            <div style={{ gridColumn: "1 / -1" }}><dt>Reason given</dt><dd>{r.reason || "—"}</dd></div>
            <div style={{ gridColumn: "1 / -1" }}><dt>What happened</dt><dd>{r.feedback || "—"}</dd></div>
            <div style={{ gridColumn: "1 / -1" }}><dt>What the customer would improve</dt><dd>{r.improvements || "Nothing added"}</dd></div>
          </>
        ) : (
          <>
            {r.tags.length > 0 && <div style={{ gridColumn: "1 / -1" }}><dt>Tags</dt><dd>{r.tags.join(", ")}</dd></div>}
            <div style={{ gridColumn: "1 / -1" }}><dt>Comment</dt><dd>{r.comment || "No comment"}</dd></div>
          </>
        )}
        {r.handledByName && <div style={{ gridColumn: "1 / -1" }}><dt>Last handled</dt><dd>{r.handledByName} · {when(r.handledAt)}</dd></div>}
      </dl>
      {r.bookingId && onOpenBooking && <div className="mt-3"><Button icon="external-link" onClick={() => { onClose(); onOpenBooking(r.bookingId); }}>Open booking</Button></div>}
      {r.low && (
        <form id="rating-follow-up" onSubmit={save} className="grid gap-3 mt-5" noValidate>
          <h3 className="text-[13px] font-bold text-ink">Office follow-up</h3>
          {error && <div className="ds-error" role="alert"><Icon name="circle-alert" />{error}</div>}
          {!canAct && <p className="ds-note">Your access can read this rating but not change the follow-up.</p>}
          <label className="ds-field"><span>Status</span><select className="ds-select" value={status} disabled={!canAct} onChange={(e) => setStatus(e.target.value as typeof status)}>{FOLLOW_UPS.map((f) => <option key={f}>{f}</option>)}</select></label>
          <label className="ds-field"><span>Note {needsNote ? "(required)" : "(optional)"} · what you did or decided</span><textarea className="ds-input" rows={3} maxLength={500} disabled={!canAct} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Spoke to the driver; warning recorded. Customer called back." /></label>
        </form>
      )}
    </Modal>
  );
}
