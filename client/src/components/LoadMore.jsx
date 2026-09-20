// Reusable "load more" control for cursor-paginated lists.
export default function LoadMore({ onClick, loading = false, hasMore = false, label = 'Load more' }) {
  if (!hasMore) return null;
  return (
    <div className="flex justify-center py-4">
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 text-sm font-medium transition-colors disabled:opacity-50"
      >
        <i className={`fas ${loading ? 'fa-spinner fa-spin' : 'fa-chevron-down'}`} aria-hidden="true"></i>
        {label}
      </button>
    </div>
  );
}
