import { QueryClient } from '@tanstack/react-query';

/**
 * Shared TanStack Query client. Defaults are tuned for the slow, intermittent
 * mobile networks this app runs on:
 *  - queries retry twice with backoff; mutations NEVER retry (a retried order or
 *    payment can duplicate money or stock — the API uses idempotency keys and an
 *    explicit retry belongs to the caller);
 *  - a short freshness window cuts redundant refetches on tab focus;
 *  - refetch on reconnect so a device that was offline catches up automatically.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 0,
    },
  },
});
