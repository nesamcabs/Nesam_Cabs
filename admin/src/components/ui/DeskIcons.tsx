import type { SVGProps } from "react";

/**
 * NESAM desk icons: one duotone family (soft tinted body + crisp outline) for the header's live
 * utilities and the Quick Fare trip types. 24px grid, 1.8 stroke, round caps; colour follows
 * `currentColor`, so each control keeps its own colour and hover state.
 */
export type DeskIconName =
  | "live-bookings" | "reminder" | "sound-on" | "sound-off"
  | "trip-oneway" | "trip-roundtrip" | "trip-multicity" | "trip-airport" | "trip-rental" | "trip-local";

const SOFT = { fill: "currentColor", fillOpacity: 0.16, stroke: "none" } as const;

function glyph(name: DeskIconName) {
  switch (name) {
    case "live-bookings":
      return (
        <>
          <rect x="3.5" y="5" width="17" height="15.5" rx="3" {...SOFT} />
          <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
          <path d="M8 3v4M16 3v4M3.5 10h17" />
          <path d="M7 15h2.2l1.4-2.4 2 4.6 1.5-2.2H17" />
        </>
      );
    case "reminder":
      return (
        <>
          <circle cx="12" cy="13" r="7.5" {...SOFT} />
          <circle cx="12" cy="13" r="7.5" />
          <path d="M12 9.2V13l2.6 1.7" />
          <path d="M4.2 5.6 6.6 3.4M19.8 5.6l-2.4-2.2M7 19.6l-1.6 1.8M17 19.6l1.6 1.8" />
        </>
      );
    case "sound-on":
      return (
        <>
          <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Z" {...SOFT} />
          <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Z" />
          <path d="M15.5 9.2a4 4 0 0 1 0 5.6M18.2 6.8a7.4 7.4 0 0 1 0 10.4" />
        </>
      );
    case "sound-off":
      return (
        <>
          <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Z" {...SOFT} />
          <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Z" />
          <path d="m15.5 9.5 5 5M20.5 9.5l-5 5" />
        </>
      );
    case "trip-oneway":
      return (
        <>
          <circle cx="5.5" cy="12" r="3" {...SOFT} />
          <circle cx="5.5" cy="12" r="2.2" />
          <path d="M9.5 12h10M15.5 8l4 4-4 4" />
        </>
      );
    case "trip-roundtrip":
      return (
        <>
          <rect x="3" y="6" width="18" height="12" rx="6" {...SOFT} />
          <path d="M7 9h9.5a3 3 0 0 1 0 6H15" />
          <path d="M9.5 6.5 7 9l2.5 2.5" />
          <path d="M17 15H7.5a3 3 0 0 1-1.7-.5" />
          <path d="m14.5 12.5 2.5 2.5-2.5 2.5" />
        </>
      );
    case "trip-multicity":
      return (
        <>
          <circle cx="5" cy="18" r="2.4" {...SOFT} />
          <circle cx="12" cy="7" r="2.4" {...SOFT} />
          <circle cx="19" cy="15" r="2.4" {...SOFT} />
          <circle cx="5" cy="18" r="2" />
          <circle cx="12" cy="7" r="2" />
          <circle cx="19" cy="15" r="2" />
          <path d="m6.2 16.2 4.6-7.4M13.6 8.4l4 5" strokeDasharray="2 2.2" />
        </>
      );
    case "trip-airport":
      return (
        <>
          <path d="M10.2 13.6 4 15.4v-1.9l6.2-4.2V5.2a1.8 1.8 0 0 1 3.6 0v4.1l6.2 4.2v1.9l-6.2-1.8v3.3l2 1.6v1.6L12 19.2l-3.8.9v-1.6l2-1.6Z" {...SOFT} />
          <path d="M10.2 13.6 4 15.4v-1.9l6.2-4.2V5.2a1.8 1.8 0 0 1 3.6 0v4.1l6.2 4.2v1.9l-6.2-1.8v3.3l2 1.6v1.6L12 19.2l-3.8.9v-1.6l2-1.6Z" />
        </>
      );
    case "trip-rental":
      return (
        <>
          <circle cx="12" cy="13.5" r="7" {...SOFT} />
          <circle cx="12" cy="13.5" r="7" />
          <path d="M10 3h4M12 3v3.5M12 10v3.5h3" />
          <path d="m18.2 6.8 1.3-1.3" />
        </>
      );
    case "trip-local":
      return (
        <>
          <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" {...SOFT} />
          <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
          <path d="M9.3 12.2V9.6L12 7.6l2.7 2v2.6Z" />
        </>
      );
  }
}

/** Decorative unless `label` is given (then it is announced as an image). */
export default function DeskIcon({ name, size = 18, label, ...rest }: { name: DeskIconName; size?: number; label?: string } & Omit<SVGProps<SVGSVGElement>, "name">) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      {...rest}
    >
      {glyph(name)}
    </svg>
  );
}

/** Desk trip-type key → its icon. */
export const TRIP_ICON: Record<string, DeskIconName> = {
  "One Way": "trip-oneway",
  "Round Trip": "trip-roundtrip",
  Multicity: "trip-multicity",
  Airport: "trip-airport",
  Rental: "trip-rental",
  Local: "trip-local",
};
