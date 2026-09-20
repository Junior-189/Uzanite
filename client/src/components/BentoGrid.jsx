export default function BentoGrid({ children }) {
  return (
    <div className="bento-grid">
      {children}
    </div>
  );
}

export function BentoCard({ size = 'sm', className = '', children, ...props }) {
  const sizeClasses = {
    sm: 'bento-sm',
    md: 'bento-md',
    lg: 'bento-lg',
    wide: 'bento-wide',
    tall: 'bento-tall',
  };

  return (
    <div className={`bento-card ${sizeClasses[size] || ''} ${className}`} {...props}>
      {children}
    </div>
  );
}
