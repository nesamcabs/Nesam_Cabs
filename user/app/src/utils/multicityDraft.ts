import type { GeoPlace } from '../types';
import { newId } from '../services/callables';

export interface MulticityStopItem { id: string; place: GeoPlace | null }
export interface MulticityDraft {
  submissionId: string;
  pickup: GeoPlace | null;
  drop: GeoPlace | null;
  stops: MulticityStopItem[];
  date: string;
  time: string;
  endDate: string;
  endTime: string;
  categoryId: string;
  notes: string;
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const safeId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const string = (value: unknown, max: number) => typeof value === 'string' ? value.slice(0, max) : '';

export function validMulticityPlace(value: unknown): value is GeoPlace {
  return object(value) && typeof value.id === 'string' && typeof value.name === 'string' && !!value.name.trim()
    && typeof value.address === 'string' && typeof value.lat === 'number' && Number.isFinite(value.lat)
    && typeof value.lng === 'number' && Number.isFinite(value.lng)
    && value.lat >= 6.5 && value.lat <= 35.7 && value.lng >= 68.1 && value.lng <= 97.4
    && ['home', 'work', 'favorite', 'recent', 'airport', 'other', 'current'].includes(String(value.type));
}

export function validMulticityDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Explicit India offset, independent of the browser's timezone. */
export function multicityInstant(date: string, time: string): string | undefined {
  if (!validMulticityDate(date) || !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(time)) return undefined;
  return new Date(`${date}T${time.length === 5 ? `${time}:00` : time}+05:30`).toISOString();
}

export function freshMulticityDraft(): MulticityDraft {
  return { submissionId: newId('sub'), pickup: null, drop: null, stops: [{ id: newId('stop'), place: null }], date: '', time: '', endDate: '', endTime: '', categoryId: '', notes: '' };
}

/** Storage is untrusted: rebuild a bounded, typed draft instead of trusting parsed JSON. */
export function loadMulticityDraft(raw: string | null): MulticityDraft {
  const fresh = freshMulticityDraft();
  try {
    if (!raw || raw.length > 100000) return fresh;
    const parsed: unknown = JSON.parse(raw);
    if (!object(parsed)) return fresh;
    const ids = new Set<string>();
    const stops = Array.isArray(parsed.stops) ? parsed.stops.slice(0, 10).filter(object).map(stop => {
      const id = safeId(stop.id) && stop.id.length <= 80 && !ids.has(stop.id) ? stop.id : newId('stop');
      ids.add(id);
      return { id, place: validMulticityPlace(stop.place) ? stop.place : null };
    }) : [];
    const date = string(parsed.date, 10), endDate = string(parsed.endDate, 10), time = string(parsed.time, 5);
    return {
      submissionId: safeId(parsed.submissionId) ? parsed.submissionId : fresh.submissionId,
      pickup: validMulticityPlace(parsed.pickup) ? parsed.pickup : null,
      drop: validMulticityPlace(parsed.drop) ? parsed.drop : null,
      stops: stops.length ? stops : fresh.stops,
      date: validMulticityDate(date) ? date : '', endDate: validMulticityDate(endDate) ? endDate : '',
      time: /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : '',
      endTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(string(parsed.endTime, 5)) ? string(parsed.endTime, 5) : '',
      categoryId: typeof parsed.categoryId === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(parsed.categoryId) ? parsed.categoryId : '',
      notes: string(parsed.notes, 500),
    };
  } catch { return fresh; }
}
