import { createElement, type SVGProps } from "react";
import { ICON_DATA } from "./iconData";

export type IconName = keyof typeof ICON_DATA;

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  size?: number;
  /** Accessible name. Omit for decorative icons (they are hidden from assistive tech). */
  label?: string;
}

/** Lucide icon at the reference stroke weight. Unknown names render nothing rather than a broken glyph. */
export default function Icon({ name, size = 18, label, strokeWidth = 2, ...rest }: IconProps) {
  const node = ICON_DATA[name];
  if (!node) return null;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      {...rest}
    >
      {node.map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs }))}
    </svg>
  );
}
