/* Light/dark toggle.
 *
 * Three states, matching the token layer: explicit light, explicit dark, and unset
 * (follow the OS). The toggle cycles light → dark → follow, so a viewer can always
 * get back to "whatever my system says" rather than being stuck in a choice.
 *
 * The choice is stored, and the poster reads it: a poster generated while the app is
 * in dark mode should not come out on cream paper unless that was asked for.
 */

(function () {
  const KEY = 'coffee-theme';
  const root = document.documentElement;

  const stored = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  const store = (v) => {
    try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch { /* private mode */ }
  };

  function apply(mode) {
    if (mode === 'light' || mode === 'dark') root.setAttribute('data-theme', mode);
    else root.removeAttribute('data-theme');
    paintButton(mode);
    // Charts read their colours from the tokens, so they have to be told to redraw.
    dispatchEvent(new CustomEvent('themechange', { detail: { mode, resolved: resolved() } }));
  }

  /** What the page is actually showing right now, once the OS is taken into account. */
  function resolved() {
    const m = root.getAttribute('data-theme');
    if (m === 'light' || m === 'dark') return m;
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  const ICON = {
    light: '<circle cx="8" cy="8" r="3.4"/><path d="M8 .8v2M8 13.2v2M.8 8h2M13.2 8h2M2.9 2.9l1.4 1.4M11.7 11.7l1.4 1.4M13.1 2.9l-1.4 1.4M4.3 11.7l-1.4 1.4"/>',
    dark: '<path d="M13.4 9.6A5.8 5.8 0 0 1 6.4 2.6a5.9 5.9 0 1 0 7 7Z"/>',
    auto: '<circle cx="8" cy="8" r="5.6"/><path d="M8 2.4v11.2" /><path d="M8 2.4a5.6 5.6 0 0 1 0 11.2Z" fill="currentColor" stroke="none"/>',
  };

  function paintButton(mode) {
    const btn = document.getElementById('themeToggle');
    if (!btn) return;
    const key = mode === 'light' ? 'light' : mode === 'dark' ? 'dark' : 'auto';
    const label = key === 'auto' ? 'Theme: following your system' : `Theme: ${key}`;
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"
      stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">${ICON[key]}</svg>`;
    btn.setAttribute('title', label + ', click to change');
    btn.setAttribute('aria-label', label);
  }

  window.themeMode = () => stored() || 'auto';
  window.themeResolved = resolved;

  function wire() {
    const btn = document.getElementById('themeToggle');
    if (btn) {
      btn.addEventListener('click', () => {
        const now = stored();
        const next = now === 'light' ? 'dark' : now === 'dark' ? null : 'light';
        store(next);
        apply(next);
      });
    }
    apply(stored());
    // Following the OS means reacting when the OS changes.
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (!stored()) apply(null);
    });
  }

  // Set the attribute before first paint to avoid a flash of the wrong theme.
  const early = stored();
  if (early === 'light' || early === 'dark') root.setAttribute('data-theme', early);

  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', wire);
  else wire();
})();
