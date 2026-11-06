'use client';

/*
 * The last resort: the root layout itself failed, so nothing of the design
 * system can be assumed. Plain HTML, plain words, one way forward.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          background: '#0b0d10',
          color: '#f5f7fa',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <main
          style={{ textAlign: 'center', padding: '1.5rem' }}
          data-testid="global-error"
        >
          <h1 style={{ fontSize: '1.25rem', margin: '0 0 0.5rem' }}>
            ForgeMind could not load
          </h1>
          <p style={{ color: '#a1a8b3', margin: '0 0 1rem' }}>
            Something failed before the page could start. Reloading usually
            fixes it.
          </p>
          {(error.digest ?? error.message) && (
            <p
              style={{
                color: '#727b88',
                fontFamily: 'monospace',
                fontSize: '0.75rem',
                margin: '0 0 1rem',
              }}
            >
              {error.digest ?? error.message}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              background: '#6ea8fe',
              color: '#0b0d10',
              border: 0,
              borderRadius: '0.375rem',
              padding: '0.5rem 1rem',
              font: 'inherit',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </main>
      </body>
    </html>
  );
}
