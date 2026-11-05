# NESAM asset placement

- Customer website (`user/web`): refreshed existing authentication/state artwork, trip history, saved places, offers, payments, notifications, support, driver-arrival/completed-trip artwork, vehicle category cutouts and shared SVG icons. Existing routing and page structure preserved.
- Driver website: desktop authentication hero; empty dashboard/active-trip states, offline state, empty earnings/wallet and notifications; desktop sidebar icons.
- Vendor website: desktop authentication hero; empty fleet, drivers, trip queue, marketplace, wallet and notifications; desktop sidebar icons.
- Images are decorative; state text and action buttons remain authoritative. No success artwork is displayed for empty financial records.
- New driver/vendor raster assets are optimized WebP. Phone-sized web login omits the large hero. Native authentication/empty-state presentation is retained through platform components.
- Unused stickers and scenic photography remain in the asset library; live operational screens do not need unrelated decoration.

Validation: TypeScript checks and production web builds passed for all three websites. Login pages rendered at 1440px and 390px without horizontal overflow, broken images or page errors. Screenshots and results: `asset-integration-checks/`. Signed-in operational pages were checked through their shared components and builds; visual checks of real account data require an authenticated account. No deployments performed.
