import { QueryClient } from '@tanstack/react-query';

/**
 * One query cache for the app. Sensitive data (anything from teacher/admin endpoints) uses query
 * keys that start with SENSITIVE so it can be purged the moment the classroom PIN lock engages
 * (PIN-3, PIN-6). Classroom-safe data uses ['classroom', …].
 */
export const SENSITIVE = 'sensitive';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: true, staleTime: 15_000 },
    mutations: { retry: false },
  },
});

/** Drop every sensitive query (data AND in-flight requests) from the cache. */
export function purgeSensitive(qc: QueryClient = queryClient) {
  void qc.cancelQueries({ queryKey: [SENSITIVE] });
  qc.removeQueries({ queryKey: [SENSITIVE] });
}
