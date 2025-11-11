// Schedule list page logic
// Access global ShowtimeState via window
const ShowtimeState = window.ShowtimeState;

function initScheduleList() {
  // Initialise multi‑date support on load
  ShowtimeState.initDateSupport();
  const tbody = document.getElementById('scheduleBody');
  const dateInput = document.getElementById('scheduleDateList');
  // First and last show selectors (added to the schedule list header)
  const firstSel = document.getElementById('firstShowListSelect');
  const lastSel = document.getElementById('lastShowListSelect');
  // Previous/next date buttons (flank the date input)
  const prevListBtn = document.getElementById('prevDateListBtn');
  const nextListBtn = document.getElementById('nextDateListBtn');

  // Populate time selectors immediately so that the dropdowns show
  // available times on first load.  Without this call the selects
  // remain empty until the user interacts with them.
  populateTimeSelectors();

  function render() {
    const shows = ShowtimeState.getAllShows().slice();
    // Sort ascending by start time
    shows.sort((a, b) => a.start - b.start);
    tbody.innerHTML = '';
    shows.forEach(rec => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-gray-50';
      const tds = [];
      // Start
      tds.push(ShowtimeState.to12(rec.start));
      // End
      tds.push(ShowtimeState.to12(rec.end));
      // Auditorium
      tds.push(rec.audName || '');
      // Film
      tds.push(rec.filmTitle || '');
      // Slot
      // Determine slot: if prime or extra row, slot is row.slot; manual row inherits rowId but not slot, so blank
      let slot = '';
      const row = ShowtimeState.state.primeRows.concat(ShowtimeState.state.extraRows).find(r => r.rowId === rec.rowId);
      slot = row ? row.slot : '';
      tds.push(slot);
      // Source
      tds.push(rec.source || '');
      tds.forEach(text => {
        const td = document.createElement('td');
        td.className = 'px-3 py-2';
        td.textContent = text;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }

  // Populate first/last show selectors with 30‑minute increments.  This mirrors
  // the logic used on the Prime and Schedule Grid pages.  If the
  // persisted state contains values outside the generated range, they
  // will still be selected.  Calling this function will re-populate
  // options and set the selected values based on state.
  function populateTimeSelectors() {
    if (!firstSel || !lastSel) return;
    // Generate 30‑minute increments from 05:00 through 19:00
    const times = [];
    let t = ShowtimeState.dtFromHM('05:00');
    const end = ShowtimeState.dtFromHM('19:00');
    while (t <= end) {
      times.push(ShowtimeState.hmFromDate(t));
      t = new Date(t.getTime() + 30 * 60000);
    }
    // Generate last show times from 20:00 through 02:00 (next day)
    const lastTimes = ['20:00','20:30','21:00','21:30','22:00','22:30','23:00','23:30','00:00','00:30','01:00','01:30','02:00'];
    // Clear current options
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
    // Apply current state values if present
    if (ShowtimeState.state.firstShowHM) {
      firstSel.value = ShowtimeState.state.firstShowHM;
    }
    if (ShowtimeState.state.lastShowHM) {
      lastSel.value = ShowtimeState.state.lastShowHM;
    }
  }

  // Handle changes to first/last show times.  Update global state and
  // re-render the schedule list.
  if (firstSel && lastSel) {
    firstSel.addEventListener('change', () => {
      ShowtimeState.state.firstShowHM = firstSel.value;
      ShowtimeState.save();
      render();
    });
    lastSel.addEventListener('change', () => {
      ShowtimeState.state.lastShowHM = lastSel.value;
      ShowtimeState.save();
      render();
    });
  }

  // Adjust the current date by one day when clicking the prev/next buttons.  If
  // the current date is not set or cannot be parsed, fall back to
  // today’s date.  The date input is updated and the schedule list is
  // re-rendered immediately.
  function shiftDateList(delta) {
    const curIso = ShowtimeState.getCurrentDate();
    let d = curIso ? new Date(curIso) : new Date();
    if (isNaN(d)) d = new Date();
    d.setDate(d.getDate() + delta);
    const iso = d.toISOString().slice(0, 10);
    ShowtimeState.setDate(iso);
    if (dateInput) dateInput.value = ShowtimeState.isoToMMDD(iso);
    // Render after date change
    render();
  }
  if (prevListBtn) prevListBtn.addEventListener('click', () => shiftDateList(-1));
  if (nextListBtn) nextListBtn.addEventListener('click', () => shiftDateList(1));

  window.addEventListener('storage', () => render());
  // If date input exists, wire up date switching
  if (dateInput) {
    const cur = ShowtimeState.getCurrentDate();
    if (cur) dateInput.value = ShowtimeState.isoToMMDD(cur);
    dateInput.addEventListener('change', () => {
      const val = dateInput.value;
      if (!val) return;
      const iso = ShowtimeState.mmddToIso(val);
      if (!iso) {
        alert('Invalid date format. Please use MM/DD/YYYY.');
        return;
      }
      dateInput.value = ShowtimeState.isoToMMDD(iso);
      ShowtimeState.setDate(iso);
      render();
    });
    window.addEventListener('showtimeDateChanged', () => {
      const current = ShowtimeState.getCurrentDate();
      if (current) {
        dateInput.value = ShowtimeState.isoToMMDD(current);
      }
      // Refresh time selectors in case another page changed the values
      populateTimeSelectors();
      render();
    });
  }
  render();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initScheduleList);
} else {
  initScheduleList();
}
