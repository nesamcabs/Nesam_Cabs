/** Keep saved shortcuts working after consolidating duplicate workspaces. */
export function resolveAdminDestination(page: string, tab?: string): { page: string; tab?: string } {
  if (page === "notifications" && tab === "Coupons") return { page: "offers" };
  // Overdue-settlement alerts name the settlement queue, which lives on Payments.
  if (page === "driver-earnings") return { page: "payments" };
  // Quick fare was a second screen for the same estimate: New booking now gives the fare and can save it as an enquiry.
  if (page === "quick-fare") return { page: "new-booking" };
  if (page === "accounts" && tab?.split(":")[0] === "Partner statements") {
    return { page, tab: tab.replace(/^Partner statements/, "Statements") };
  }
  return { page, tab };
}
