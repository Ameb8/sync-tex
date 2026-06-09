export function scheduleIdleWarmup(callback, options = {}) {
  const timeout = options.timeout ?? 3000;
  const fallbackDelay = options.fallbackDelay ?? 1200;

  if ('requestIdleCallback' in window) {
    const id = window.requestIdleCallback(callback, { timeout });
    return () => window.cancelIdleCallback(id);
  }

  const id = window.setTimeout(callback, fallbackDelay);
  return () => window.clearTimeout(id);
}
