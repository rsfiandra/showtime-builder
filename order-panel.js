// Order Panel: collapsible order list visible on every page.
// This script creates a toggle button and an overlay panel that displays
// the start‑time order of shows with up/down nudge controls. It reads
// from the global ShowtimeState and writes overrides via
// ShowtimeState.updateShowStart. The panel is hidden by default and
// appears when the toggle button is clicked. When visible, it
// re‑renders whenever state changes.

(() => {
  const ShowtimeState = window.ShowtimeState;
  if (!ShowtimeState) return;
  function initOrderPanel() {
    // Track which show is currently selected in the order panel. When a row
    // is clicked, we store its id here and re-render to apply a purple
    // highlight. This parallels the original React implementation where
    // the active show was highlighted.
    let activeShowId = null;
    // Insert toggle button into the nav bar. If a nav is present,
    // append the button; otherwise insert at top of body.
    const nav = document.querySelector('nav');
    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'orderPanelToggleBtn';
    toggleBtn.textContent = 'Show Order';
    // Style the toggle button similarly to other header buttons.  Do not
    // assign ml-auto here; placement is handled when the button is
    // appended to the navigation controls container below.
    toggleBtn.className = 'px-3 py-1 bg-indigo-700 text-white rounded-lg hover:bg-indigo-800 text-sm';
    // Insert the toggle button into a navigation controls container if
    // available; otherwise append it at the end of the nav.  Pages that
    // define a `.nav-controls` container will group all controls on a
    // dedicated row below the navigation links.  This ensures the Show/Hide
    // Order button stays with the other controls and doesn't push
    // navigation links off screen.
    if (nav) {
      const controlsContainer = nav.querySelector('.nav-controls');
      if (controlsContainer) {
        controlsContainer.appendChild(toggleBtn);
      } else {
        nav.appendChild(toggleBtn);
      }
    } else {
      document.body.insertBefore(toggleBtn, document.body.firstChild);
    }
    // Create panel container. It may be initially hidden depending on saved state.
    const panel = document.createElement('div');
    panel.id = 'orderPanel';
    // Style the panel as a sidebar within the page flow rather than an overlay.
    // We omit position classes (`fixed top-0 bottom-0 right-0`) so that the panel
    // participates in the normal flex layout and pushes the main content to
    // the left when visible.  The width matches the React version (~28rem).
    // Increase panel width slightly from ~28rem to 30rem so that the
    // start‑time order list has more breathing room.  With the main tables
    // narrowed, the page still has space to accommodate a wider panel.
    // Increase the minimum width of the order panel slightly so header labels
    // remain on one line.  Using 34rem provides extra breathing room compared
    // to the prior 30rem width.  See issue reported by users when labels
    // wrapped prematurely.
    panel.className = 'hidden bg-white border-l border-gray-300 shadow-lg w-[34rem] flex flex-col rounded-l-lg';
    // Make the panel focusable so it can capture keyboard events when needed.
    panel.tabIndex = 0;
    // Prevent the panel from shrinking horizontally when the viewport
    // narrows.  Without this, flexbox can reduce the panel width and
    // cause the header labels to wrap onto multiple lines.  Setting
    // flexShrink to 0 ensures the panel retains its intrinsic width and
    // keeps the Start‑Clean‑Aud‑Film‑Nudge header on a single line.
    panel.style.flexShrink = '0';
    // Prepare header‑level nudge buttons.  These will be appended to the
    // header after both the title and a right group container are created.
    // We declare them here so the click handlers can be attached after
    // nudgeShow is defined later in this file.
    let headerNudgeUpBtn = null;
    let headerNudgeDownBtn = null;

    // Add header with close button
    const header = document.createElement('div');
    // Use the dynamic gradient header class so the order panel header updates
    // with the selected theme colours. The grad-header class is defined in
    // theme.css and uses CSS variables controlled by the swatch picker.
    header.className = 'flex justify-between items-center grad-header px-3 py-2 rounded-t-lg';
    const title = document.createElement('span');
    title.textContent = 'Start‑Time Order';
    title.className = 'font-semibold text-sm';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'text-white hover:text-gray-200';
    closeBtn.textContent = '×';
    // When the close button is clicked, collapse the panel and persist the state
    closeBtn.addEventListener('click', () => {
      applyPanelState(false);
    });
    // Create container for header nudge buttons and close button.  The
    // container groups the nudge controls with the close button so that
    // they remain aligned on the right side of the header.  Space between
    // the title and this group is handled by the parent flex layout.
    const headerButtons = document.createElement('div');
    headerButtons.className = 'flex items-center space-x-1';
    // Create the header nudge buttons but do not attach handlers yet.  We
    // assign them to the declared variables so they are accessible later.
    headerNudgeUpBtn = document.createElement('button');
    // Style header-level nudge buttons with a dark text colour so the ▲/▼ icons
    // are visible against the white background even when the parent header
    // inherits a white font colour. Without an explicit text colour, the
    // buttons inherit the header’s white font colour and the arrows become
    // invisible on the white button background (see issue reported by user).
    headerNudgeUpBtn.className = 'inline-flex items-center border rounded-lg px-2 py-0.5 bg-white hover:bg-gray-50 shadow-sm text-sm text-gray-700';
    headerNudgeUpBtn.textContent = '▲';
    headerNudgeDownBtn = document.createElement('button');
    headerNudgeDownBtn.className = 'inline-flex items-center border rounded-lg px-2 py-0.5 bg-white hover:bg-gray-50 shadow-sm text-sm text-gray-700';
    headerNudgeDownBtn.textContent = '▼';
    // Append buttons to the header button group
    headerButtons.appendChild(headerNudgeUpBtn);
    headerButtons.appendChild(headerNudgeDownBtn);
    // Append close button after nudge buttons
    headerButtons.appendChild(closeBtn);
    // Assemble header: title on left, button group on right
    header.appendChild(title);
    header.appendChild(headerButtons);
    panel.appendChild(header);
    // Add table container
    const container = document.createElement('div');
    container.className = 'overflow-y-auto';
    // Create table
    const table = document.createElement('table');
    table.className = 'min-w-full divide-y divide-gray-200 text-xs';
    // Build header row
    const thead = document.createElement('thead');
    thead.className = 'bg-gray-100';
    const headerRow = document.createElement('tr');
    ['Start','Clean','Aud','Film','Nudge'].forEach(label => {
      const th = document.createElement('th');
      th.className = 'px-3 py-1 text-left uppercase tracking-wide text-gray-600';
      th.textContent = label;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);
    // Body for rows
    const tbody = document.createElement('tbody');
    tbody.id = 'orderPanelBody';
    table.appendChild(tbody);
    container.appendChild(table);
    panel.appendChild(container);
    // Do not immediately append the panel to the body.  It will be inserted
    // into a content wrapper later so that it aligns with the main content.

    // The panel is no longer absolutely positioned; it will be placed into
    // a flex wrapper alongside the main content.  We therefore omit the
    // previous positioning logic that adjusted its top offset relative to
    // the navigation bar and swatch row.

    // Helper to apply the open/closed state to the panel and adjust the
    // surrounding layout. When the panel is visible the content wrapper
    // displays its children horizontally (main content and panel), and
    // the main content grows to fill remaining space. When hidden the
    // wrapper collapses to a single column and the panel is removed from
    // the flex flow via the `hidden` class.
    function applyPanelState(open) {
      const wrapper = document.getElementById('contentWrapper');
      const main = document.getElementById('mainContent');
      if (open) {
        panel.classList.remove('hidden');
        toggleBtn.textContent = 'Hide Order';
        if (wrapper) wrapper.classList.add('with-order');
        if (main) main.classList.add('flex-grow');
        render();
        // Focus the panel so that it can receive keyboard events (arrow navigation).  
        // Without focusing, keydown events may be captured by other parts of the page.
        try {
          panel.focus();
        } catch {}
      } else {
        panel.classList.add('hidden');
        toggleBtn.textContent = 'Show Order';
        if (wrapper) wrapper.classList.remove('with-order');
        if (main) main.classList.remove('flex-grow');
      }
      // Persist the state
      if (ShowtimeState.state) {
        ShowtimeState.state.showOrderPanel = open;
        ShowtimeState.save();
      }
    }

    /**
     * Build the structural wrapper for the page so that the order panel can sit
     * beside the main content.  This function finds the navigation bar and
     * optional swatch row, then wraps all subsequent body children into
     * a `contentWrapper` element.  Inside the wrapper we create a
     * `mainContent` container for the existing page content and append the
     * order panel.  A small stylesheet is injected on first run to
     * implement the flex behaviour when the panel is visible.
     */
    function createContentWrapper() {
      // Avoid re‑creating the wrapper if it already exists
      if (document.getElementById('contentWrapper')) return;
      // Identify nav and swatch row
      const navEl = document.querySelector('nav');
      const swatchButton = document.querySelector('.swatch');
      const swatchRow = swatchButton ? swatchButton.parentElement : null;
      // Determine insertion point after which the wrapper should be inserted
      let insertAfter = null;
      if (swatchRow && swatchRow.parentElement === document.body && navEl && swatchRow.previousElementSibling === navEl) {
        insertAfter = swatchRow;
      } else if (navEl && navEl.parentElement === document.body) {
        insertAfter = navEl;
      } else {
        insertAfter = null;
      }
      // Create wrapper and main containers
      const wrapper = document.createElement('div');
      wrapper.id = 'contentWrapper';
      wrapper.className = 'w-full';
      const main = document.createElement('div');
      main.id = 'mainContent';
      // Move all siblings after insertion point into main container
      let startNode = insertAfter ? insertAfter.nextSibling : document.body.firstChild;
      const toMove = [];
      while (startNode) {
        const next = startNode.nextSibling;
        toMove.push(startNode);
        startNode = next;
      }
      toMove.forEach(node => {
        main.appendChild(node);
      });
      // Append main and panel into wrapper
      wrapper.appendChild(main);
      wrapper.appendChild(panel);
      // Insert wrapper into DOM
      if (insertAfter) {
        insertAfter.parentElement.insertBefore(wrapper, insertAfter.nextSibling);
      } else {
        document.body.insertBefore(wrapper, document.body.firstChild);
      }
      // Prevent horizontal scrolling when the order panel is visible.  Without
      // this, the combined width of the nav bar and the content wrapper can
      // exceed the viewport when the panel is open, resulting in a horizontal
      // scrollbar.  Setting overflow-x to hidden on the body hides this scroll
      // bar and mirrors the behaviour of the original React implementation.
      document.body.style.overflowX = 'hidden';
      // Inject CSS rules once to control layout when panel is visible
      if (!document.getElementById('orderPanelStyles')) {
        const style = document.createElement('style');
        style.id = 'orderPanelStyles';
        style.textContent = `
#contentWrapper.with-order {
  display: flex;
}
#contentWrapper.with-order #mainContent {
  flex-grow: 1;
}
#contentWrapper:not(.with-order) {
  display: block;
}
/* Prevent wrapping of the header cells inside the order panel table. */
#orderPanel table th {
  white-space: nowrap;
}
        `;
        document.head.appendChild(style);
      }
    }

    // Helper to normalize times: treat times before 5:00a as next day.
    function normalizeDate(dt) {
      const n = new Date(dt);
      if (n.getHours() < 5) {
        n.setDate(n.getDate() + 1);
      }
      return n;
    }
    // Compute time gap between current show and next show in same auditorium.
    function cleanGap(current, shows) {
      let next = null;
      const currNormStart = normalizeDate(current.start);
      shows.forEach(rec => {
        if (rec.audId === current.audId) {
          const recNormStart = normalizeDate(rec.start);
          if (recNormStart > currNormStart) {
            if (!next || recNormStart < normalizeDate(next.start)) {
              next = rec;
            }
          }
        }
      });
      if (!next) return '';
      const mins = Math.floor((normalizeDate(next.start) - normalizeDate(current.end)) / 60000);
      return mins;
    }
    function formatCleanLabel(mins) {
      if (mins === '') return '';
      if (mins >= 60) {
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return `${h}h${String(m).padStart(2,'0')}m`;
      }
      return `${mins}m`;
    }
    function nudgeShow(rec, dir) {
      const newDate = new Date(rec.start.getTime() + dir * 5 * 60000);
      const hm = ShowtimeState.hmFromDate(newDate);
      ShowtimeState.updateShowStart(rec.id, hm);
      // Fire storage event manually to notify other components in same page
      try {
        const evt = new Event('storage');
        window.dispatchEvent(evt);
      } catch {}
      render();
    }

    // Attach click handlers to the header‑level nudge buttons once nudgeShow is defined.
    // These handlers adjust the start time of the currently active show (selected row)
    // by ±5 minutes. They rely on the global activeShowId, normalizeDate helper and
    // ShowtimeState.getAllShows() to find the corresponding record. Use a
    // data‑bound attribute to avoid reattaching listeners on subsequent renders.
    if (headerNudgeUpBtn && !headerNudgeUpBtn.hasAttribute('data-bound')) {
      headerNudgeUpBtn.setAttribute('data-bound', 'true');
      headerNudgeUpBtn.addEventListener('click', (e) => {
        // Prevent click from bubbling to the header or other handlers
        e.stopPropagation();
        // If no show is active, do nothing
        if (!activeShowId) return;
        // Build sorted list of shows as done in render()
        const shows = ShowtimeState.getAllShows().slice().sort((a, b) => {
          const an = normalizeDate(a.start);
          const bn = normalizeDate(b.start);
          return an - bn;
        });
        const rec = shows.find(r => r.id === activeShowId);
        if (!rec) return;
        // Nudge backwards by 5 minutes
        nudgeShow(rec, -1);
      });
    }
    if (headerNudgeDownBtn && !headerNudgeDownBtn.hasAttribute('data-bound')) {
      headerNudgeDownBtn.setAttribute('data-bound', 'true');
      headerNudgeDownBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!activeShowId) return;
        const shows = ShowtimeState.getAllShows().slice().sort((a, b) => {
          const an = normalizeDate(a.start);
          const bn = normalizeDate(b.start);
          return an - bn;
        });
        const rec = shows.find(r => r.id === activeShowId);
        if (!rec) return;
        // Nudge forwards by 5 minutes
        nudgeShow(rec, 1);
      });
    }
    function render() {
      // Ensure prime rows exist if necessary (copied from order.js)
      (function ensurePrimeRows() {
        const state = ShowtimeState.state;
        if (!state.primeRows || state.primeRows.length === 0) {
          const rows = [];
          (state.bookings || []).forEach(b => {
            if (!b.filmId) return;
            rows.push({
              rowId: `PRB-${b.id}`,
              bookingId: b.id,
              slot: b.slot,
              filmId: b.filmId,
              audId: null,
              primeHM: ''
            });
          });
          if (rows.length > 0) {
            state.primeRows = rows;
            ShowtimeState.save();
          }
        }
      })();
      const allShows = ShowtimeState.getAllShows();
      // Sort shows chronologically
      const shows = allShows.slice().sort((a, b) => {
        const an = normalizeDate(a.start);
        const bn = normalizeDate(b.start);
        return an - bn;
      });
      // Render rows
      tbody.innerHTML = '';
      shows.forEach((rec, idx) => {
        const tr = document.createElement('tr');
        // Tag the row with filmId for highlighting.  When a film is selected
        // from the highlight dropdown, rows matching this filmId will
        // receive the film-highlight class.  rec.filmId may be absent for
        // manual shows; in that case the dataset is not set.
        if (rec.filmId) {
          tr.dataset.filmid = String(rec.filmId);
        }
        // Apply a purple ring and light background when this row is active
        const baseClass = 'hover:bg-gray-50';
        const activeClass = 'ring-2 ring-purple-400 bg-purple-50';
        tr.className = (rec.id === activeShowId) ? `${baseClass} ${activeClass}` : baseClass;
        // Add a thin medium‑grey bottom border when the next show starts in a
        // different hour. A subtle grey (#9ca3af) helps visual separation
        // of hour blocks without the starkness of black.  See issue #.
        if (idx < shows.length - 1) {
          const currHour = normalizeDate(rec.start).getHours();
          const nextHour = normalizeDate(shows[idx + 1].start).getHours();
          if (currHour !== nextHour) {
            tr.style.borderBottom = '1px solid #9ca3af';
          }
        }
        // When a row is clicked, set it as active and re-render to update
        tr.addEventListener('click', () => {
          // Update the active show id locally
          activeShowId = rec.id;
          // Notify other components of the active show change so the
          // schedule grid can highlight the corresponding cell. We
          // dispatch a custom event with the show id.
          try {
            const evt = new CustomEvent('activeShowChange', { detail: { showId: rec.id } });
            window.dispatchEvent(evt);
          } catch {}
          render();
        });
        // Start
        const tdStart = document.createElement('td');
        tdStart.className = 'px-3 py-1 font-mono tabular-nums';
        tdStart.textContent = ShowtimeState.to12(rec.start);
        tr.appendChild(tdStart);
        // Clean gap
        const gap = cleanGap(rec, shows);
        const tdClean = document.createElement('td');
        tdClean.className = 'px-3 py-1 font-mono tabular-nums';
        const label = formatCleanLabel(gap);
        if (label && gap < 15) {
          const span = document.createElement('span');
          span.className = 'bg-yellow-100 rounded px-1';
          span.textContent = label;
          tdClean.appendChild(span);
        } else {
          tdClean.textContent = label;
        }
        tr.appendChild(tdClean);
        // Auditorium
        const tdAud = document.createElement('td');
        tdAud.className = 'px-3 py-1';
        tdAud.textContent = rec.audName || '';
        tr.appendChild(tdAud);
        // Film
        const tdFilm = document.createElement('td');
        tdFilm.className = 'px-3 py-1';
        tdFilm.textContent = rec.filmTitle || '';
        tr.appendChild(tdFilm);
        // Nudge
        const tdNudge = document.createElement('td');
        tdNudge.className = 'px-3 py-1';
        const btnUp = document.createElement('button');
        // Increase the corner radius for nudge buttons to match other button styles
        btnUp.className = 'inline-flex items-center border rounded-lg px-2 py-0.5 mr-1 bg-white hover:bg-gray-50 shadow-sm';
        btnUp.textContent = '▲';
        btnUp.addEventListener('click', (e) => {
          e.stopPropagation();
          nudgeShow(rec, -1);
        });
        const btnDown = document.createElement('button');
        btnDown.className = 'inline-flex items-center border rounded-lg px-2 py-0.5 bg-white hover:bg-gray-50 shadow-sm';
        btnDown.textContent = '▼';
        btnDown.addEventListener('click', (e) => {
          e.stopPropagation();
          nudgeShow(rec, 1);
        });
        tdNudge.appendChild(btnUp);
        tdNudge.appendChild(btnDown);
        tr.appendChild(tdNudge);
        tbody.appendChild(tr);
      });

      // After building the order panel rows, apply film highlighting.
      // This highlights rows whose filmId matches the selected film
      // from the global highlight selector.  The helper is defined in
      // app.js and will no-op if undefined.
      if (typeof window.applyFilmHighlight === 'function') {
        window.applyFilmHighlight();
      }
    }

    // Listen for cross‑component show highlight changes. When the schedule
    // grid sets a show as active (e.g. by focusing a showtime dropdown),
    // update the order panel’s active row and re-render so the purple
    // highlight appears in sync. Without this, the order panel would
    // continue to show whatever row was last clicked. Only re-render when
    // the id actually changes to avoid unnecessary work.
    window.addEventListener('activeShowChange', (e) => {
      const id = e && e.detail && e.detail.showId;
      if (!id) return;
      if (activeShowId === id) return;
      activeShowId = id;
      render();
    });
    // Toggle panel visibility
    toggleBtn.addEventListener('click', () => {
      // Determine current state and toggle
      const isHidden = panel.classList.contains('hidden');
      applyPanelState(isHidden);
    });
    // Re-render on storage events to reflect changes from other pages. The native
    // storage event only fires on tabs other than the one performing the save.
    window.addEventListener('storage', () => {
      if (!panel.classList.contains('hidden')) {
        render();
      }
    });
    // Also listen for the custom showtimeStateUpdated event which is
    // dispatched in app.js after each save. This allows the panel to
    // update immediately within the same tab when schedule grid edits
    // occur. Without this, manual changes on the schedule page would
    // require a navigation or manual refresh to propagate here.
    window.addEventListener('showtimeStateUpdated', () => {
      if (!panel.classList.contains('hidden')) {
        render();
      }
    });

    // Keyboard navigation for the start‑time order panel.  When the panel is visible,
    // allow the user to move the active selection up or down using the
    // ArrowUp and ArrowDown keys.  This enhances accessibility and
    // matches the behaviour of the original application.  Only handle
    // arrow keys when focus is not inside a form field or the schedule grid.
    document.addEventListener('keydown', (e) => {
      // Only process up/down arrows when the order panel is visible
      if (panel.classList.contains('hidden')) return;
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      const activeEl = document.activeElement;
      // Ignore key events originating from input, select, textarea or contenteditable elements
      const tag = activeEl && activeEl.tagName ? activeEl.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'select' || tag === 'textarea' || (activeEl && activeEl.isContentEditable)) return;
      // Ignore if focused inside the schedule grid (to avoid interfering with grid navigation)
      try {
        if (activeEl && activeEl.closest && (activeEl.closest('#gridBody') || activeEl.closest('#scheduleGrid'))) return;
      } catch {}
      // Prevent default browser scrolling behaviour
      e.preventDefault();
      // Build sorted list of shows as in render()
      const shows = ShowtimeState.getAllShows().slice().sort((a, b) => {
        const an = normalizeDate(a.start);
        const bn = normalizeDate(b.start);
        return an - bn;
      });
      if (shows.length === 0) return;
      // Find current active index; if none, start at beginning or end depending on direction
      let idx = shows.findIndex(r => r.id === activeShowId);
      if (idx === -1) {
        idx = (e.key === 'ArrowDown') ? 0 : shows.length - 1;
      } else {
        idx = idx + (e.key === 'ArrowDown' ? 1 : -1);
        if (idx < 0) idx = shows.length - 1;
        if (idx >= shows.length) idx = 0;
      }
      const newRec = shows[idx];
      if (newRec) {
        activeShowId = newRec.id;
        // Notify other components of the change
        try {
          const evt = new CustomEvent('activeShowChange', { detail: { showId: newRec.id } });
          window.dispatchEvent(evt);
        } catch {}
        // Re-render the panel to highlight the new selection
        render();
      }
    });
    // Build the wrapper and insert the panel into the page flow.  This must
    // run before we apply any visibility state so that the panel resides
    // inside the correct container.  Without this call the panel would
    // remain unattached and toggling would fail.
    createContentWrapper();

    // Automatically open or close the panel based on saved state when the page loads.
    // Read showOrderPanel from state; if true, open the panel. We defer the
    // call slightly to allow the wrapper to render, but no measurement of
    // widths is needed because flex handles sizing.
    const initialOpen = ShowtimeState.state && ShowtimeState.state.showOrderPanel;
    if (initialOpen !== false) {
      setTimeout(() => applyPanelState(true), 0);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initOrderPanel);
  } else {
    initOrderPanel();
  }
})();
