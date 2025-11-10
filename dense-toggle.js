// Dense Tables Toggle
//
// This script inserts a "Dense tables" checkbox into the navigation controls
// on every page and toggles a global `dense` class on the <body> when
// checked.  When enabled, table rows and headers reduce their padding
// and font size to display more information in the same vertical space.
// The toggle state is persisted in localStorage under the
// `showtime:denseTables` key so that the user’s preference carries
// across pages and sessions.

(function() {
  function initDenseToggle() {
    // Locate the navigation controls container; default to the nav itself.
    const nav = document.querySelector('nav');
    if (!nav) return;
    const controlsContainer = nav.querySelector('.nav-controls') || nav;
    // Avoid adding multiple toggles if the script is loaded more than once.
    if (document.getElementById('denseToggle')) return;
    // Build the label and checkbox elements.
    const label = document.createElement('label');
    label.title = 'Toggle compact tables';
    label.style.display = 'flex';
    label.style.alignItems = 'center';
    label.style.gap = '0.25rem';
    // Add some left padding to separate from adjacent controls
    label.style.paddingLeft = '0.5rem';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = 'denseToggle';
    input.style.width = '1rem';
    input.style.height = '1rem';
    // Retrieve saved state from localStorage and apply to body class.  If no
    // preference has been stored yet (null), default to enabled.  This
    // provides a compact view by default on first load.  Persist the
    // default so subsequent loads are consistent.  Use a try/catch to
    // guard against browsers that block localStorage.
    try {
      const saved = localStorage.getItem('showtime:denseTables');
      if (saved === '1') {
        input.checked = true;
        document.body.classList.add('dense');
      } else if (saved === null) {
        // No stored preference: default to checked
        input.checked = true;
        document.body.classList.add('dense');
        localStorage.setItem('showtime:denseTables', '1');
      }
    } catch (_) {
      // If localStorage is unavailable, still default to dense
      input.checked = true;
      document.body.classList.add('dense');
    }
    const span = document.createElement('span');
    span.textContent = 'Dense tables';
    span.style.fontSize = '0.8rem';
    // Prevent text selection on double click
    span.style.userSelect = 'none';
    label.appendChild(input);
    label.appendChild(span);
    // Append the toggle to the nav controls
    controlsContainer.appendChild(label);
    // Listen for changes and toggle the `dense` class accordingly
    input.addEventListener('change', e => {
      const checked = e.target.checked;
      document.body.classList.toggle('dense', checked);
      try {
        localStorage.setItem('showtime:denseTables', checked ? '1' : '0');
      } catch (_) {}
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDenseToggle);
  } else {
    initDenseToggle();
  }
})();
