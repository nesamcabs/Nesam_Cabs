import { useEffect } from "react";
import { runBookingAutoCancel } from "../services/bookingOpsService";

const EVERY_MS = 60000;

/**
 * While the admin panel is open, asks the server every minute to cancel bookings nobody accepted (30 minutes after pickup).
 * The server decides and does it; the booking lists update by themselves. The scheduled server job does the same when no
 * panel is open, so a failed request here needs no message.
 */
export function useAutoCancelSweep(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return undefined;
    let stopped = false;
    const ask = () => {
      if (stopped || document.hidden) return;
      runBookingAutoCancel().catch((e: unknown) => {
        // A server without this feature yet: stop asking until the panel is reloaded.
        if (/does not have this feature/i.test(e instanceof Error ? e.message : "")) stopped = true;
      });
    };
    ask();
    const timer = window.setInterval(ask, EVERY_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [enabled]);
}
