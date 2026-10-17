import { type ReactNode, createContext, useCallback, useContext, useRef, useState } from 'react';

interface Toast {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
  tone?: 'error';
}

type Show = (toast: Omit<Toast, 'id'>) => void;

const ToastContext = createContext<Show>(() => {});

export const useToast = () => useContext(ToastContext);

const LIFETIME_MS = 6000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const show = useCallback<Show>(
    (toast) => {
      const id = nextId.current++;
      setToasts((t) => [...t.slice(-3), { ...toast, id }]);
      window.setTimeout(() => dismiss(id), LIFETIME_MS);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone ?? ''}`}>
            <span>{t.message}</span>
            {t.action && (
              <button
                className="toast-action"
                onClick={() => {
                  dismiss(t.id);
                  t.action!.run();
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
