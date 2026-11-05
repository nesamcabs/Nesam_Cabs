import type { ReactNode } from "react";
import type { Booking, MarketplaceTrip } from "../../types";
import type { OfficeData } from "../../hooks/useOfficeData";
import {
  GROUP_TONE, agreedPayoutOf, bookingSourceLabel, fareOf, placeParts, refDate, refDateTime, refTime, remainingLabel, rupee,
  serviceFamilyOf, suggestedPayoutOf, tripTypeOf, type CustomerGroup,
} from "../../domain/officeStage";
import { bookingPickupDate, toDate } from "../../utils/time";
import { Badge, Button, Icon } from "../ui";
import { BookingSourceBadge } from "./BookingBadges";

/** Reference booking table cells. Each returns the inner content of one <td>. */

export function DateCell({ b }: { b: Booking }) {
  const p = bookingPickupDate(b);
  return (
    <div className="ds-date-cell">
      <strong>{p ? refDate(p) : b.date}</strong>
      <span>{p ? refTime(p) : b.time}</span>
    </div>
  );
}

export function RouteCell({ b }: { b: Booking }) {
  const from = placeParts(b.pickup);
  const to = placeParts(b.drop);
  const areas = [from.area, to.area].filter(Boolean).join(" → ");
  return (
    <div className="ds-route-cell">
      <strong title={`${b.pickup} → ${b.drop}`}>{from.city || b.pickup} → {to.city || b.drop}</strong>
      <small title={b.bookingId || b.id}>
        {b.bookingId || b.id} <i>{bookingSourceLabel(b)}</i>
      </small>
      {/* Which customer website the booking came from (One Way Car Rentals / People Taxi). */}
      <BookingSourceBadge booking={b} size="sm" className="mt-1" />
      {areas && <small>{areas}</small>}
    </div>
  );
}

export function TripTypeCell({ b }: { b: Booking }) {
  return (
    <>
      <strong>{tripTypeOf(b)}</strong>
      <small>{serviceFamilyOf(b)}</small>
    </>
  );
}

export function VehicleCell({ b, data }: { b: Booking; data: OfficeData }) {
  const v = b.assignedVehicleId ? data.vehicleById.get(b.assignedVehicleId) : undefined;
  return (
    <>
      <strong>{b.vehicleCategory || b.vehicle}</strong>
      {v?.model && <small>{v.model}</small>}
    </>
  );
}

export function CustomerCell({ b, group }: { b: Booking; group: CustomerGroup }) {
  const name = b.customer || b.customerName;
  return (
    <>
      <strong className="ds-cell-clip">{name || "Not supplied"}</strong>
      <small>{b.phone || b.customerPhone || "Contact not supplied"}</small>
      <div className="mt-1"><Badge tone={GROUP_TONE[group]}>{group}</Badge></div>
    </>
  );
}

export function FareCell({ b }: { b: Booking }) {
  return (
    <div className="ds-money-cell">
      <strong>{rupee(fareOf(b))}</strong>
      <small>Agreed estimate</small>
    </div>
  );
}

/** Vendor payout: suggested before publishing, the live offer while published, then the agreed amount. */
export function PayoutCell({ b, market, stage }: { b: Booking; market?: MarketplaceTrip; stage: string }) {
  const agreed = agreedPayoutOf(b);
  if (agreed) {
    return (
      <div className="ds-money-cell">
        <strong>{rupee(agreed)}</strong>
        <small>Agreed payout</small>
      </div>
    );
  }
  if (stage === "Published" && market) {
    const offer = Number(market.offeredPayout) || 0;
    const bidding = market.mode === "bid_review" || Boolean(market.escalation?.enabled);
    const max = market.ceiling ?? (market.escalation?.ceilingPaise ? market.escalation.ceilingPaise / 100 : undefined);
    return (
      <div className="ds-money-cell">
        <strong>{rupee(offer)}</strong>
        <small>{bidding ? `Bidding${max ? ` · Max ${rupee(max)}` : ""}` : "Fixed payout"}</small>
        {market.escalation?.enabled && <small className="text-warn">+ 5% hourly</small>}
      </div>
    );
  }
  const s = suggestedPayoutOf(b);
  return (
    <div className="ds-money-cell">
      <strong>{rupee(s)}</strong>
      <small>{s === null ? "Set at publication" : "Suggested payout"}</small>
    </div>
  );
}

function partnerOf(b: Booking, data: OfficeData) {
  if (b.assignedVendorId) {
    const v = data.vendorById.get(b.assignedVendorId);
    return { name: b.assignedVendorName || v?.companyName || v?.name || "Vendor", role: "Vendor", id: b.assignedVendorId, phone: v?.phone || "" };
  }
  if (b.assignedDriverId) {
    const d = data.driverById.get(b.assignedDriverId);
    if (d && !d.vendorId) return { name: b.assignedDriverName || d.name, role: "Driver Partner", id: d.id, phone: b.driverPhone || d.phone || "" };
  }
  return null;
}

export function AcceptedByCell({ b, data }: { b: Booking; data: OfficeData }) {
  const p = partnerOf(b, data);
  if (!p) return <><strong>Not accepted</strong><small>Partner allocation pending</small></>;
  const at = toDate((b as { acceptedAt?: never }).acceptedAt) ?? toDate((b as { assignedVendorAt?: never }).assignedVendorAt);
  return (
    <>
      <strong>{p.name}</strong>
      <div className="my-1"><Badge tone="blue">{p.role}</Badge></div>
      <small>{p.phone || "Not provided"}</small>
      <small>{at ? refDateTime(at) : "Acceptance time not recorded"}</small>
    </>
  );
}

export function AssignmentCell({ b, data, deadlineHours, now }: { b: Booking; data: OfficeData; deadlineHours: number; now: Date }) {
  if (b.assignedDriverId) {
    const v = b.assignedVehicleId ? data.vehicleById.get(b.assignedVehicleId) : undefined;
    return (
      <>
        <Badge tone="green">Assigned</Badge>
        <small>{b.assignedDriverName || b.driver}</small>
        <small>{b.assignedVehicleNumber || v?.vehicleNumber || ""}</small>
      </>
    );
  }
  const p = bookingPickupDate(b);
  const deadline = p ? new Date(p.getTime() - deadlineHours * 3600000) : null;
  const overdue = deadline ? deadline.getTime() < now.getTime() : false;
  return (
    <>
      <Badge tone={overdue ? "red" : "amber"}>{overdue ? "Deadline missed" : "Assignment pending"}</Badge>
      {deadline && <small>{refDate(deadline)} · {refTime(deadline)}</small>}
      {deadline && <small>{remainingLabel(deadline, now)}</small>}
    </>
  );
}

const tel = (n: string) => `tel:${n.replace(/[^\d+]/g, "")}`;
const wa = (n: string) => `https://wa.me/${(n.replace(/\D/g, "").length === 10 ? "91" : "") + n.replace(/\D/g, "")}`;

/** "Details" expansion under a booking row: partner & acceptance · driver / cab · customer / passenger. */
export function BookingExpand({ b, data, onOpen }: { b: Booking; data: OfficeData; onOpen: () => void }) {
  const p = partnerOf(b, data);
  const d = b.assignedDriverId ? data.driverById.get(b.assignedDriverId) : undefined;
  const v = b.assignedVehicleId ? data.vehicleById.get(b.assignedVehicleId) : undefined;
  const at = toDate((b as { acceptedAt?: never }).acceptedAt) ?? toDate((b as { assignedVendorAt?: never }).assignedVendorAt);
  const phone = b.phone || b.customerPhone || "";
  const whats = b.customerWhatsapp?.e164 || phone;
  const pickup = bookingPickupDate(b);
  const row = (k: string, val: ReactNode) => (
    <>
      <dt>{k}</dt>
      <dd>{val}</dd>
    </>
  );
  return (
    <>
      <div className="ds-expand">
        <section>
          <h3>Partner &amp; acceptance</h3>
          <dl>
            {row("Partner", p?.name ?? "Not accepted")}
            {row("Role / ID", p ? `${p.role} · ${p.id.slice(0, 10)}` : "Not allocated")}
            {row("Mobile", p?.phone || "Contact not available")}
            {row("Accepted", p ? (at ? refDateTime(at) : "Acceptance time not recorded") : "Not accepted")}
          </dl>
          {p?.phone ? (
            <a className="ds-btn ds-btn-secondary ds-btn-sm" href={tel(p.phone)}>Call partner</a>
          ) : (
            <Button size="sm" disabled>Call partner</Button>
          )}
        </section>
        <section>
          <h3>Driver / Cab</h3>
          <dl>
            {row("Driver", b.assignedDriverName || b.driver || "Not assigned")}
            {row("Driving licence", d?.licenseNumber || d?.license || "Not assigned")}
            {row("Mobile", b.driverPhone || d?.phone || "Contact not available")}
            {row("Car", b.assignedVehicleNumber ? `${b.assignedVehicleNumber}${v?.model ? ` · ${v.model}` : ""}` : "Not assigned")}
            {row("Assignment", <Badge tone={b.assignedDriverId ? "green" : "amber"}>{b.assignedDriverId ? "Assigned" : "Assignment pending"}</Badge>)}
          </dl>
        </section>
        <section>
          <h3>Customer / Passenger</h3>
          <dl>
            {row("Customer", b.customer || b.customerName || "Not supplied")}
            {row("Mobile", phone || "Not supplied")}
            {row("WhatsApp", whats || "Not supplied")}
            {row("Passenger", "Same as customer")}
          </dl>
          <div className="flex flex-wrap gap-2">
            {phone ? <a className="ds-btn ds-btn-secondary ds-btn-sm" href={tel(phone)}><Icon name="phone" size={14} />Call customer</a> : <Button size="sm" icon="phone" disabled>Call customer</Button>}
            {whats ? <a className="ds-btn ds-btn-ghost ds-btn-sm" href={wa(whats)} target="_blank" rel="noreferrer"><Icon name="eye" size={14} />WhatsApp detail</a> : null}
          </div>
        </section>
      </div>
      <div className="ds-expand-foot">
        <span>Pickup {pickup ? refDateTime(pickup) : `${b.date} · ${b.time}`} · {b.bookingId || b.id}</span>
        <Button size="sm" variant="ghost" onClick={onOpen}>Open booking ↗</Button>
      </div>
    </>
  );
}
