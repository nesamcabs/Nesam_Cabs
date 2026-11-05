// Native renderer for the reference's line icons and travel pictograms.
import React from 'react';
import Svg, { Circle, Line, Path, Polygon, Polyline, Rect } from 'react-native-svg';
import { EXTRA_ICON_NODES, ICON_NODES, TRAVEL_GLYPHS, type IconNode } from './iconData';

export type IconName = keyof typeof ICON_NODES | keyof typeof EXTRA_ICON_NODES;
export type TravelGlyph = keyof typeof TRAVEL_GLYPHS;

const SHAPES = { path: Path, circle: Circle, line: Line, rect: Rect, polygon: Polygon, polyline: Polyline } as const;
const ALL: Record<string, IconNode[]> = { ...ICON_NODES, ...EXTRA_ICON_NODES };

function draw(nodes: IconNode[], fill?: string) {
  return nodes.map(([tag, attrs], i) => {
    const Shape = SHAPES[tag] as React.ComponentType<Record<string, unknown>>;
    return <Shape key={i} {...attrs} fill={fill ?? 'none'} />;
  });
}

/** A 24×24 line icon from the reference set (stroke 1.8, round caps). */
export function Icon({ name, size = 20, color = '#626e80', strokeWidth = 1.8, fill }: { name: IconName; size?: number; color?: string; strokeWidth?: number; fill?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {draw(ALL[name] ?? ICON_NODES['circle-dot'], fill)}
    </Svg>
  );
}

/** The modern 28×28 service pictograms (bottom navigation). */
export function TravelIcon({ name, size = 25, color = '#697586', strokeWidth = 1.8, fill }: { name: TravelGlyph; size?: number; color?: string; strokeWidth?: number; fill?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 28 28" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {draw(TRAVEL_GLYPHS[name] as IconNode[], fill)}
    </Svg>
  );
}
