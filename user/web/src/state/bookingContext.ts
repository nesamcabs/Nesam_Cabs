// The booking context lives in its own module so its identity never changes while Booking.tsx is hot-reloaded in development.
// (A context created inside a module that also exports components is re-created on every edit: the provider still mounted above
// then no longer matches the consumers, which throw "BookingProvider is missing".)
import { createContext } from 'react';
import type { BookingValue } from './Booking';

export const BookingCtx = createContext<BookingValue | null>(null);
