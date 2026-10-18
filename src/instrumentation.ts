// Starts the background worker inside the Next.js server process (Node runtime only).
// The NEXT_RUNTIME check must wrap the import so the edge build drops it entirely.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation-node');
  }
}
