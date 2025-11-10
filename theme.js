/*
 * Theme picker logic for Showtime Builder.
 *
 * This script reads two CSS variables, --brand-from and --brand-to, from
 * localStorage on page load and applies them to the document element. It
 * registers click handlers on any element with data-brand-from and
 * data-brand-to attributes so that selecting a swatch updates the
 * gradient colours across the app. The selected colours persist across
 * page loads via localStorage. If localStorage is unavailable, the
 * picker gracefully degrades and uses the default colours defined in
 * theme.css.
 */
(function(){
  /**
   * Apply the provided colours to the CSS custom properties. Persist
   * the selection to localStorage so it can be restored on subsequent
   * page loads.
   *
   * @param {string} from - The starting colour of the gradient.
   * @param {string} to   - The ending colour of the gradient.
   */
  function apply(from, to) {
    document.documentElement.style.setProperty('--brand-from', from);
    document.documentElement.style.setProperty('--brand-to', to);
    try {
      localStorage.setItem('showtime:brand-from', from);
      localStorage.setItem('showtime:brand-to', to);
    } catch (err) {
      // localStorage may be unavailable in some contexts (e.g. private mode). Ignore errors.
    }
  }
  document.addEventListener('DOMContentLoaded', function() {
    // Attempt to restore previously selected colours.
    try {
      const from = localStorage.getItem('showtime:brand-from');
      const to = localStorage.getItem('showtime:brand-to');
      if (from && to) {
        apply(from, to);
      }
    } catch (err) {
      /* ignore */
    }
    // Wire up click handlers for all swatch buttons. Each button
    // specifies the colours it represents via data-brand-from and
    // data-brand-to attributes.
    document.querySelectorAll('[data-brand-from][data-brand-to]').forEach(btn => {
      btn.addEventListener('click', function() {
        const from = btn.getAttribute('data-brand-from');
        const to = btn.getAttribute('data-brand-to');
        apply(from, to);
      });
    });
  });
})();