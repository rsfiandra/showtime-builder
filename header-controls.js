// Generic header controls script
// This script inserts functionality for the First/Last show selectors and the
// date picker on pages that do not have their own schedule or prime logic.
// It initialises multi‑date support, populates the dropdowns with sensible
// defaults, synchronises them with the global ShowtimeState and updates
// state when the user makes changes.  It also adds handlers to the
// previous/next day buttons to adjust the current date.
(function() {
  const ShowtimeState = window.ShowtimeState;
  function initHeaderControls() {
    if (!ShowtimeState) return;
    // Ensure per‑date scheduling is initialised
    try {
      ShowtimeState.initDateSupport();
    } catch (_) {}
    const firstSel = document.getElementById('firstShowGlobalSelect');
    const lastSel = document.getElementById('lastShowGlobalSelect');
    const dateInput = document.getElementById('scheduleDateGlobal');
    const prevBtn = document.getElementById('prevDateGlobalBtn');
    const nextBtn = document.getElementById('nextDateGlobalBtn');
    // Populate the First/Last show dropdowns with 30‑minute increments.
    function populateTimeSelectors() {
      if (!firstSel || !lastSel) return;
      // Generate first show options: 05:00 through 19:00 (7:00pm) in 30‑minute steps
      const times = [];
      let t = ShowtimeState.dtFromHM('05:00');
      const end = ShowtimeState.dtFromHM('19:00');
      while (t <= end) {
        times.push(ShowtimeState.hmFromDate(t));
        t = new Date(t.getTime() + 30 * 60000);
      }
      // Generate last show options covering 20:00 through 02:00 (next day) in 30‑minute steps
      const lastTimes = ['20:00','20:30','21:00','21:30','22:00','22:30','23:00','23:30','00:00','00:30','01:00','01:30','02:00'];
      // Clear existing options
      firstSel.innerHTML = '';
      lastSel.innerHTML = '';
      times.forEach(hm => {
        const opt = document.createElement('option');
        opt.value = hm;
        opt.textContent = ShowtimeState.fmtHM(hm);
        firstSel.appendChild(opt);
      });
      lastTimes.forEach(hm => {
        const opt = document.createElement('option');
        opt.value = hm;
        opt.textContent = ShowtimeState.fmtHM(hm);
        lastSel.appendChild(opt);
      });
      // Set selected values from state if present
      try {
        if (ShowtimeState.state.firstShowHM) firstSel.value = ShowtimeState.state.firstShowHM;
        if (ShowtimeState.state.lastShowHM) lastSel.value = ShowtimeState.state.lastShowHM;
      } catch (_) {}
    }
    populateTimeSelectors();
    // Update state when the user changes the first/last show times
    if (firstSel) {
      firstSel.addEventListener('change', () => {
        try {
          ShowtimeState.state.firstShowHM = firstSel.value;
          ShowtimeState.save();
        } catch (_) {}
      });
    }
    if (lastSel) {
      lastSel.addEventListener('change', () => {
        try {
          ShowtimeState.state.lastShowHM = lastSel.value;
          ShowtimeState.save();
        } catch (_) {}
      });
    }
    // Date picker synchronisation
    if (dateInput) {
      // Set the current date in MM/DD/YYYY on load
      try {
        const current = ShowtimeState.getCurrentDate();
        if (current) dateInput.value = ShowtimeState.isoToMMDD(current);
      } catch (_) {}
      // When the user changes the date, convert to ISO and update state
      dateInput.addEventListener('change', () => {
        const inputVal = dateInput.value;
        if (!inputVal) return;
        let iso = null;
        try {
          iso = ShowtimeState.mmddToIso(inputVal);
        } catch (_) {}
        if (!iso) {
          alert('Invalid date format. Please use MM/DD/YYYY.');
          return;
        }
        try {
          dateInput.value = ShowtimeState.isoToMMDD(iso);
          ShowtimeState.setDate(iso);
        } catch (_) {}
      });
      // Update the input when the date changes from other components
      window.addEventListener('showtimeDateChanged', () => {
        try {
          const cur = ShowtimeState.getCurrentDate();
          if (cur) dateInput.value = ShowtimeState.isoToMMDD(cur);
        } catch (_) {}
        // When the date changes, refresh the first/last show selectors so
        // they reflect the times associated with the new date.  The
        // populateTimeSelectors function updates the option lists and
        // selects the stored values from state.  Without this, the
        // selectors would retain the previous date's values even
        // though the underlying state has changed.
        try {
          populateTimeSelectors();
        } catch (_) {}
      });
    }
    // Helper to shift the current date by +/- 1 day
    function shiftDate(delta) {
      try {
        const curIso = ShowtimeState.getCurrentDate();
        let d = curIso ? new Date(curIso) : new Date();
        if (isNaN(d)) d = new Date();
        d.setDate(d.getDate() + delta);
        const iso = d.toISOString().slice(0, 10);
        ShowtimeState.setDate(iso);
        if (dateInput) dateInput.value = ShowtimeState.isoToMMDD(iso);
      } catch (_) {}
    }
    if (prevBtn) prevBtn.addEventListener('click', () => shiftDate(-1));
    if (nextBtn) nextBtn.addEventListener('click', () => shiftDate(1));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHeaderControls);
  } else {
    initHeaderControls();
  }
})();
