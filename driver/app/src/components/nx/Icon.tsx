import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { ICON_DATA, type IconEl, type NxIconName as DataName } from './iconData';

/** "back" is the reference's chevron turned to point left, as the website does. */
export type NxIconName = DataName | 'back';

function draw(el: IconEl, i: number) {
  const a = el.a;
  switch (el.tag) {
    case 'path':
      return <Path key={i} d={a.d} />;
    case 'circle':
      return <Circle key={i} cx={a.cx} cy={a.cy} r={a.r} />;
    case 'rect':
      return <Rect key={i} x={a.x} y={a.y} width={a.width} height={a.height} rx={a.rx} />;
    default:
      return null;
  }
}

/**
 * The reference's own SVG geometry (generated into iconData.ts from the website's icon set), rendered with
 * react-native-svg: 24-unit grid, round caps and joins, 1.8 stroke — the same as the website's `.icon`.
 * Icons are decorative; the control that holds one carries the accessible label.
 */
export function NxIcon({ name, size = 18, color, strokeWidth = 1.8 }: { name: NxIconName; size?: number; color: string; strokeWidth?: number }) {
  const data = ICON_DATA[name === 'back' ? 'chevron' : name];
  return (
    <Svg
      width={size}
      height={size}
      viewBox={data.viewBox}
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={name === 'back' ? { transform: [{ rotate: '180deg' }] } : undefined}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {data.els.map(draw)}
    </Svg>
  );
}
