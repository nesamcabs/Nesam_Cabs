// A driver is an Owner-cum-Driver (independent, owns and drives their own vehicle) or a
// Vendor Driver (works under a fleet Vendor). The only signal for this today is whether
// drivers/{uid}.vendorId is set — this helper names that check so new code reads intent
// instead of another ad hoc `if (driver.vendorId)`.

export type DriverRole = 'owner' | 'vendor_driver';

export function driverRoleOf(d: { vendorId?: string | null }): DriverRole {
  return d.vendorId ? 'vendor_driver' : 'owner';
}

export const isOwnerDriver = (d: { vendorId?: string | null }): boolean => driverRoleOf(d) === 'owner';
export const isVendorDriver = (d: { vendorId?: string | null }): boolean => driverRoleOf(d) === 'vendor_driver';
