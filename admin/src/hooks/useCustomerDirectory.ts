import { useCallback, useEffect, useRef, useState } from "react";
import type { Customer } from "../types";
import { describeDataError } from "../services/adminFirestoreService";
import { fetchDirectory, fetchNumberViews, type DirectoryViewer, type NumberViews } from "../services/customerDirectoryService";

const POLL_MS = 30000;

interface Dir { customers: Customer[] | null; viewer: DirectoryViewer | null; error: string | null; truncated: boolean }

/**
 * The masked customer list and the reveal ledger. Neither carries a raw mobile number. Polled (like the redacted booking list)
 * and refreshed on demand after a write. `scope` identifies the signed-in actor and access: when it changes nothing from the previous one is kept.
 */
export function useCustomerDirectory(scope: string) {
  const [dir, setDir] = useState<Dir>({ customers: null, viewer: null, error: null, truncated: false });
  const [views, setViews] = useState<NumberViews | null>(null);
  const [viewsError, setViewsError] = useState<string | null>(null);
  const alive = useRef(0);

  const load = useCallback(async (which: "all" | "views" = "all") => {
    const token = alive.current;
    if (which === "all") {
      try {
        const r = await fetchDirectory();
        if (token === alive.current) setDir({ customers: r.customers, viewer: r.viewer, error: null, truncated: r.truncated });
      } catch (e) {
        if (token === alive.current) setDir((d) => ({ ...d, error: (e as Error).message || describeDataError(e) }));
      }
    }
    try {
      const v = await fetchNumberViews();
      if (token === alive.current) { setViews(v); setViewsError(null); }
    } catch (e) {
      if (token === alive.current) setViewsError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    const token = ++alive.current;
    setDir({ customers: null, viewer: null, error: null, truncated: false });
    setViews(null);
    void load();
    const t = window.setInterval(() => { if (token === alive.current && !document.hidden) void load(); }, POLL_MS);
    return () => { alive.current++; window.clearInterval(t); };
  }, [scope, load]);

  return { ...dir, views, viewsError, refresh: load };
}
