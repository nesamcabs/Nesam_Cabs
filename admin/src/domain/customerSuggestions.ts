// "Which existing customer is this?" for the booking forms: most bookings first, searched by number or name.
import type { Customer } from "../types";

export interface CustomerSuggestion {
  customer: Customer;
  /** Bookings that were not cancelled. */
  bookings: number;
  /** The 10-digit number; "" when this staff account only sees it masked. */
  digits: string;
  /** "+91 63790 56759", or the masked form. */
  phoneLabel: string;
}

const tenDigits = (v: unknown) => {
  const d = typeof v === "string" ? v.replace(/\D/g, "") : "";
  return d.length >= 10 ? d.slice(-10) : "";
};

export function rankCustomers(customers: Customer[], bookingsOf: (id: string) => number): CustomerSuggestion[] {
  return customers
    .map((customer) => {
      const digits = tenDigits(customer.phone);
      return { customer, digits, bookings: bookingsOf(customer.id), phoneLabel: digits ? `+91 ${digits.slice(0, 5)} ${digits.slice(5)}` : customer.phoneMasked || "" };
    })
    .sort((a, b) => b.bookings - a.bookings || (a.customer.name || "").localeCompare(b.customer.name || ""));
}

/** An empty query lists the most frequent customers. Digits search the number, anything else the name. */
export function searchCustomers(ranked: CustomerSuggestion[], query: string, limit = 8): CustomerSuggestion[] {
  const text = query.trim().toLowerCase();
  const isNumber = /^[+\d\s()-]+$/.test(text);
  let digits = text.replace(/\D/g, "");
  if (digits.length > 10) digits = digits.slice(-10);
  return ranked
    .filter((s) => {
      if (!text) return true;
      if (!isNumber) return (s.customer.name || "").toLowerCase().includes(text);
      if (s.digits) return s.digits.includes(digits);
      // Masked: only the first five digits are visible ("+91 63790 •••••").
      const visible = (s.customer.phoneMasked || "").replace(/\D/g, "").slice(2);
      return !!visible && (visible.startsWith(digits) || digits.startsWith(visible));
    })
    .slice(0, limit);
}
