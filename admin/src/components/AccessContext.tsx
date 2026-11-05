import { createContext, useContext } from "react";
import { NO_ACCESS, canDo, hasFlag, type AdminAccess, type DutyAction, type FlagGroup, type ModuleAction, type Permission, type StaffModule } from "../config/permissions";

const AccessContext = createContext<AdminAccess>(NO_ACCESS);

export const AccessProvider = AccessContext.Provider;

/** The signed-in admin's role. Use it to hide actions the rules would refuse anyway. */
export const useAccess = () => useContext(AccessContext);

export function useCan(permission: Permission): boolean {
  return useContext(AccessContext).permissions.includes(permission);
}

/** Duty action from the effective duty list (Staff ID: its own; role-based staff: the legacy mapping). */
export function useDuty(action: DutyAction): boolean {
  const a = useContext(AccessContext);
  return a.isSuper || a.duty.includes(action);
}

/** Module action (view / create / edit / approve / export / send) from the Staff & Access matrix. */
export function useCanDo(module: StaffModule, action: ModuleAction): boolean {
  return canDo(useContext(AccessContext), module, action);
}

/** Separate Staff ID right: sensitive data, swaps, partner rights, customer privacy access. */
export function useStaffFlag(group: FlagGroup, key: string): boolean {
  return hasFlag(useContext(AccessContext), group, key);
}

/** Account control (suspend / reactivate / inactive / dispute) for an account type. */
export function useAccountControl(type: "Driver Partners" | "Vendors" | "Vendor Drivers" | "Vehicles") {
  const a = useContext(AccessContext);
  return (action: "suspend" | "reactivate" | "inactive" | "dispute") => a.isSuper || (a.matrix.accountControls?.[type] ?? []).includes(action);
}
