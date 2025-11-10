// Audit tab script
// This script renders a static audit table grouping shows by film title. It
// lists every show in chronological order per film and computes the time
// gap between consecutive shows. The gap is shown in hours and minutes.
// If the gap between two shows is less than 30 minutes, the cell is
// highlighted for easy visualisation.

function initAuditPage() {
  const ShowtimeState = window.ShowtimeState;
  if (!ShowtimeState) return;
  // Initialise multi‑date support on the audit tab
  ShowtimeState.initDateSupport();
  const bodyFilm = document.getElementById('auditByFilmBody');
  const bodyHouse = document.getElementById('housePlacementBody');
  const bodyAud = document.getElementById('showsPerAudBody');
  const bodyFeature = document.getElementById('showsPerFeatureBody');
  if (!bodyFilm || !bodyHouse || !bodyAud || !bodyFeature) return;
  // Load the latest state from storage; ignore errors
  try {
    ShowtimeState.load();
  } catch (e) {
    /* ignore */
  }
  // Date input for switching days
  const dateInput = document.getElementById('scheduleDateAudit');
  // First/last show selectors and previous/next date buttons
  const firstSel = document.getElementById('firstShowAuditSelect');
  const lastSel = document.getElementById('lastShowAuditSelect');
  const prevBtn = document.getElementById('prevDateAuditBtn');
  const nextBtn = document.getElementById('nextDateAuditBtn');

  // Populate the first/last show selectors.  This generates 30‑minute
  // increments from 05:00 to 19:00 for the first show and from
  // 20:00 through 02:00 for the last show.  Selected values are
  // persisted in ShowtimeState.state and applied to the dropdowns.
  function populateTimeSelectors() {
    if (!firstSel || !lastSel) return;
    const times = [];
    let t = ShowtimeState.dtFromHM('05:00');
    const end = ShowtimeState.dtFromHM('19:00');
    while (t <= end) {
      times.push(ShowtimeState.hmFromDate(t));
      t = new Date(t.getTime() + 30 * 60000);
    }
    const lastTimes = ['20:00','20:30','21:00','21:30','22:00','22:30','23:00','23:30','00:00','00:30','01:00','01:30','02:00'];
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
    if (ShowtimeState.state.firstShowHM) firstSel.value = ShowtimeState.state.firstShowHM;
    if (ShowtimeState.state.lastShowHM) lastSel.value = ShowtimeState.state.lastShowHM;
  }

  // Change handlers for first/last selectors: persist new values and re-render
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

  // Shift date by delta days when clicking prev/next buttons
  function shiftDate(delta) {
    const curIso = ShowtimeState.getCurrentDate();
    let d = curIso ? new Date(curIso) : new Date();
    if (isNaN(d)) d = new Date();
    d.setDate(d.getDate() + delta);
    const iso = d.toISOString().slice(0,10);
    ShowtimeState.setDate(iso);
    if (dateInput) dateInput.value = ShowtimeState.isoToMMDD(iso);
    render();
  }
  if (prevBtn) prevBtn.addEventListener('click', () => shiftDate(-1));
  if (nextBtn) nextBtn.addEventListener('click', () => shiftDate(1));

  // Helper to get base film title (ignoring format)
  function getBaseTitle(rec) {
    let baseTitle = rec.filmTitle || '';
    try {
      if (ShowtimeState.filmById && rec.filmId) {
        const filmRec = ShowtimeState.filmById(rec.filmId);
        if (filmRec && filmRec.title) baseTitle = filmRec.title;
      }
    } catch (_) {
      // fallback
    }
    return baseTitle;
  }

  function render() {
    // Clear existing bodies
    bodyFilm.innerHTML = '';
    bodyHouse.innerHTML = '';
    bodyAud.innerHTML = '';
    bodyFeature.innerHTML = '';
    const shows = ShowtimeState.getAllShows();
    if (!shows || !Array.isArray(shows)) return;
    // === Schedule by Film ===
    // Group shows by base film title
    const groups = {};
    for (const rec of shows) {
      const title = getBaseTitle(rec);
      if (!groups[title]) groups[title] = [];
      groups[title].push(rec);
    }
    const filmTitles = Object.keys(groups).sort((a, b) => a.localeCompare(b));
    // Iterate through each film title and build the rows for the "Schedule by Film" table.
    // We track the index of the current film group so we can apply a slightly
    // darker top border when the film changes.  This improves visual
    // separation between groups without altering the overall look and feel.
    for (let groupIndex = 0; groupIndex < filmTitles.length; groupIndex++) {
      const ft = filmTitles[groupIndex];
      const list = groups[ft];
      // Sort by start time
      list.sort((a, b) => a.start - b.start);

      // Insert a thin separator row before each film group except the first.  Using
      // a dedicated table row with a 1‑pixel height and a slightly darker
      // background colour provides a clear visual boundary between groups
      // without relying on table borders (which are collapsed by the
      // Tailwind divide utilities).  The separator uses a colspan to span
      // all columns of the table.  See test pages for more details.
      if (groupIndex > 0) {
        const sepTr = document.createElement('tr');
        const sepTd = document.createElement('td');
        sepTd.colSpan = 4;
        // Remove padding so the height reflects only the border thickness
        sepTd.className = 'p-0 bg-gray-300';
        // Explicit height; using 1px ensures the line appears slightly darker
        // than the default divide lines but does not consume significant space.
        sepTd.style.height = '1px';
        sepTr.appendChild(sepTd);
        bodyFilm.appendChild(sepTr);
      }
      for (let i = 0; i < list.length; i++) {
        const rec = list[i];
        const next = list[i + 1];
        let gapStr = '';
        let shortGap = false;
        if (next) {
          const diffMin = (next.start - rec.start) / 60000;
          const hours = Math.floor(diffMin / 60);
          const mins = Math.round(diffMin % 60);
          gapStr = `${hours}:${mins.toString().padStart(2, '0')}`;
          if (diffMin < 30) shortGap = true;
        }
        const tr = document.createElement('tr');
        // Alternate row background colours for odd/even rows
        tr.className = i % 2 === 0 ? 'bg-white' : 'bg-gray-50';
        // Tag each row with its filmId for highlighting.  If rec.filmId is
        // defined, assign it as a data attribute so applyFilmHighlight()
        // can identify and highlight rows corresponding to the selected film.
        if (rec && rec.filmId) {
          tr.dataset.filmid = String(rec.filmId);
        }
        // Create and populate table cells
        const tdFilm = document.createElement('td');
        tdFilm.className = 'px-2 py-1';
        tdFilm.textContent = ft;
        const tdStart = document.createElement('td');
        tdStart.className = 'px-2 py-1';
        tdStart.textContent = ShowtimeState.to12(rec.start);
        const tdAud = document.createElement('td');
        tdAud.className = 'px-2 py-1';
        tdAud.textContent = rec.audName || '';
        const tdGap = document.createElement('td');
        tdGap.className = 'px-2 py-1';
        tdGap.textContent = gapStr;
        if (shortGap && gapStr) tdGap.classList.add('bg-yellow-200');

        // No additional border styling is applied here.  The group separator
        // row inserted above provides the visual boundary between films.
        tr.appendChild(tdFilm);
        tr.appendChild(tdStart);
        tr.appendChild(tdAud);
        tr.appendChild(tdGap);
        bodyFilm.appendChild(tr);
      }
    }

    // === House Placement Audit ===
    // For each film title, list unique auditorium-seat pairs
    for (const ft of filmTitles) {
      const list = groups[ft];
      const pairs = new Map(); // key: audName -> seat count
      for (const rec of list) {
        const audId = rec.audId;
        let audName = rec.audName || '';
        let seats = '';
        try {
          const audRec = ShowtimeState.audById ? ShowtimeState.audById(audId) : null;
          if (audRec) {
            audName = audRec.name || audName;
            seats = audRec.seats != null ? String(audRec.seats) : seats;
          }
        } catch (_) {
          // ignore
        }
        // If rec itself has seats property, we could use it; but show rec may not have seats.
        if (!pairs.has(audName)) {
          pairs.set(audName, seats);
        }
      }
      const row = document.createElement('tr');
      row.className = 'bg-white';
      // Tag the row with the filmId of the first record in the list for
      // highlight matching.  Each row summarises a single film.
      const firstRec = list && list[0];
      if (firstRec && firstRec.filmId) {
        row.dataset.filmid = String(firstRec.filmId);
      }
      // Assign filmId to the entire row for highlighting.  Use the filmId
      // from the first record in the group if available.  This tags the
      // row so selecting the film will highlight the House Placement row.
      const sampleRecHP = list && list[0];
      if (sampleRecHP && sampleRecHP.filmId) {
        row.dataset.filmid = String(sampleRecHP.filmId);
      }
      const tdFilm = document.createElement('td');
      tdFilm.className = 'px-2 py-1 align-top';
      tdFilm.textContent = ft;
      const tdHouses = document.createElement('td');
      tdHouses.className = 'px-2 py-1';
      // Build string of "Aud X (seats)" pairs separated by comma
      const parts = [];
      for (const [audName, seats] of pairs.entries()) {
        let part = audName;
        if (seats) part += ` (${seats})`;
        parts.push(part);
      }
      tdHouses.textContent = parts.join(', ');
      row.appendChild(tdFilm);
      row.appendChild(tdHouses);
      bodyHouse.appendChild(row);
    }

    // === Shows per Auditorium ===
    // Group shows by auditorium
    const audGroups = {};
    for (const rec of shows) {
      const audId = rec.audId;
      if (!audGroups[audId]) audGroups[audId] = [];
      audGroups[audId].push(rec);
    }
    const audIds = Object.keys(audGroups);
    audIds.sort((a, b) => {
      // sort by auditorium name if available, else by numeric id
      const aName = (() => {
        try {
          const idNum = (typeof a === 'string' || typeof a === 'number') ? parseInt(a, 10) : a;
          const r = ShowtimeState.audById ? ShowtimeState.audById(idNum) : null;
          return r && r.name ? r.name : String(a);
        } catch (_) {
          return String(a);
        }
      })();
      const bName = (() => {
        try {
          const idNum = (typeof b === 'string' || typeof b === 'number') ? parseInt(b, 10) : b;
          const r = ShowtimeState.audById ? ShowtimeState.audById(idNum) : null;
          return r && r.name ? r.name : String(b);
        } catch (_) {
          return String(b);
        }
      })();
      return aName.localeCompare(bName);
    });
    for (const audId of audIds) {
      const list = audGroups[audId];
      if (!list || list.length === 0) continue;
      // Determine auditorium name and seats.  Convert audId to a number
      // before looking it up because audIds are stored as strings in
      // the grouping keys.  Without converting, ShowtimeState.audById
      // (which compares using strict equality) will fail to find a
      // match and return undefined, resulting in blank auditorium
      // names and seats.  See user bug report about empty cells.
      let audName = '';
      let seats = '';
      try {
        const idNum = (typeof audId === 'string' || typeof audId === 'number') ? parseInt(audId, 10) : audId;
        const audRec = ShowtimeState.audById ? ShowtimeState.audById(idNum) : null;
        if (audRec) {
          audName = audRec.name || '';
          seats = audRec.seats != null ? String(audRec.seats) : '';
        }
      } catch (_) {}
      // Sort shows by start time to get earliest and latest
      list.sort((a, b) => a.start - b.start);
      const firstShow = ShowtimeState.to12(list[0].start);
      const lastShow = ShowtimeState.to12(list[list.length - 1].start);
      const row = document.createElement('tr');
      row.className = 'bg-white';
      // Do not tag rows in the Shows per Auditorium table with a filmId.
      // Each row in this table represents an auditorium, not a single film.
      // Tagging by filmId could inadvertently apply film highlight styling,
      // causing the text to blend with the highlight colour.  By leaving
      // dataset.filmid undefined for this table, the highlight dropdown
      // will not alter these rows and their contents will remain visible.
      const tdAud = document.createElement('td');
      tdAud.className = 'px-2 py-1';
      tdAud.textContent = audName;
      const tdSeats = document.createElement('td');
      tdSeats.className = 'px-2 py-1';
      tdSeats.textContent = seats;
      const tdCount = document.createElement('td');
      tdCount.className = 'px-2 py-1';
      tdCount.textContent = String(list.length);
      const tdFirst = document.createElement('td');
      tdFirst.className = 'px-2 py-1';
      tdFirst.textContent = firstShow;
      const tdLast = document.createElement('td');
      tdLast.className = 'px-2 py-1';
      tdLast.textContent = lastShow;
      row.appendChild(tdAud);
      row.appendChild(tdSeats);
      row.appendChild(tdCount);
      row.appendChild(tdFirst);
      row.appendChild(tdLast);
      bodyAud.appendChild(row);
    }

    // === Shows per Feature ===
    // For each base film, count unique auditoriums (prints), show count, first show, last show
    for (const ft of filmTitles) {
      const list = groups[ft];
      if (!list || list.length === 0) continue;
      // Unique auditoriums
      const audSet = new Set();
      for (const rec of list) audSet.add(rec.audId);
      const prints = audSet.size;
      // Sort by start time
      list.sort((a, b) => a.start - b.start);
      const firstShow = ShowtimeState.to12(list[0].start);
      const lastShow = ShowtimeState.to12(list[list.length - 1].start);
      const row = document.createElement('tr');
      row.className = 'bg-white';
      // Tag row with filmId for highlighting using first record from the list.
      const sampleRec = list && list[0];
      if (sampleRec && sampleRec.filmId) {
        row.dataset.filmid = String(sampleRec.filmId);
      }
      const tdFilm = document.createElement('td');
      tdFilm.className = 'px-2 py-1';
      tdFilm.textContent = ft;
      const tdPrints = document.createElement('td');
      tdPrints.className = 'px-2 py-1';
      tdPrints.textContent = String(prints);
      const tdCount = document.createElement('td');
      tdCount.className = 'px-2 py-1';
      tdCount.textContent = String(list.length);
      const tdFirst = document.createElement('td');
      tdFirst.className = 'px-2 py-1';
      tdFirst.textContent = firstShow;
      const tdLast = document.createElement('td');
      tdLast.className = 'px-2 py-1';
      tdLast.textContent = lastShow;
      row.appendChild(tdFilm);
      row.appendChild(tdPrints);
      row.appendChild(tdCount);
      row.appendChild(tdFirst);
      row.appendChild(tdLast);
      bodyFeature.appendChild(row);
    }

    // After populating all audit tables, apply film highlights if available.
    // This ensures that rows corresponding to the selected film are
    // highlighted on the audit tab.  The function is defined in
    // app.js and gracefully no-ops if undefined.
    try {
      if (typeof window.applyFilmHighlight === 'function') {
        window.applyFilmHighlight();
      }
    } catch (_) {}
  }
  // Initial render and re-render on state changes
  // Populate selectors on first load
  populateTimeSelectors();

  render();
  // Apply film highlight after the initial render.  This ensures the audit
  // tables respond immediately to any existing highlight selection.
  try {
    if (typeof window.applyFilmHighlight === 'function') {
      window.applyFilmHighlight();
    }
  } catch (_) {}
  window.addEventListener('storage', () => {
    render();
    // Apply highlight after updating from storage changes
    try {
      if (typeof window.applyFilmHighlight === 'function') {
        window.applyFilmHighlight();
      }
    } catch (_) {}
  });
  // Setup date input behaviour. Use MM/DD/YYYY format for display and parse on change.
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
      // After changing the date, reapply film highlight
      try {
        if (typeof window.applyFilmHighlight === 'function') {
          window.applyFilmHighlight();
        }
      } catch (_) {}
    });
    // When date changes from other components, update input, refresh selectors and re-render
    window.addEventListener('showtimeDateChanged', () => {
      const current = ShowtimeState.getCurrentDate();
      if (current) dateInput.value = ShowtimeState.isoToMMDD(current);
      populateTimeSelectors();
      render();
      // Reapply highlight after rendering with the new date
      try {
        if (typeof window.applyFilmHighlight === 'function') {
          window.applyFilmHighlight();
        }
      } catch (_) {}
    });
  }
  window.addEventListener('showtimeViewActivated', (evt) => {
    const detail = evt && evt.detail;
    const view = detail && detail.view ? detail.view : evt && evt.view;
    if (view === 'audit') {
      render();
      try {
        if (typeof window.applyFilmHighlight === 'function') {
          window.applyFilmHighlight();
        }
      } catch (_) {}
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAuditPage);
} else {
  initAuditPage();
}
