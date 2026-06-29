"use client";

/**
 * A tiny error sink for task-detail server actions. Many small controls in the panel run a
 * server action and refresh; previously a returned `{ error }` was silently dropped. This
 * context lets every `useAction` report a rejection to one panel-level toast, so a refused
 * mutation (e.g. the Done-gate) is visible instead of looking like nothing happened.
 */
import { createContext, useCallback, useContext, useEffect, useState } from "react";

type Reporter = (message: string) => void;

const TaskErrorContext = createContext<Reporter | null>(null);

/** Report an action error to the nearest panel toast. No-op outside a provider. */
export function useReportActionError(): Reporter {
  const ctx = useContext(TaskErrorContext);
  return ctx ?? (() => {});
}

/** Wraps the panel; renders a transient toast when a child action reports an error. */
export function TaskErrorBoundary({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const report = useCallback((message: string) => setError(message), []);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(t);
  }, [error]);

  return (
    <TaskErrorContext.Provider value={report}>
      {children}
      {error ? (
        <div className={className} role="alert">
          {error}
        </div>
      ) : null}
    </TaskErrorContext.Provider>
  );
}
