export default function UzerLogo({ size = 40, className = '' }) {
  const s = typeof size === 'number' ? size : 40;
  return (
    <svg
      width={s} height={s} viewBox="0 0 48 48"
      className={className}
      style={{ minWidth: s, minHeight: s }}
    >
      {/* Phone body */}
      <rect x="6" y="2" width="36" height="44" rx="7" fill="#10b981"/>
      {/* Screen area */}
      <rect x="10" y="8" width="28" height="33" rx="3" fill="#10b981"/>
      {/* UZANITE text */}
      <text x="24" y="30" fontFamily="Inter, Arial, sans-serif" fontSize="6.5" fontWeight="800" fill="white" textAnchor="middle">UZANITE</text>
    </svg>
  );
}
