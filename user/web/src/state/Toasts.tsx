import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';

interface ToastInput {
  title: string;
  message?: string;
  tone?: 'info' | 'success' | 'warning';
  action?: { label: string; run: () => void };
  /** ms; 0 keeps it until dismissed. */
  duration?: number;
}

interface ToastItem extends ToastInput {
  id: number;
}

interface ToastApi {
  push: (t: ToastInput) => void;
}

const Ctx = createContext<ToastApi>({ push: () => undefined });
export const useToasts = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const push = useCallback(
    (t: ToastInput) => {
      const id = nextId.current++;
      setItems((list) => [...list.slice(-2), { ...t, id }]);
      const ms = t.duration ?? 6000;
      if (ms > 0) timers.current.set(id, window.setTimeout(() => dismiss(id), ms));
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((t) => window.clearTimeout(t));
  }, []);

  const api = useMemo(() => ({ push }), [push]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div className="toast" key={t.id}>
            <Icon name={t.tone === 'success' ? 'success' : t.tone === 'warning' ? 'warning' : 'notifications'} />
            <div className="toast__body">
              <strong>{t.title}</strong>
              {t.message ? <span>{t.message}</span> : null}
              {t.action ? (
                <button
                  type="button"
                  className="toast__action"
                  onClick={() => {
                    t.action!.run();
                    dismiss(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              ) : null}
            </div>
            <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              <Icon name="close" size={18} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
