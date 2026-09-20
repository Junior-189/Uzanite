// Reusable empty-state block for consistent UX across pages.
export default function EmptyState({ icon = 'fa-inbox', title, description, action }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
      <i className={`fas ${icon} text-5xl text-gray-300 mb-4`} aria-hidden="true"></i>
      {title && <h3 className="text-lg font-semibold text-gray-600">{title}</h3>}
      {description && <p className="text-sm text-gray-400 mt-1">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
