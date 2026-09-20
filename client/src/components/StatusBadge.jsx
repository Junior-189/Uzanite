const statusStyles = {
  pending: 'bg-warning-50 text-warning-700 border border-warning-200',
  approved: 'bg-primary-50 text-primary-700 border border-primary-200',
  pending_payment: 'bg-orange-50 text-orange-700 border border-orange-200',
  paid: 'bg-success-50 text-success-700 border border-success-200',
  delivered: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  rejected: 'bg-danger-50 text-danger-700 border border-danger-200',
  active: 'bg-success-50 text-success-700 border border-success-200',
  inactive: 'bg-gray-100 text-gray-500 border border-gray-200',
};

export default function StatusBadge({ status, children }) {
  const label = children || status?.replace(/_/g, ' ');
  const cls = statusStyles[status] || 'bg-gray-100 text-gray-600 border border-gray-200';
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize ${cls}`}>
      {label}
    </span>
  );
}
