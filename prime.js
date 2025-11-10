// Prime schedule page logic
// Access global ShowtimeState via window
const ShowtimeState = window.ShowtimeState;

// Keep track of the currently open custom prime dropdown menu so that only one menu
// is open at a time. When the user clicks anywhere else on the page, this menu
// will be closed. This emulates the behaviour of a native <select>.
let openPrimeDropdownMenu = null;

document.addEventListener('DOMContentLoaded', () => {
  // Initialise multi‑date support. This will migrate existing schedule
  // data into the current date entry and load the schedule for
  // state.currentDate. It must be called before rendering or
  // manipulating schedules.
  ShowtimeState.initDateSupport();
  // Close any open prime dropdown menu when the user clicks outside of it. We
  // attach this listener once at load time so that each render doesn’t add
  // another listener. When the document is clicked, we hide the currently
  // open menu (if any) and reset the tracker.
  document.addEventListener('click', () => {
    if (openPrimeDropdownMenu) {
      openPrimeDropdownMenu.classList.add('hidden');
      openPrimeDropdownMenu = null;
    }
  });
  // References to first/last show selectors (if present)
  const firstSel = document.getElementById('firstShowPrimeSelect');
  const lastSel = document.getElementById('lastShowPrimeSelect');
  // Reference to the date picker
  const dateInput = document.getElementById('scheduleDatePrime');
  // Reference to the clear times button. We'll attach a single handler below.
  const clearBtn = document.getElementById('clearTimesBtn');

  // Attach clear handler once. The handler uses the shared helper in
  // ShowtimeState to reset all showtimes across the application. After
  // clearing, we re-render and dispatch a storage event so other tabs
  // (schedule grid, order panel) refresh their state. We guard the
  // dispatch in try/catch because some browsers (Safari) may throw.
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      ShowtimeState.clearAllTimes();
      render();
      try {
        const evt = new Event('storage');
        window.dispatchEvent(evt);
      } catch {}
    });
  }

  // Sync the date picker with the current schedule date. When the
  // user selects a new date, save the current schedule, load the new
  // schedule and re-render the page. Additionally update the picker
  // value when a date change originates elsewhere (e.g. another tab
  // triggering setDate). We listen for our custom showtimeDateChanged
  // event for this purpose.
  if (dateInput) {
    // Set initial value in MM/DD/YYYY format
    const curDate = ShowtimeState.getCurrentDate();
    if (curDate) dateInput.value = ShowtimeState.isoToMMDD(curDate);
    // When user changes date: parse MM/DD/YYYY to ISO and update state
    dateInput.addEventListener('change', () => {
      const inputVal = dateInput.value;
      if (!inputVal) return;
      const iso = ShowtimeState.mmddToIso(inputVal);
      if (!iso) {
        alert('Invalid date format. Please use MM/DD/YYYY.');
        return;
      }
      // Update display to canonical format (in case user omitted leading zeros)
      dateInput.value = ShowtimeState.isoToMMDD(iso);
      ShowtimeState.setDate(iso);
      // Render will be triggered by our listener below, but we call
      // directly to ensure immediate update
      render();
    });
    // Update picker value when date changes from other sources
    window.addEventListener('showtimeDateChanged', () => {
      const current = ShowtimeState.getCurrentDate();
      if (current) {
        dateInput.value = ShowtimeState.isoToMMDD(current);
      }
      // Re-render schedule when date changes
      render();
    });
  }

  // Hook up previous/next date buttons for the prime schedule.  These
  // buttons appear alongside the date input in the header.  Clicking
  // the arrows will move the current date backward or forward by one
  // day, update the input display and trigger a re-render of the
  // schedule.  If the current date is invalid or unset, today's date
  // is used as the baseline.  Note: we call render() directly after
  // updating the date; listeners on showtimeDateChanged will also
  // trigger render, but calling it here ensures immediate feedback.
  const prevPrimeBtn = document.getElementById('prevDatePrimeBtn');
  const nextPrimeBtn = document.getElementById('nextDatePrimeBtn');
  function shiftDatePrime(delta) {
    const curIso = ShowtimeState.getCurrentDate();
    let d = curIso ? new Date(curIso) : new Date();
    if (isNaN(d)) d = new Date();
    d.setDate(d.getDate() + delta);
    const iso = d.toISOString().slice(0, 10);
    ShowtimeState.setDate(iso);
    if (dateInput) dateInput.value = ShowtimeState.isoToMMDD(iso);
    render();
  }
  if (prevPrimeBtn) prevPrimeBtn.addEventListener('click', () => shiftDatePrime(-1));
  if (nextPrimeBtn) nextPrimeBtn.addEventListener('click', () => shiftDatePrime(1));

  // Populate first/last show dropdowns with 30‑minute increments. Mirrors schedule-grid.
  function populateTimeSelectors() {
    if (!firstSel || !lastSel) return;
    // Generate times from 05:00 to 19:00 in 30‑minute steps
    const times = [];
    let t = ShowtimeState.dtFromHM('05:00');
    const end = ShowtimeState.dtFromHM('19:00');
    while (t <= end) {
      times.push(ShowtimeState.hmFromDate(t));
      t = new Date(t.getTime() + 30 * 60000);
    }
    // Generate last show options manually covering 20:00 through 02:00 (next day) in 30‑minute steps
    const lastTimes = ['20:00','20:30','21:00','21:30','22:00','22:30','23:00','23:30','00:00','00:30','01:00','01:30','02:00'];
    // Clear existing
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
    // Set selected values from state
    if (ShowtimeState.state.firstShowHM) firstSel.value = ShowtimeState.state.firstShowHM;
    if (ShowtimeState.state.lastShowHM) lastSel.value = ShowtimeState.state.lastShowHM;
  }

  // Handle changes to first/last show selects
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
  const body = document.getElementById('primeBody');

  // We no longer attach a second clear handler here. The handler above
  // covers the clearing logic.

  // Generate prime time options: 5‑minute increments from 6:00p to 8:30p.
  function generatePrimeOptions() {
    const opts = [];
    // Start at 18:00 (6:00 PM) on an arbitrary date
    let t = ShowtimeState.dtFromHM('18:00');
    let end = ShowtimeState.dtFromHM('20:30');
    // If end is before start (e.g., crosses midnight), adjust by adding a day
    if (end < t) {
      end = new Date(end.getTime());
      end.setDate(end.getDate() + 1);
    }
    while (true) {
      opts.push(ShowtimeState.hmFromDate(t));
      if (t.getTime() >= end.getTime()) break;
      // Advance by 5 minutes
      t = new Date(t.getTime() + 5 * 60000);
    }
    return opts;
  }

  function render() {
    const state = ShowtimeState.state;

    // Ensure first/last show selectors are populated and synced to state
    populateTimeSelectors();

    // Ensure primeRows mirror current bookings with films assigned. This keeps
    // the prime table populated when visiting the page without first editing
    // bookings. Rows that already exist preserve their auditorium and prime time.
    (function ensurePrimeRows() {
      const currentMap = new Map((state.primeRows || []).map(r => [r.bookingId, r]));
      const newPrimeRows = [];
      state.bookings.forEach(b => {
        // Only include bookings whose film exists and has a non-empty title.
        if (!b.filmId) return;
        const film = ShowtimeState.filmById(b.filmId);
        if (!film || !film.title) return;
        const existing = currentMap.get(b.id);
        // Always use the booking's filmId for the prime row.  The prime
        // schedule mirrors the bookings list and does not allow editing
        // the film or slot.  Preserve auditorium and prime time from
        // existing rows if present.
        newPrimeRows.push({
          rowId: existing?.rowId || `PRB-${b.id}`,
          bookingId: b.id,
          slot: b.slot,
          filmId: b.filmId,
          audId: existing?.audId ?? null,
          primeHM: existing?.primeHM ?? ''
        });
      });
      state.primeRows = newPrimeRows;
      ShowtimeState.save();
    })();
    body.innerHTML = '';
    // Map to count prime time usage for highlighting duplicate prime times
    const primeCounts = {};
    state.primeRows.forEach(r => {
      if (r.primeHM) {
        primeCounts[r.primeHM] = (primeCounts[r.primeHM] || 0) + 1;
      }
    });
    // Map to count auditorium usage for highlighting duplicate auditorium assignments.  We
    // count assigned auditoriums across all primeRows and extraRows.  A
    // duplicate auditorium (selected more than once) will be highlighted in
    // the dropdown menu except for the current row, similar to how duplicate
    // prime times are highlighted.
    const audCounts = {};
    state.primeRows.concat(state.extraRows).forEach(r => {
      if (r.audId) {
        audCounts[r.audId] = (audCounts[r.audId] || 0) + 1;
      }
    });
    // Rows come from primeRows followed by extraRows
    // Combine prime and extra rows and sort by numeric slot ascending.  Sorting
    // ensures rows display in logical slot order even if previous edits
    // created gaps.  We parse as integers and fallback to lexical
    // comparison if parse fails.
    const rows = state.primeRows.concat(state.extraRows).sort((a,b) => {
      const sa = parseInt(a.slot, 10);
      const sb = parseInt(b.slot, 10);
      if (!isNaN(sa) && !isNaN(sb)) return sa - sb;
      return String(a.slot || '').localeCompare(String(b.slot || ''));
    });
    rows.forEach((row, idx) => {
      const tr = document.createElement('tr');
      // Apply zebra striping for improved readability.  Even rows use white, odd rows use a light gray.  Hover
      // effect darkens slightly.
      tr.className = (idx % 2 === 0 ? 'bg-white' : 'bg-gray-50') + ' hover:bg-gray-100';
      // Auditorium select
      const tdAud = document.createElement('td');
      tdAud.className = 'px-3 py-2';
      const selAud = document.createElement('select');
      // Narrow the auditorium selector on the prime schedule
      selAud.className = 'appearance-none border border-gray-300 rounded px-2 py-1 w-24';
      const blankAudOpt = document.createElement('option');
      blankAudOpt.value = '';
      blankAudOpt.textContent = '';
      selAud.appendChild(blankAudOpt);
      ShowtimeState.state.auds.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a.id;
        opt.textContent = a.name;
        // Highlight duplicate auditorium assignments.  If this auditorium is
        // selected in more than one row, colour the option red and bold
        // unless it is only selected on the current row.  We look up
        // audCounts from the outer scope.
        if (audCounts[a.id] && (row.audId !== a.id || audCounts[a.id] > 1)) {
          opt.style.color = '#dc2626'; // Tailwind red-600
          opt.style.fontWeight = 'bold';
        }
        selAud.appendChild(opt);
      });
      selAud.value = row.audId || '';
      selAud.addEventListener('change', () => {
        const val = selAud.value;
        ShowtimeState.setRowField(row.rowId, 'audId', val ? parseInt(val, 10) : null);
        render();
      });
      tdAud.appendChild(selAud);
      tr.appendChild(tdAud);
      // Slot cell (static)
      const tdSlot = document.createElement('td');
      tdSlot.className = 'px-3 py-2';
      tdSlot.textContent = row.slot || '';
      tr.appendChild(tdSlot);
      // Film cell: display the film title from the booking.  Editing films on
      // the prime schedule is disabled; any changes must be made on the
      // bookings tab.  We still show an empty cell if no film assigned.
      const tdFilm = document.createElement('td');
      tdFilm.className = 'px-3 py-2';
      // Set a minimum width on the film title column so that short titles do not cause
      // the pre/post columns to collapse into unused space.  A width of 16ch
      // accommodates most typical film titles without wrapping.
      tdFilm.style.minWidth = '16ch';
      const filmRec = ShowtimeState.filmById(row.filmId);
      // Display the film title together with its format (if present).  This ensures
      // that users can see whether a film is, for example, a 3D version without
      // having to refer back to the bookings tab.
      tdFilm.textContent = filmRec ? (filmRec.title + (filmRec.format ? ' ' + filmRec.format : '')) : '';
      tr.appendChild(tdFilm);
      // Turnkey cell: display the total cycle time (runtime + trailer + clean) as hours and minutes.
      const tdRt = document.createElement('td');
      tdRt.className = 'px-3 py-2';
      const film = ShowtimeState.filmById(row.filmId);
      // Compute the total cycle minutes using ShowtimeState.cycleMinutes and format to HhMM.
      const toHMM = (mins) => {
        const m = parseInt(mins, 10) || 0;
        const h = Math.floor(m / 60);
        const mm = Math.abs(m % 60);
        return `${h}h${String(mm).padStart(2, '0')}`;
      };
      if (film) {
        const cycleMins = ShowtimeState.cycleMinutes(film);
        tdRt.textContent = toHMM(cycleMins);
      } else {
        tdRt.textContent = '0h00';
      }
      tr.appendChild(tdRt);
      // Helper to get all shows for this row, applying overrides and manual shows.
      function getShowsForRow(r) {
        const out = [];
        // Base shows from buildRowShowtimes (prime cycles)
        const base = ShowtimeState.buildRowShowtimes(r);
        base.forEach(s => out.push({ ...s }));
        // Include manual shows for this row. Manual shows apply to both prime
        // rows and extra rows so that the prime schedule reflects any
        // manually added showtimes on the schedule grid.
        (state.manualShows || []).forEach(ms => {
          if (ms.rowId === r.rowId) out.push({ ...ms });
        });
        // Apply overrides and skip hidden shows
        const results = [];
        out.forEach(rec => {
          // skip hidden shows
          if (state.hiddenShows && state.hiddenShows[rec.id]) return;
          const ov = state.overrides ? state.overrides[rec.id] : undefined;
          let s = { ...rec };
          if (ov) {
            // Override start
            if (ov.start) {
              const newStart = new Date(ov.start);
              s.start = newStart;
              // recompute end using film runtime + trailer + clean
              const film = ShowtimeState.filmById(ov.filmId || s.filmId);
              if (film) {
                const totalMins = (film.runtime || 0) + (film.trailer || 0) + (film.clean || 0);
                s.end = new Date(newStart.getTime() + totalMins * 60000);
                s.runtime = film.runtime;
                s.trailer = film.trailer;
                s.clean = film.clean;
                s.filmId = film.id;
                // Always include the film format in the title for display on the
                // prime schedule, matching how other pages concatenate format.
                s.filmTitle = film.title + (film.format ? ' ' + film.format : '');
                s.cycle = ShowtimeState.cycleMinutes(film);
              }
            }
            // Override auditorium
            if (ov.audId) {
              s.audId = ov.audId;
              const a = state.auds.find(a => a.id === ov.audId);
              s.audName = a ? a.name : s.audName;
            }
            // Override film
            if (ov.filmId && ov.filmId !== s.filmId) {
              const film = ShowtimeState.filmById(ov.filmId);
              if (film) {
                s.filmId = film.id;
                s.filmTitle = film.title + (film.format ? ' ' + film.format : '');
                s.runtime = film.runtime;
                s.trailer = film.trailer;
                s.clean = film.clean;
                s.cycle = ShowtimeState.cycleMinutes(film);
                // adjust end if start override also exists
                const start = s.start || rec.start;
                const totalMins = (film.runtime || 0) + (film.trailer || 0) + (film.clean || 0);
                s.end = new Date(start.getTime() + totalMins * 60000);
              }
            }
          }
          results.push(s);
        });
        results.sort((a, b) => a.start - b.start);
        return results;
      }
      // Compute pre times directly from the prime time and cycle. Always
      // allocate eight cells so the prime column aligns correctly even
      // when no prime time is selected. Pre times are right‑aligned: the
      // most recent times occupy the rightmost cells; remaining cells are
      // left blank (null).
      const preTimes = new Array(8).fill(null);
      if (row.filmId && row.audId && row.primeHM) {
        const film = ShowtimeState.filmById(row.filmId);
        const cycle = ShowtimeState.cycleMinutes(film);
        if (cycle > 0) {
          const primeStart = ShowtimeState.dtFromHM(row.primeHM);
          const firstWindow = ShowtimeState.dtFromHM(ShowtimeState.state.firstShowHM);
          const lastWindow = ShowtimeState.dtFromHM(ShowtimeState.state.lastShowHM);
          // extend lastWindow into next day for times after midnight
          if (lastWindow.getHours() < 5) lastWindow.setDate(lastWindow.getDate() + 1);
          // Collect pre times by stepping backwards
          const times = [];
          let t = new Date(primeStart.getTime() - cycle * 60000);
          let steps = 0;
          while (t >= firstWindow && steps < 50) {
            times.push(new Date(t));
            t = new Date(t.getTime() - cycle * 60000);
            steps++;
          }
          // Sort ascending and deduplicate string labels
          const uniq = [];
          times.sort((a,b) => a - b).forEach(date => {
            const label = ShowtimeState.to12(date);
            if (!uniq.includes(label)) uniq.push(label);
          });
          const selected = uniq.slice(-8);
          // Place selected times into the rightmost cells; preceding cells remain null
          const startIdx = 8 - selected.length;
          selected.forEach((timeLabel, idx) => {
            preTimes[startIdx + idx] = timeLabel;
          });
        }
      }
      // Prime select cell. Use a native <select>. Duplicate times are highlighted
      // by colouring the option text red and bold. Native <option> elements can
      // accept inline styles to change text colour on modern browsers.
      const tdPrime = document.createElement('td');
      tdPrime.className = 'px-3 py-2';
      const selPrime = document.createElement('select');
      // Narrow the prime time selector
      selPrime.className = 'appearance-none border border-gray-300 rounded px-2 py-1 w-20';
      // Blank option to allow clearing the prime time
      const blankPrime = document.createElement('option');
      blankPrime.value = '';
      blankPrime.textContent = '';
      selPrime.appendChild(blankPrime);
      const primeOpts = generatePrimeOptions();
      primeOpts.forEach(hm => {
        const opt = document.createElement('option');
        opt.value = hm;
        opt.textContent = ShowtimeState.fmtHM(hm);
        // If this time is already selected by another row (duplicate), colour it red
        // and make it bold to warn the user. We exclude the current row's own
        // selection unless more than one row uses it.
        if (primeCounts[hm] && (row.primeHM !== hm || primeCounts[hm] > 1)) {
          opt.style.color = '#dc2626'; // Tailwind red-600
          opt.style.fontWeight = 'bold';
        }
        selPrime.appendChild(opt);
      });
      selPrime.value = row.primeHM || '';
      selPrime.addEventListener('change', () => {
        ShowtimeState.setRowField(row.rowId, 'primeHM', selPrime.value || '');
        render();
      });
      // Compute post times similarly to pre times, but moving forward from the prime time
      const postTimes = new Array(8).fill(null);
      if (row.filmId && row.audId && row.primeHM) {
        const film = ShowtimeState.filmById(row.filmId);
        const cycle = ShowtimeState.cycleMinutes(film);
        if (cycle > 0) {
          const primeStart = ShowtimeState.dtFromHM(row.primeHM);
          const firstWindow = ShowtimeState.dtFromHM(ShowtimeState.state.firstShowHM);
          const lastWindow = ShowtimeState.dtFromHM(ShowtimeState.state.lastShowHM);
          if (lastWindow.getHours() < 5) lastWindow.setDate(lastWindow.getDate() + 1);
          const times = [];
          let t = new Date(primeStart.getTime() + cycle * 60000);
          let steps = 0;
          while (t <= lastWindow && steps < 50) {
            times.push(new Date(t));
            t = new Date(t.getTime() + cycle * 60000);
            steps++;
          }
          const uniq = [];
          times.sort((a,b) => a - b).forEach(date => {
            const label = ShowtimeState.to12(date);
            if (!uniq.includes(label)) uniq.push(label);
          });
          const selectedPost = uniq.slice(0, 8);
          // Place selected times into the leftmost cells; trailing cells remain null
          selectedPost.forEach((timeLabel, idx) => {
            postTimes[idx] = timeLabel;
          });
        }
      }
      // Append pre cells before the prime cell
      preTimes.forEach(label => {
        const td = document.createElement('td');
        // Use monospaced, tabular numbers and right alignment for pre times.  White-space
        // nowrap prevents line wrapping. We omit a fixed width so that the column can
        // expand naturally according to its content.
        td.className = 'px-2 py-2 font-mono tabular-nums text-right whitespace-nowrap';
        if (label) td.textContent = label;
        tr.appendChild(td);
      });
      // Append the prime cell now that pre cells are in place.  The select element
      // inherits the width from its container cell (8ch) and will scroll if the
      // options overflow.  We deliberately avoid setting a fixed width on the
      // <select> itself so that the native control can shrink on small screens.
      tdPrime.appendChild(selPrime);
      // Append the prime cell.  Without an explicit width the cell will
      // expand based on its content.  We still use monospaced font and
      // nowrap for consistency.
      tdPrime.className = 'px-2 py-2 font-mono tabular-nums text-center whitespace-nowrap';
      tr.appendChild(tdPrime);
      // Append post cells after the prime cell
      postTimes.forEach(label => {
        const td = document.createElement('td');
        // Left align post times so they read naturally from left to right.  Without
        // an explicit width the column can expand naturally.  White‑space nowrap
        // prevents wrapping.
        td.className = 'px-2 py-2 font-mono tabular-nums text-left whitespace-nowrap';
        if (label) td.textContent = label;
        tr.appendChild(td);
      });
      // Tag this row with the filmId for highlighting.  This allows
      // applyFilmHighlight() to highlight all rows matching the selected film.
      if (row && row.filmId) {
        tr.dataset.filmid = String(row.filmId);
      }
      body.appendChild(tr);
    });

    // After constructing the table, update the film highlight options in case
    // films have changed and apply the highlight.  These functions are
    // provided by app.js and will safely no-op if not defined.
    if (typeof window.refreshFilmHighlightOptions === 'function') {
      window.refreshFilmHighlightOptions();
    }
    if (typeof window.applyFilmHighlight === 'function') {
      window.applyFilmHighlight();
    }
  }

  window.addEventListener('storage', () => render());
  render();
});