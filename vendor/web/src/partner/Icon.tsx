// Icons exactly as the client reference draws them: Lucide glyphs by name, plus the reference's own
// navigation / action drawings (stroke 1.6). Only the glyphs the Partner workspace uses are imported.
import React from 'react';
import {
  ArrowLeft, ArrowLeftRight, ArrowRight, ArrowUpRight, Bell, CalendarDays, Camera, CarFront, Check, CheckCheck, ChevronRight, CircleAlert,
  CircleCheck, CirclePause, CirclePlay, CirclePlus, CircleX, ClipboardList, Clock3, Download, FileCheck, FilePenLine, Headphones, House, Info,
  Landmark, LockKeyhole, LogOut, Pencil, Phone, Plus, ReceiptText, RefreshCw, Route, Search, Settings2, ShieldCheck, Trash2, TriangleAlert,
  Upload, UserRound, UserRoundCheck, UserRoundPlus, UsersRound, X, type LucideIcon,
} from 'lucide-react';

const LUCIDE: Record<string, LucideIcon> = {
  'arrow-left': ArrowLeft, 'arrow-left-right': ArrowLeftRight, 'arrow-right': ArrowRight, 'arrow-up-right': ArrowUpRight, bell: Bell,
  'calendar-days': CalendarDays, camera: Camera, 'car-front': CarFront, check: Check, 'check-check': CheckCheck, 'chevron-right': ChevronRight,
  'circle-alert': CircleAlert, 'circle-check': CircleCheck, 'circle-pause': CirclePause, 'circle-play': CirclePlay, 'circle-plus': CirclePlus,
  'circle-x': CircleX, 'clipboard-list': ClipboardList, 'clock-3': Clock3, download: Download, 'file-check': FileCheck, 'file-pen-line': FilePenLine,
  headphones: Headphones, house: House, info: Info, landmark: Landmark, 'lock-keyhole': LockKeyhole, 'log-out': LogOut, pencil: Pencil, phone: Phone,
  plus: Plus, 'receipt-text': ReceiptText, 'refresh-cw': RefreshCw, route: Route, search: Search, 'settings-2': Settings2, 'shield-check': ShieldCheck,
  'trash-2': Trash2, 'triangle-alert': TriangleAlert, upload: Upload, 'user-round': UserRound, 'user-round-check': UserRoundCheck,
  'user-round-plus': UserRoundPlus, 'users-round': UsersRound, x: X,
};

/** The reference's hand-drawn glyphs (vIcons). */
const DRAWN: Record<string, React.ReactNode> = {
  Bookings: <><rect x="4" y="5" width="16" height="16" rx="3" /><path d="M8 3v4m8-4v4M4 10h16m-11 6 2 2 4-5" /></>,
  Fleet: <path d="m4 11 2-6h12l2 6M3 11h18v8H3zm3 8v2m12-2v2M6 14h3m6 0h3M9 5V3h6v2" />,
  Trips: <><circle cx="6" cy="5" r="2" /><circle cx="18" cy="19" r="2" /><path d="M6 7v6a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V5m-3 3 3-3 3 3M12 5h2M10 19h2" /></>,
  Earnings: <path d="M4 21h16M6 17v-5m6 5V8m6 9V4M4 7l5-3 4 2 7-4" />,
  Wallet: <><path d="M20 7H5a2 2 0 0 1 0-4h13v4M5 7H3v12a2 2 0 0 0 2 2h15V7Zm10 5h6v5h-6a2 2 0 0 1 0-5Z" /><circle cx="16" cy="14.5" r=".5" /></>,
  AcceptDuty: <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></>,
  Offer: <><path d="M4 20h16M6 15l5-5 4 3 5-8m-5 0h5v5" /><circle cx="5" cy="6" r="2" /></>,
  AssignDriver: <><circle cx="8" cy="6" r="3" /><path d="M2 18v-2a6 6 0 0 1 10-4" /><circle cx="17" cy="16" r="5" /><path d="M12 15h10m-5 1v5m-2-8 2 3 2-3" /></>,
  Business: <path d="M3 22V7a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v15M9 5V2h10v8h3v12H2M7 9h3M7 13h3M7 17h3M18 14v3M18 21v1" />,
};

export type IconName = keyof typeof LUCIDE | keyof typeof DRAWN | string;

/** `<i data-lucide>` in the reference becomes an <svg class="lucide lucide-name"> — the same element Lucide renders. */
export const Icon: React.FC<{ name: IconName; className?: string }> = ({ name, className }) => {
  const drawn = DRAWN[name];
  if (drawn) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
        {drawn}
      </svg>
    );
  }
  const L = LUCIDE[name];
  if (!L) return null;
  return <L aria-hidden="true" className={className ? `lucide lucide-${name} ${className}` : `lucide lucide-${name}`} width={24} height={24} />;
};
