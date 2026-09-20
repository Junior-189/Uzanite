/**
 * A row/card that behaves like a real button.
 *
 * The app had ~30 clickable `<div>` and `<span>` elements. Visually they look
 * interactive, but they are invisible to keyboard and screen-reader users: not
 * focusable, not announced, not activatable with Enter or Space. That matters
 * here more than in a typical admin tool, because TalkBack is common on the
 * low-end Android devices this product targets, and shop staff often operate
 * the POS one-handed.
 *
 * Use this instead of putting `onClick` on a div. It renders a real element
 * with keyboard activation, focus styling, and an accessible name.
 */
export default function ClickableRow({
  onClick,
  children,
  className = '',
  label,
  as: Element = 'div',
  disabled = false,
  ...rest
}) {
  const handleKeyDown = (event) => {
    if (disabled) return;
    // Enter and Space are what a native button responds to.
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick?.(event);
    }
  };

  return (
    <Element
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      aria-label={label}
      onClick={disabled ? undefined : onClick}
      onKeyDown={handleKeyDown}
      className={`cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 ${className}`}
      {...rest}
    >
      {children}
    </Element>
  );
}
