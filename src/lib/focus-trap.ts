// Svelte-action: focus-trap voor modals.
// Bij openen: onthoud de vorige focus en verplaats focus naar de modal.
// Tab/Shift+Tab blijven binnen de modal. Bij sluiten: focus terug.
// Toepassen op de modal-container: <div use:focusTrap ...>
export function focusTrap(node: HTMLElement) {
  const previouslyFocused = document.activeElement as HTMLElement | null;

  const selector = [
    'a[href]', 'button:not([disabled])', 'input:not([disabled])',
    'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  const focusable = () =>
    Array.from(node.querySelectorAll<HTMLElement>(selector))
      .filter((el) => el.offsetParent !== null); // alleen zichtbare

  // Focus het eerste bedienbare element, anders de container zelf
  const first = focusable()[0];
  if (first) first.focus();
  else { node.setAttribute('tabindex', '-1'); node.focus(); }

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Tab') return;
    const items = focusable();
    if (items.length === 0) { e.preventDefault(); return; }
    const firstEl = items[0];
    const lastEl = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === firstEl || active === node)) {
      e.preventDefault();
      lastEl.focus();
    } else if (!e.shiftKey && active === lastEl) {
      e.preventDefault();
      firstEl.focus();
    }
  }

  node.addEventListener('keydown', onKeydown);

  return {
    destroy() {
      node.removeEventListener('keydown', onKeydown);
      // Focus terug naar het element dat de modal opende (indien nog in de DOM)
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
    },
  };
}
