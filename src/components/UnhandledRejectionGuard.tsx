'use client';

import { useEffect } from 'react';

export function UnhandledRejectionGuard() {
  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      if (reason && typeof reason === 'object' && !(reason instanceof Error)) {
        event.preventDefault();
        console.warn('Suppressed non-Error promise rejection:', reason);
      }
    };

    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    return () => window.removeEventListener('unhandledrejection', handleUnhandledRejection);
  }, []);

  return null;
}