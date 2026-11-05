import { formatDateTime12, formatShortDateTime12, formatHourLabel } from "../utils/time";
import { useState, useEffect } from "react";
import { serverTimestamp } from "firebase/firestore";
import type { Booking } from "../types";
import {
  subscribeBookings,
  updateFirestoreDocument,
  COLLECTIONS,
} from "../services/adminFirestoreService";
import { toDate } from "../services/paymentService";
import { ConfirmDialog, ErrorBanner, Toast, useToast } from "../components/Feedback";
import { cancelBooking } from "../services/bookingOpsService";
import { tripSubStatusOf } from "../domain/bookingFlow";
import { BookingSourceBadge, bookingSourceRowCls } from "../components/booking/BookingBadges";

const when = (v: unknown) =>
  formatShortDateTime12(toDate(v)) || null;

const coords = (v: unknown): { lat: number; lng: number } | null => {
  const p = v as { lat?: unknown; lng?: unknown } | null;
  return p && typeof p.lat === "number" && typeof p.lng === "number" && Number.isFinite(p.lat) && Number.isFinite(p.lng) ? { lat: p.lat, lng: p.lng } : null;
};

const statusConfig: Record<string, { color: string; bg: string; dot: string }> =
  {
    "Trip Started": { color: "#c1232c", bg: "#FEF2F2", dot: "bg-brand" },
    "Waiting at Pickup": {
      color: "#F59E0B",
      bg: "#FFFBEB",
      dot: "bg-yellow-500",
    },
    "Going to Pickup": {
      color: "#3B82F6",
      bg: "#EFF6FF",
      dot: "bg-blue-500",
    },
    Completed: { color: "#10B981", bg: "#ECFDF5", dot: "bg-green-500" },
    Confirmed: { color: "#3B82F6", bg: "#EFF6FF", dot: "bg-blue-500" },
    Assigned: { color: "#8B5CF6", bg: "#F5F3FF", dot: "bg-purple-500" },
  };

export default function LiveTrips({ onOpenBooking }: { onOpenBooking?: (id: string) => void } = {}) {
  const [liveTripsList, setLiveTripsList] = useState<any[]>([]);
  const [selectedTrip, setSelectedTrip] = useState<string | null>(null);
  const [photoModal, setPhotoModal] = useState<{
    title: string;
    src: string;
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<{ id: string; bookingId: string } | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const { toast, show } = useToast();

  useEffect(() => {
    const unsub = subscribeBookings((bookings: Booking[]) => {
      setLoadError(null);
      const active = bookings.filter(
        (b: any) =>
          b.status === "Ongoing" ||
          b.status === "In Progress" ||
          b.status === "En Route to Pickup" ||
          b.status === "Trip Started" ||
          b.status === "Assigned",
      );
      if (active.length > 0) {
        // Driver steps: Reached Pickup → Trip Started → Trip Ended (tripSubStatusOf also reads older records).
        const SUB_LABELS: Record<string, string> = {
          "Not Started": "Going to Pickup",
          "Reached Pickup": "Waiting at Pickup",
          "Trip Started": "Trip Started",
          "Trip Ended": "Completed",
        };
        setLiveTripsList(
          active.map((a: any) => ({
            id: a.id,
            bookingId: a.bookingId || a.id,
            source: a.source,
            bookingSource: a.bookingSource || a.source,
            brand: a.brand,
            website: a.website,
            driver: a.driver || a.assignedDriverName || "Unassigned",
            vehicle: a.vehicle || a.assignedVehicleNumber || "—",
            pickup: a.pickup || a.pickupAddress || "—",
            drop: a.drop || a.dropAddress || "—",
            customerPhone: a.phone || a.customerPhone || "",
            status: a.status === "Assigned" && !a.assignedDriverId ? "Assigned" : SUB_LABELS[tripSubStatusOf(a)],
            startedAt: when(a.tripStartedAt ?? a.startedAt) ?? (a.status === "Ongoing" ? "Time not recorded" : "Not started"),
            // The position the driver app last shared (on the way, at the pickup and on the trip).
            location: coords(a.driverLocation),
            locationAt: when(a.driverLocation?.updatedAt ?? a.driverLocation?.at) ?? when(a.reachedPickupAt),
            boardingOTPVerified: !!a.boardingVerifiedAt || (a.status === "Ongoing" && !a.tripStartedAt),
            fare:
              a.fare === undefined || a.fare === null || a.fare === ""
                ? "—"
                : typeof a.fare === "number"
                  ? `₹${a.fare.toLocaleString("en-IN")}`
                  : String(a.fare).startsWith("₹")
                    ? a.fare
                    : `₹${a.fare}`,
            vendor: a.assignedVendorId ? a.assignedVendorName || a.vendor || "Vendor fleet" : a.assignedDriverId ? "Independent driver" : "—",
            driverPhone: a.driverPhone || a.assignedDriverPhone || "",
            preTrip: a.preTrip || null,
            vehicleVerification: a.vehicleVerification || null,
            hasVerificationPhotos: !!(a.driverSelfiePhoto || a.vehicleFrontPhoto || a.vehicleRearPhoto || a.vehicleInteriorPhoto),
          })),
        );
      } else {
        setLiveTripsList([]);
      }
    }, setLoadError);
    return () => unsub();
  }, []);

  const confirmCancel = async () => {
    if (!cancelTarget || cancelBusy) return;
    setCancelBusy(true);
    setCancelError(null);
    try {
      // Cancelling is a server action: it records who, why and any refund, and closes the marketplace offer.
      await cancelBooking({ bookingId: cancelTarget.id, reason: 'Emergency cancel by admin' });
    } catch (e) {
      setCancelError(e instanceof Error ? e.message : 'The trip was not cancelled. Check your connection and try again.');
      setCancelBusy(false);
      return;
    }
    show(`Trip ${cancelTarget.bookingId} cancelled.`);
    setCancelTarget(null);
    setCancelBusy(false);
  };

  const trip =
    liveTripsList.find((t) => t.id === selectedTrip) || liveTripsList[0];

  return (
    <div className="p-6 space-y-5">
      <Toast toast={toast} />
      {loadError && <ErrorBanner message={loadError} />}
      {/* Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            label: "Active Trips",
            value: liveTripsList.length,
            color: "#c1232c",
          },
          {
            label: "Trip Started",
            value: liveTripsList.filter((t) => t.status === "Trip Started")
              .length,
            color: "#c1232c",
          },
          {
            label: "Going to Pickup",
            value: liveTripsList.filter(
              (t) => t.status === "Going to Pickup",
            ).length,
            color: "#3B82F6",
          },
          {
            label: "Waiting at Pickup",
            value: liveTripsList.filter((t) => t.status === "Waiting at Pickup")
              .length,
            color: "#F59E0B",
          },
        ].map((s) => (
          <div
            key={s.label}
            className="bg-white rounded-xl border border-line shadow-sm p-4"
          >
            <div className="flex items-center gap-2 mb-1">
              <div
                className="w-2 h-2 rounded-full animate-pulse"
                style={{ background: s.color }}
              />
              <span className="text-[11px] text-faint">{s.label}</span>
            </div>
            <div className="text-[26px] font-bold" style={{ color: s.color }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Trip List */}
        <div className="space-y-3">
          <h3 className="text-[13px] font-bold text-ink">Live Trip Feed</h3>
          {liveTripsList.map((t) => {
            const sc = statusConfig[t.status] || statusConfig["Trip Started"];
            return (
              <div
                key={t.id}
                onClick={() => setSelectedTrip(t.id)}
                className={`bg-white rounded-xl border-2 shadow-sm p-4 cursor-pointer transition-all hover:shadow-md ${bookingSourceRowCls(t)} ${selectedTrip === t.id ? "border-brand" : "border-line"}`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <div
                        className="text-[11px] font-mono font-bold"
                        style={{ color: "#c1232c" }}
                      >
                        {t.bookingId}
                      </div>
                      <BookingSourceBadge booking={t} size="sm" />
                    </div>
                    <div className="text-[12px] font-semibold text-ink mt-0.5">
                      {t.driver}
                    </div>
                    <div className="text-[10px] text-faint">{t.vehicle}</div>
                  </div>
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full`}
                    style={{ color: sc.color, background: sc.bg }}
                  >
                    <span
                      className="inline-block w-1.5 h-1.5 rounded-full mr-1 animate-pulse"
                      style={{ background: sc.color }}
                    />
                    {t.status}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[11px]">
                  <div className="flex flex-col items-center gap-0.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                    <div className="w-px h-4 bg-line" />
                    <div
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ background: "#c1232c" }}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <div className="text-muted truncate max-w-[160px]">
                      {t.pickup}
                    </div>
                    <div className="text-muted truncate max-w-[160px]">
                      {t.drop}
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-[11px] text-faint">
                    {t.location ? `📍 Reported at pickup${t.locationAt ? ` ${t.locationAt}` : ""}` : "No location reported"}
                  </span>
                  <span
                    className="text-[11px] font-semibold"
                    style={{ color: "#c1232c" }}
                  >
                    {t.fare}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Trip Detail Panel */}
        {trip && (
          <div className="lg:col-span-2 space-y-4">
            {/* Map Placeholder */}
            <div className="bg-white rounded-xl border border-line shadow-sm overflow-hidden">
              <div
                className="relative"
                style={{
                  height: 220,
                  background:
                    "linear-gradient(135deg, #F5F5F5 0%, #E5E5E5 100%)",
                }}
              >
                <div className="absolute inset-0 flex items-center justify-center flex-col gap-2">
                  <svg
                    className="w-10 h-10 text-brand"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                  {trip.location ? (
                    <>
                      <p className="text-[12px] text-muted font-medium">
                        Last reported position: {trip.location.lat.toFixed(5)}, {trip.location.lng.toFixed(5)}
                      </p>
                      <p className="text-[11px] text-faint">Reported when the driver reached pickup{trip.locationAt ? ` (${trip.locationAt})` : ""}</p>
                      <a
                        href={`https://www.google.com/maps?q=${trip.location.lat},${trip.location.lng}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] font-semibold text-brand underline"
                      >
                        Open in Google Maps
                      </a>
                    </>
                  ) : (
                    <p className="text-[12px] text-faint font-medium">No position reported for this trip yet.</p>
                  )}
                  <p className="text-[10px] text-subtle">Continuous live GPS tracking and ETA are not enabled yet.</p>
                </div>
                <div
                  className="absolute top-3 right-3 bg-white/90 backdrop-blur-sm rounded-lg px-3 py-2 text-[11px] font-semibold shadow-sm border border-line"
                  style={{ color: "#c1232c" }}
                >
                  {trip.status}
                </div>
              </div>
            </div>

            {/* Trip Info & OTP */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white rounded-xl border border-line shadow-sm p-4">
                <h4 className="text-[12px] font-bold text-ink mb-3 flex items-center gap-2">
                  <span
                    className="w-1 h-3.5 rounded-full"
                    style={{ background: "#c1232c" }}
                  />
                  Trip Details
                </h4>
                <div className="space-y-2">
                  {[
                    { label: "Driver", value: trip.driver },
                    { label: "Vehicle", value: trip.vehicle },
                    { label: "Vendor", value: trip.vendor },
                    { label: "Started", value: trip.startedAt },
                    { label: "Fare", value: trip.fare },
                  ].map((f) => (
                    <div
                      key={f.label}
                      className="flex justify-between text-[12px]"
                    >
                      <span className="text-faint">{f.label}</span>
                      <span className="font-semibold text-ink">
                        {f.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white rounded-xl border border-line shadow-sm p-4">
                <h4 className="text-[12px] font-bold text-ink mb-3 flex items-center gap-2">
                  <span
                    className="w-1 h-3.5 rounded-full"
                    style={{ background: "#c1232c" }}
                  />
                  Boarding OTP
                </h4>
                {trip.boardingOTPVerified ? (
                  <div className="text-center py-2">
                    <div className="text-[11px] text-green-600 font-semibold flex items-center justify-center gap-1 mb-2">
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2.5}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                      OTP Verified
                    </div>
                    <div
                      className="text-[28px] font-bold tracking-widest"
                      style={{ color: "#c1232c" }}
                    >
                      {trip.boardingOTPVerified ? "••••" : "—"}
                    </div>
                    <div className="text-[10px] text-faint mt-1">
                      Customer boarded successfully
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-2">
                    <div className="w-10 h-10 rounded-full bg-yellow-100 flex items-center justify-center mx-auto mb-2">
                      <svg
                        className="w-5 h-5 text-yellow-600"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                    </div>
                    <div className="text-[12px] font-semibold text-yellow-700">
                      Awaiting OTP Verification
                    </div>
                    <div className="text-[10px] text-faint mt-1">
                      Customer has not boarded yet
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Pre-Trip Verification Photos */}
            {(() => {
              const photos = [
                { label: "Driver Selfie", src: trip.preTrip?.driverSelfie },
                { label: "Vehicle Front", src: trip.preTrip?.vehicleFront },
                { label: "Vehicle Rear", src: trip.preTrip?.vehicleRear },
                { label: "Dashboard / Interior", src: trip.preTrip?.vehicleInterior },
              ];
              const submitted = photos.filter(
                (p) => typeof p.src === "string" && p.src.length > 0,
              );
              return (
                <div className="bg-white rounded-xl border border-line shadow-sm p-4">
                  <h4 className="text-[12px] font-bold text-ink mb-3 flex items-center gap-2">
                    <span
                      className="w-1 h-3.5 rounded-full"
                      style={{ background: "#c1232c" }}
                    />
                    Pre-Trip Verification Photos
                    <span
                      className={`ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full ${trip.hasVerificationPhotos || submitted.length === 4 ? "text-green-600 bg-green-50" : "text-faint bg-hover"}`}
                    >
                      {trip.hasVerificationPhotos ? "Camera verification submitted" : `${submitted.length}/4 Submitted`}
                    </span>
                  </h4>
                  {trip.hasVerificationPhotos ? (
                    <div className="py-3 text-[12px] text-body space-y-2">
                      <div>
                        The driver's selfie and the front, rear and dashboard photos were captured live with the camera
                        {trip.vehicleVerification?.riskLevel ? ` — fraud risk: ${String(trip.vehicleVerification.riskLevel).toUpperCase()}` : ""}.
                      </div>
                      {onOpenBooking && (
                        <button onClick={() => onOpenBooking(trip.id)} className="px-3 py-1.5 rounded-lg border border-line-strong text-[12px] font-semibold hover:bg-gray-50">
                          Review photos in booking details
                        </button>
                      )}
                    </div>
                  ) : submitted.length === 0 ? (
                    <div className="py-6 text-center text-[11px] text-faint">
                      Driver has not uploaded verification photos yet
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {photos.map((p) => (
                        <div key={p.label} className="text-center">
                          <button
                            disabled={!p.src}
                            onClick={() =>
                              p.src &&
                              setPhotoModal({ title: p.label, src: p.src })
                            }
                            className="block w-full aspect-square rounded-xl border-2 border-line overflow-hidden hover:border-brand transition-colors relative group disabled:opacity-40 disabled:hover:border-line"
                          >
                            {p.src ? (
                              <img
                                src={p.src}
                                alt={p.label}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-[9px] text-subtle">
                                Missing
                              </div>
                            )}
                            {p.src && (
                              <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-green-500 flex items-center justify-center">
                                <svg
                                  className="w-2.5 h-2.5 text-white"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                  strokeWidth={3}
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M5 13l4 4L19 7"
                                  />
                                </svg>
                              </div>
                            )}
                          </button>
                          <div className="text-[10px] text-faint mt-1.5 font-medium">
                            {p.label}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Actions */}
            <div className="flex gap-3">
              {trip.driverPhone ? (
                <a
                  href={`tel:${trip.driverPhone}`}
                  className="flex-1 text-center py-2.5 text-[12px] font-semibold border border-line rounded-xl hover:bg-hover text-body transition-colors cursor-pointer block"
                >
                  Contact Driver
                </a>
              ) : (
                <span className="flex-1 text-center py-2.5 text-[12px] font-semibold border border-line rounded-xl text-subtle block">No driver phone</span>
              )}
              {trip.customerPhone ? (
                <a
                  href={`tel:${trip.customerPhone}`}
                  className="flex-1 text-center py-2.5 text-[12px] font-semibold border border-line rounded-xl hover:bg-hover text-body transition-colors cursor-pointer block"
                >
                  Contact Customer
                </a>
              ) : (
                <span className="flex-1 text-center py-2.5 text-[12px] font-semibold border border-line rounded-xl text-subtle block">No customer phone</span>
              )}
              <button
                onClick={() => {
                  setCancelError(null);
                  setCancelTarget({ id: trip.id, bookingId: trip.bookingId });
                }}
                className="flex-1 py-2.5 text-[12px] font-semibold border border-line rounded-xl hover:bg-brand-soft text-brand transition-colors cursor-pointer"
              >
                Emergency Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {cancelTarget && (
        <ConfirmDialog
          title="Emergency cancel"
          message={`Cancel booking ${cancelTarget.bookingId} now? The driver and customer see the trip as cancelled and its marketplace offer is withdrawn.`}
          confirmLabel="Cancel trip"
          danger
          busy={cancelBusy}
          error={cancelError}
          onConfirm={() => void confirmCancel()}
          onCancel={() => setCancelTarget(null)}
        />
      )}

      {/* Photo Modal */}
      {photoModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          onClick={() => setPhotoModal(null)}
        >
          <div
            className="bg-white rounded-2xl overflow-hidden shadow-2xl max-w-sm w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-line">
              <span className="font-semibold text-ink text-[13px]">
                {photoModal.title}
              </span>
              <button
                onClick={() => setPhotoModal(null)}
                className="text-faint hover:text-ink"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
            <img
              src={photoModal.src}
              alt={photoModal.title}
              className="w-full"
            />
          </div>
        </div>
      )}
    </div>
  );
}
