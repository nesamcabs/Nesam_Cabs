// Mirrors functions/src/domain/driverRole.ts: an Owner-cum-Driver (independent, owns and
// drives their own vehicle) or a Vendor Driver (works under a fleet Vendor). The only signal
// for this is whether the driver profile's vendorId is set.

export type DriverRole = 'owner' | 'vendor_driver';

export function driverRoleOf(d: { vendorId?: string | null }): DriverRole {
  return d.vendorId ? 'vendor_driver' : 'owner';
}

export const isOwnerDriver = (d: { vendorId?: string | null }): boolean => driverRoleOf(d) === 'owner';
export const isVendorDriver = (d: { vendorId?: string | null }): boolean => driverRoleOf(d) === 'vendor_driver';
