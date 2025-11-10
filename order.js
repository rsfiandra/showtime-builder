// Start‑time order view with nudge controls
// Access the global ShowtimeState via window
const ShowtimeState = window.ShowtimeState;

function initOrderView() {
  const tbody = document.getElementById('orderBody');

  function normalizeDate(dt) {
    const n = new Date(dt);
    // If time is between 00:00 and 04:59 on the same calendar date as first show,
    // treat it as the next day to order after evening shows.
    // For simplicity here, we roll any time before 5:00a to the next day.
    if (n.getHours() < 5) {
      n.setDate(n.getDate() + 1);
    }
    return n;
  }

  // Compute the time gap (in minutes) between this show and the next show in the same auditorium
  function cleanGap(current, shows) {
    // Find next show with same auditorium ID and start after current.start
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
    // Compute minutes between next.start and current.end
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
    // rec: show record; dir: -1 for up (earlier), 1 for down (later)
    // Compute new start time by adding dir*5 minutes
    const newDate = new Date(rec.start.getTime() + dir * 5 * 60000);
    const newHm = ShowtimeState.hmFromDate(newDate);
    ShowtimeState.updateShowStart(rec.id, newHm);
    render();
  }

  function render() {
    // Ensure primeRows exist if the user hasn’t visited the Prime page yet.  If
    // there are bookings with films but no prime rows, derive them so that
    // getAllShows() returns something.
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
    // Sort shows by start time (with normalization for early AM)
    const shows = allShows.slice().sort((a, b) => {
      const an = normalizeDate(a.start);
      const bn = normalizeDate(b.start);
      return an - bn;
    });
    tbody.innerHTML = '';
    shows.forEach((rec, idx) => {
      const tr = document.createElement('tr');
      // Use zebra striping and hover highlights similar to the older design
      tr.className = 'border-b border-slate-100 last:border-0 transition-colors odd:bg-white even:bg-slate-50 hover:bg-sky-50';
      // Tag the row with filmId for highlighting.  When a film is selected
      // from the highlight dropdown, rows with matching filmId will
      // receive a pink highlight.  rec.filmId may be undefined for
      // manual shows; in that case the dataset is not set.
      if (rec.filmId) {
        tr.dataset.filmid = String(rec.filmId);
      }
      // Add a thin medium‑grey bottom border when the next show starts in a
      // different hour. Using a subtle grey colour (#9ca3af) instead of
      // solid black makes the hour groupings easier on the eye while
      // still delineating separate hours.  See issue # for details.
      if (idx < shows.length - 1) {
        const currHour = normalizeDate(rec.start).getHours();
        const nextHour = normalizeDate(shows[idx + 1].start).getHours();
        if (currHour !== nextHour) {
          tr.style.borderBottom = '1px solid #9ca3af';
        }
      }
      // Start time cell
      const tdStart = document.createElement('td');
      tdStart.className = 'px-2 py-1 font-mono tabular-nums';
      tdStart.textContent = ShowtimeState.to12(rec.start);
      tr.appendChild(tdStart);
      // Clean cell
      const gap = cleanGap(rec, shows);
      const tdClean = document.createElement('td');
      tdClean.className = 'px-2 py-1 font-mono tabular-nums';
      const label = formatCleanLabel(gap);
      if (label && gap < 20) {
        // Highlight short cleaning windows (<20m) with a yellow background to
        // draw attention. Use a light yellow to avoid overpowering other
        // colours.
        const span = document.createElement('span');
        span.className = 'bg-yellow-100 rounded px-1';
        span.textContent = label;
        tdClean.appendChild(span);
      } else {
        tdClean.textContent = label;
      }
      tr.appendChild(tdClean);
      // Auditorium cell
      const tdAud = document.createElement('td');
      tdAud.className = 'px-2 py-1';
      tdAud.textContent = rec.audName || '';
      tr.appendChild(tdAud);
      // Film cell
      const tdFilm = document.createElement('td');
      tdFilm.className = 'px-2 py-1';
      tdFilm.textContent = rec.filmTitle || '';
      tr.appendChild(tdFilm);
      // Nudge cell
      const tdNudge = document.createElement('td');
      tdNudge.className = 'px-2 py-1';
      // Up button
      const btnUp = document.createElement('button');
      // Use a smaller rounded radius to more closely match the older design
      btnUp.className = 'inline-flex items-center border rounded-md px-2 py-0.5 mr-1 bg-white hover:bg-gray-50 shadow-sm';
      btnUp.textContent = '▲';
      btnUp.addEventListener('click', (e) => {
        e.stopPropagation();
        nudgeShow(rec, -1);
      });
      // Down button
      const btnDown = document.createElement('button');
      btnDown.className = 'inline-flex items-center border rounded-md px-2 py-0.5 bg-white hover:bg-gray-50 shadow-sm';
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

    // After populating the order table, apply film highlighting.  This
    // highlights rows whose filmId matches the selected film in the
    // header dropdown.  The helper is defined in app.js and
    // gracefully no-ops if not present.
    if (typeof window.applyFilmHighlight === 'function') {
      window.applyFilmHighlight();
    }
  }

  window.addEventListener('storage', () => render());
  window.addEventListener('showtimeViewActivated', (evt) => {
    const detail = evt && evt.detail;
    const view = detail && detail.view ? detail.view : evt && evt.view;
    if (view === 'order') {
      render();
    }
  });
  render();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initOrderView);
} else {
  initOrderView();
}
