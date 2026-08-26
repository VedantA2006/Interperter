'use client';

import { useEffect } from 'react';

export function UnhandledRejectionGuard() {
  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      if (reason && typeof reason === 'object' && !(reason instanceof Error)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        console.warn('Suppressed non-Error promise rejection:', reason);
      }
    };

    window.addEventListener('unhandledrejection', handleUnhandledRejection, true);
    return () => window.removeEventListener('unhandledrejection', handleUnhandledRejection, true);
  }, []);

  return null;
}