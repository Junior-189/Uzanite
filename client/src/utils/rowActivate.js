/**
 * Keyboard activation for elements that act as buttons.
 *
 * Applied to card/row elements that already have an `onClick`. Rather than
 * restructuring every list into semantic buttons (a large, risky refactor of
 * working layout), this gives those elements the three things a keyboard or
 * screen-reader user actually needs: a role, a tab stop, and Enter/Space
 * activation.
 *
 * Usage:
 *   <div {...rowActivate(() => openDetail(x))} className="...">
 */
export function rowActivate(onActivate, { label } = {}) {
  return {
    role: 'button',
    tabIndex: 0,
    'aria-label': label,
    onClick: onActivate,
    onKeyDown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onActivate?.(event);
      }
    },
  };
}

export default rowActivate;
