import { useCallback, useState } from 'react';
import api from '../utils/api';

/**
 * Cursor pagination for list pages. The platform returns `{ <entity>, nextCursor }`;
 * this fetches the next page and hands the rows to `onAppend`, which merges them
 * into page state. No-ops when there is no cursor.
 */
export function useLoadMore(entity, onAppend, limit = 50) {
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await api.get(`/${entity}`, { params: { cursor: nextCursor, limit } });
      if (res.success) {
        onAppend(res[entity] || []);
        setNextCursor(res.nextCursor || null);
      }
    } catch {
      /* keep the current page; the user can retry */
    } finally {
      setLoadingMore(false);
    }
  }, [entity, nextCursor, loadingMore, limit, onAppend]);

  return { nextCursor, setNextCursor, loadMore, loadingMore };
}

export default useLoadMore;
