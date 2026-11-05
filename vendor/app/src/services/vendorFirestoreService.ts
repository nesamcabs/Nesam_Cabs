import {
  collection,
  doc,
  setDoc,
  updateDoc,
  onSnapshot,
  query,
  where,
  serverTimestamp,
  getDocs,
} from "firebase/firestore";
import { db } from "./firebase";
import {
  FleetVehicle,
  FleetDriver,
  OpenTrip,
  BidProposal,
  VendorTrip,
  PayoutRequest,
} from "../types/vendor";
import { maskPhone } from "../utils/format";

export const VEHICLES_COLLECTION = "vehicles";
export const DRIVERS_COLLECTION = "drivers";
export const MARKETPLACE_COLLECTION = "marketplace_trips";
export const BOOKINGS_COLLECTION = "bookings";
export const PAYOUTS_COLLECTION = "payout_requests";

/**
 * Real-time listener for Fleet Vehicles
 */
export function subscribeToFleetVehicles(
  vendorId: string,
  callback: (vehicles: FleetVehicle[]) => void,
) {
  try {
    const q = query(
      collection(db, VEHICLES_COLLECTION),
      where("vendorId", "==", vendorId),
    );
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        if (!snapshot.empty) {
          const vehicles: FleetVehicle[] = snapshot.docs.map((docSnap) => {
            const data = docSnap.data();
            return {
              id: data.id || docSnap.id,
              vehicleNumber:
                data.vehicleNumber || data.number || "TN 01 AB 1234",
              category: data.category || "Sedan",
              make: data.make || "Toyota",
              model: data.model || data.name || "Innova",
              year: data.year || "2023",
              seatingCapacity: data.seatingCapacity || data.seats || 4,
              status: data.status || "Active",
              assignedDriverId: data.assignedDriverId || undefined,
              assignedDriverName:
                data.assignedDriverName || data.driver || undefined,
              docStatus:
                data.docStatus || (data.verified ? "Approved" : "Pending"),
              rcDocUrl: data.rcDocUrl || undefined,
              insuranceDocUrl: data.insuranceDocUrl || undefined,
              fitnessDocUrl: data.fitnessDocUrl || undefined,
              statePermitDocUrl: data.statePermitDocUrl || undefined,
            };
          });
          callback(vehicles);
        } else {
          callback([]);
        }
      },
      () => callback([]),
    );
    return unsubscribe;
  } catch {
    callback([]);
    return () => {};
  }
}

/**
 * Real-time listener for Fleet Drivers
 */
export function subscribeToFleetDrivers(
  vendorId: string,
  callback: (drivers: FleetDriver[]) => void,
) {
  try {
    const q = query(
      collection(db, DRIVERS_COLLECTION),
      where("vendorId", "==", vendorId),
    );
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        if (!snapshot.empty) {
          const drivers: FleetDriver[] = snapshot.docs.map((docSnap) => {
            const data = docSnap.data();
            return {
              id: data.id || docSnap.id,
              name: data.name || "Driver Partner",
              phone: data.phone || "+91 94432 12345",
              email: data.email || "driver@nesam.in",
              photoUrl:
                data.photoUrl ||
                "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80",
              licenseNumber: data.licenseNumber || "TN43 20180004521",
              licenseExpiry: data.licenseExpiry || "2028-12-31",
              status:
                data.status === "On Trip"
                  ? "On Trip"
                  : data.status === "Suspended"
                    ? "Suspended"
                    : "Available",
              assignedVehicleNumber:
                data.assignedVehicleNumber || data.vehicle || undefined,
              rating: data.rating || 4.8,
              totalTrips: data.totalTrips || data.trips || 120,
              docStatus:
                data.docStatus || (data.verified ? "Approved" : "Pending"),
            };
          });
          callback(drivers);
        } else {
          callback([]);
        }
      },
      () => callback([]),
    );
    return unsubscribe;
  } catch {
    callback([]);
    return () => {};
  }
}

/**
 * Add / Update Fleet Vehicle in Firestore
 */
export async function saveVehicleToFirestore(
  vehicle: FleetVehicle,
  vendorId: string,
) {
  try {
    const vehicleRef = doc(db, VEHICLES_COLLECTION, vehicle.id);
    await setDoc(
      vehicleRef,
      { ...vehicle, vendorId, updatedAt: serverTimestamp() },
      { merge: true },
    );
  } catch (error) {
    console.warn("Save vehicle error:", error);
  }
}

export async function inviteDriverByVendor(
  phone: string,
  vendorId: string,
  vendorName: string,
  vehicleAssignment?: string,
) {
  try {
    // Normalize phone to +91XXXXXXXXXX format
    const normalizedPhone = phone.startsWith("+")
      ? phone
      : "+91" + phone.replace(/\D/g, "").slice(-10);
    const inviteRef = doc(db, "driver_invites", normalizedPhone);
    await setDoc(
      inviteRef,
      {
        phone: normalizedPhone,
        vendorId: vendorId,
        vendorName: vendorName,
        vehicleAssignment: vehicleAssignment || null,
        preApproved: false,
        createdAt: serverTimestamp(),
      },
      { merge: true },
    );
    return true;
  } catch (error) {
    console.warn("Invite driver error:", error);
    return false;
  }
}

/**
 * Real-time listener for open marketplace trips
 */
export function subscribeToOpenMarketplaceTrips(
  callback: (trips: OpenTrip[]) => void,
) {
  try {
    const q = query(collection(db, MARKETPLACE_COLLECTION), where("status", "in", ["Open", "Bidding"]));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        if (!snapshot.empty) {
          const trips: OpenTrip[] = snapshot.docs.map((docSnap) => {
            const data = docSnap.data();
            return {
              id: data.id || docSnap.id,
              bookingId:
                data.bookingId || "NESAM-BK-" + docSnap.id.substring(0, 4),
              route:
                data.route || "Chennai Airport Gate 4 âž” Puducherry White Town",
              pickup: data.pickup || {
                address: "Chennai Airport Gate 4",
                city: "Chennai",
                time: "02:30 PM",
              },
              drop: data.drop || {
                address: "Puducherry White Town",
                city: "Puducherry",
              },
              travelDate: data.travelDate || "Today, 26 Aug",
              vehicleCategory: data.vehicleCategory || "Sedan",
              distanceKm: data.distanceKm || 165,
              offeredPayout: data.offeredPayout || 4200,
              status: data.status || "Open",
            };
          });
          callback(trips);
        } else {
          callback([]);
        }
      },
      (err) => {
        console.warn("Marketplace trips listener error:", err);
        callback([]);
      },
    );

    return unsubscribe;
  } catch (err) {
    console.warn("Marketplace listener initialization error:", err);
    callback([]);
    return () => {};
  }
}

export async function submitBidToFirestore(
  bid: BidProposal,
  vendorId: string,
  vendorName: string,
) {
  try {
    if (!bid.tripId) throw new Error("tripId is required for bid submission");

    const bidRef = doc(
      db,
      "marketplace_trips",
      bid.tripId,
      "bids",
      "BID-" + Date.now(),
    );
    await setDoc(bidRef, {
      tripId: bid.tripId,
      vendorId: vendorId,
      vendorName: vendorName,
      vendorCounterRate: bid.vendorCounterRate,
      offeredPayout: bid.offeredPayout,
      biddingNote: bid.biddingNote || "",
      status: "Pending Review",
      submittedAt: serverTimestamp(),
    });
    await updateDoc(doc(db, "marketplace_trips", bid.tripId), {
      status: "Bidding",
      lastBidAt: serverTimestamp(),
    });
    return true;
  } catch (error) {
    console.warn("Submit bid error:", error);
    return false;
  }
}

export async function assignTripInFirestore(
  tripId: string,
  driverId: string,
  driverName: string,
  vehicleNumber: string,
  vendorId: string,
) {
  try {
    // The vendorDispatchOk rule requires: only update assignedDriverId, assignedDriverName,
    // assignedVehicleNumber, tripStage, status. NO id field.
    await updateDoc(doc(db, "bookings", tripId), {
      assignedDriverId: driverId,
      assignedDriverName: driverName,
      assignedVehicleNumber: vehicleNumber,
      status: "Assigned",
      // DO NOT include: id, assignedVendorId (already set by admin when accepting bid)
    });
    // Update marketplace
    await setDoc(
      doc(db, "marketplace_trips", tripId),
      {
        status: "Assigned",
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    return true;
  } catch (error) {
    console.warn("Assign trip error:", error);
    return false;
  }
}

/**
 * Save Payout Request to Firestore
 */
export async function submitPayoutRequestToFirestore(
  request: PayoutRequest,
  vendorId: string,
) {
  try {
    const payoutRef = doc(db, PAYOUTS_COLLECTION, request.id);
    await setDoc(
      payoutRef,
      { ...request, vendorId, createdAt: serverTimestamp() },
      { merge: true },
    );
  } catch (error) {
    console.warn("Submit payout request error:", error);
  }
}

export function subscribeToVendorActiveTrips(
  vendorId: string,
  callback: (trips: VendorTrip[]) => void,
) {
  try {
    const q = query(
      collection(db, BOOKINGS_COLLECTION),
      where("assignedVendorId", "==", vendorId),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const trips: VendorTrip[] = snap.docs
          .map((d) => ({
            id: d.id,
            bookingId: d.data().bookingId || d.id,
            customerName: d.data().customer || "Passenger",
            customerPhone: d.data().phoneMasked || d.data().customerPhoneMasked || (d.data().phone ? maskPhone(d.data().phone) : "+91 ••••• •••••"),
            customerPhoneMasked: d.data().phoneMasked || d.data().customerPhoneMasked || (d.data().phone ? maskPhone(d.data().phone) : "+91 ••••• •••••"),
            pickupAddress:
              d.data().pickupAddress || d.data().pickup || "Pickup",
            dropAddress: d.data().dropAddress || d.data().drop || "Destination",
            scheduledTime: `${d.data().date || "Today"}, ${d.data().time || "10:00 AM"}`,
            vehicleNumber: d.data().assignedVehicleNumber || "TN 01 AB 1234",
            driverId: d.data().assignedDriverId || "",
            driverName: d.data().assignedDriverName || "Driver",
            driverPhone: "+91 94400 00000",
            grossFare:
              typeof d.data().fare === "number"
                ? d.data().fare
                : parseInt(
                    String(d.data().fare || "2000").replace(/[^0-9]/g, ""),
                  ) || 2000,
            platformFee: Math.round(
              (typeof d.data().fare === "number"
                ? d.data().fare
                : parseInt(
                    String(d.data().fare || "2000").replace(/[^0-9]/g, ""),
                  ) || 2000) * 0.1,
            ),
            vendorPayout: Math.round(
              (typeof d.data().fare === "number"
                ? d.data().fare
                : parseInt(
                    String(d.data().fare || "2000").replace(/[^0-9]/g, ""),
                  ) || 2000) * 0.9,
            ),
            status: d.data().status || "Assigned",
          }))
          .filter((t) => t.status !== "Completed" && t.status !== "Cancelled");
        callback(trips);
      },
      () => callback([]),
    );
    return unsub;
  } catch {
    callback([]);
    return () => {};
  }
}

export function subscribeToVendorPayouts(
  vendorId: string,
  callback: (payouts: PayoutRequest[]) => void,
) {
  try {
    const q = query(
      collection(db, PAYOUTS_COLLECTION),
      where("vendorId", "==", vendorId),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const payouts = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        })) as PayoutRequest[];
        callback(payouts);
      },
      () => callback([]),
    );
    return unsub;
  } catch {
    callback([]);
    return () => {};
  }
}

export function subscribeToVendorWalletBalance(
  vendorId: string,
  callback: (balance: number) => void,
) {
  try {
    const q = query(
      collection(db, "bookings"),
      where("assignedVendorId", "==", vendorId),
      where("status", "==", "Completed"),
    );
    const unsubTrips = onSnapshot(
      q,
      async (tripSnap) => {
        const totalEarned = tripSnap.docs.reduce((sum, d) => {
          const data = d.data();
          const fare =
            typeof data.fare === "number"
              ? data.fare
              : parseInt(String(data.fare || "0").replace(/[^0-9]/g, "")) || 0;
          const vendorPayout = data.vendorPayout || Math.round(fare * 0.9);
          return sum + vendorPayout;
        }, 0);

        const payoutsQ = query(
          collection(db, "payout_requests"),
          where("vendorId", "==", vendorId),
          where("status", "==", "Paid"),
        );
        const payoutsSnap = await getDocs(payoutsQ);
        const totalPaid = payoutsSnap.docs.reduce(
          (sum, d) => sum + (d.data().amount || 0),
          0,
        );

        callback(totalEarned - totalPaid);
      },
      () => callback(0),
    );
    return unsubTrips;
  } catch {
    callback(0);
    return () => {};
  }
}
