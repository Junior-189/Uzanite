export function SkeletonText({ className = '', lines = 1 }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-4 bg-gray-200 rounded-lg animate-pulse" style={{ width: i === lines - 1 ? '60%' : '100%' }} />
      ))}
    </div>
  );
}

export function SkeletonCircle({ size = 40, className = '' }) {
  return <div className={`bg-gray-200 rounded-full animate-pulse ${className}`} style={{ width: size, height: size }} />;
}

export function SkeletonCard({ className = '' }) {
  return (
    <div className={`bg-white rounded-xl shadow-sm border border-gray-100 p-5 ${className}`}>
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-gray-200 animate-pulse" />
        <div className="flex-1 space-y-2">
          <div className="h-6 bg-gray-200 rounded-lg animate-pulse w-1/3" />
          <div className="h-4 bg-gray-200 rounded-lg animate-pulse w-1/2" />
        </div>
      </div>
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 4 }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="p-5">
        <div className="h-5 bg-gray-200 rounded-lg animate-pulse w-1/4 mb-4" />
        <div className="space-y-3">
          {Array.from({ length: rows }).map((_, r) => (
            <div key={r} className="flex gap-4">
              {Array.from({ length: cols }).map((_, c) => (
                <div key={c} className="h-4 bg-gray-100 rounded-lg animate-pulse" style={{ flex: c === 0 ? 2 : 1 }} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Skeleton({ variant = 'text', ...props }) {
  if (variant === 'card') return <SkeletonCard {...props} />;
  if (variant === 'table') return <SkeletonTable {...props} />;
  if (variant === 'circle') return <SkeletonCircle {...props} />;
  return <SkeletonText {...props} />;
}
