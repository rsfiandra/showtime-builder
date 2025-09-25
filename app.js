// Global state and utilities for the showtime builder application.
// This script is included on every page. It exposes a ShowtimeState
// object on the window with current state and helper methods. State is
// persisted to localStorage under a single key. Pages should call
// ShowtimeState.load() on load and then use ShowtimeState.state to
// read the current values. Mutating functions automatically save and
// optionally trigger callbacks.

(function(){
  const LOCAL_KEY = "showtime:persist";

  // Default seeds for auditoriums, films and bookings. These mirror
  // the original React seeds but can be extended by the user.
  const defaultState = {
    auds: [
      {id: 1, name: "Aud 1", format: "Standard", seats: 200},
      {id: 2, name: "Aud 2", format: "Standard", seats: 190},
      {id: 3, name: "Aud 3", format: "3D", seats: 150},
      {id: 4, name: "Aud 4", format: "Laser", seats: 210},
      {id: 5, name: "Aud 5", format: "Standard", seats: 140},
      {id: 6, name: "Aud 6", format: "Standard", seats: 140},
    ],
    films: [
      {id: "F1", title: "Thunder Road", rating: "PG-13", runtime: 124, trailer: 18, clean: 20, priority: 1},
      {id: "F2", title: "Moon Harbor", rating: "R", runtime: 108, trailer: 16, clean: 20, priority: 2},
      {id: "F3", title: "Galaxy Kids 3D", rating: "PG", runtime: 97, trailer: 15, clean: 15, priority: 3},
    ],
    // Bookings tie films to slots and weeks. Week values are numeric and may
    // be ignored by this app; they are placeholders for extension. A slot
    // simply labels a booking and is shown on the prime page.
    bookings: [
      {id: "B1", week: 34, slot: "1", filmId: "F1", notes: "", weeksOut: 1},
      {id: "B2", week: 34, slot: "2", filmId: "F2", notes: "", weeksOut: 1},
      {id: "B3", week: 34, slot: "3", filmId: "F3", notes: "", weeksOut: 1},
    ],
    // Prime rows mirror bookings with selected prime times. Each entry
    // references a booking by id and stores an auditorium assignment and
    // prime time. The prime time is stored as an HM string (HH:MM). New
    // bookings without a prime time remain blank until selected on the
    // prime page or schedule grid.
    primeRows: [],
    // Extra rows are user‑added rows that behave like prime rows but are
    // not backed by a booking. They have a unique rowId beginning with
    // "EX-", a slot (string) and references to filmId, audId and
    // primeHM. They allow building custom cycles beyond the bookings.
    extraRows: [],
    // Manual shows are single show instances created directly on the
    // schedule grid. They do not participate in cycling like prime rows and
    // persist independently. Each has its own id, rowId, audId, audName,
    // filmId, filmTitle, start (Date), end (Date), runtime, trailer,
    // clean and cycle. They can be deleted by hiding the show (selecting
    // blank in the dropdown).
    manualShows: [],
    // Overrides allow editing individual show start times or auditorium
    // assignments without altering the base schedule. The key is the show
    // id (rowId:offset) and the value is an object with optional
    // start (Date), audId (number) and filmId (string). An override
    // leaves all other fields of the base show untouched.
    overrides: {},
    // Hidden shows are shows removed from the schedule grid. They remain
    // in state for undo but are filtered out of the showtime list. Keys
    // are show ids and values are true.
    hiddenShows: {},
    // When multi-date support is enabled, schedule data for each date is stored
    // under scheduleByDate. Each entry keyed by a date string (YYYY-MM-DD)
    // contains the arrays of primeRows, extraRows, manualShows, overrides,
    // hiddenShows and undoStack for that specific date. This allows
    // switching between schedules without losing data. If undefined, the
    // app operates in single-date mode using top-level fields. See
    // initDateSupport() and setDate() for details.
    scheduleByDate: {},
    // The currently selected date for the schedule. When null, the app
    // will default to today's date on first initialisation. The date
    // string must be in ISO format (YYYY-MM-DD) so that lexical sorting
    // matches chronological order.
    currentDate: null,
    // The currently configured first and last show times. These are HM
    // strings. The lastShowHM may represent a time after midnight (e.g.
    // "02:00"). In such cases, code that compares dates must treat the
    // last show as belonging to the next day. See dtFromHM below.
    firstShowHM: "07:00", // 7:00a
    lastShowHM: "23:00",  // 11:00p
    // Whether to display end times beneath start times on the schedule
    // grid. Toggled via Hide End Times button.
    showEndTimes: true,
    // Stack of undo operations. Each entry has a type and data needed to
    // revert. For now, only edits to show start times and manual show
    // additions are recorded.
    undoStack: [],
    // Controls whether the Start‑time Order panel is open. When true,
    // order-panel.js will show the side panel by default and leave the
    // main content shifted left. Persisting this flag allows the panel
    // to remain open across tab navigations.
    showOrderPanel: true,
  };

  // Local copy of state. Loaded on first access. All modifications should
  // go through setState or dedicated mutators to ensure persistence.
  let state = null;

  // Helper: pad single digit to two digits.
  function pad(n) { return n.toString().padStart(2, "0"); }

  // Convert HH:MM string to a Date representing today at that time. If the
  // time is between 0:00 and 4:59, treat it as belonging to the next day
  // only for end-of-day comparisons. Consumers must handle this where
  // relevant. This function never rolls over the date by itself; it
  // always returns today at the given time.
  function dtFromHM(hm) {
    if (typeof hm !== 'string') hm = '0:00';
    const m = hm.match(/^(\d{1,2}):(\d{1,2})$/);
    let H = 0, M = 0;
    if (m) {
      H = Math.min(23, Math.max(0, parseInt(m[1], 10) || 0));
      M = Math.min(59, Math.max(0, parseInt(m[2], 10) || 0));
    }
    const d = new Date();
    d.setHours(H, M, 0, 0);
    return d;
  }

  // Convert a Date to HH:MM string in 24‑hour format.
  function hmFromDate(d) { return pad(d.getHours()) + ":" + pad(d.getMinutes()); }

  // Add minutes to a date, returning a new Date.
  function addMins(d, mins) { const nd = new Date(d.getTime()); nd.setMinutes(nd.getMinutes() + mins); return nd; }

  // Difference in minutes between two dates (a - b).
  function diffMins(a, b) { return Math.round((a.getTime() - b.getTime()) / 60000); }

  // Round a number up to the nearest multiple of five.
  function roundUp5(x) { return Math.ceil(x / 5) * 5; }

  // Convert a date to a 12‑hour time with am/pm suffix (e.g. "10:30p").
  function to12(d) {
    // Format a Date to 12‑hour time with am/pm suffix.
    // Hours 0‑11 are AM and 12‑23 are PM. Midnight should be 12:MMam and noon 12:MMpm.
    let h = d.getHours();
    const m = pad(d.getMinutes());
    const isPm = h >= 12;
    // Convert to 12‑hour format (0 becomes 12, 13 becomes 1).
    h = h % 12 || 12;
    // Use explicit am/pm suffix rather than a single letter. This improves readability
    // for time pickers and selectors.
    const suffix = isPm ? 'pm' : 'am';
    return `${h}:${m}${suffix}`;
  }

  // Given a film object, compute the total minutes of a show cycle (runtime + trailer + clean),
  // rounded up to the nearest 5 minutes.
  function cycleMinutes(film) {
    if (!film) return 0;
    const total = (film.runtime || 0) + (film.trailer || 0) + (film.clean || 0);
    return roundUp5(total);
  }

  // Compute the end time of a show given a start and film definition.
  function endOfMovie(start, film) {
    return addMins(start, (film.runtime || 0) + (film.trailer || 0));
  }

  // Format duration (minutes) to H:MM (e.g. 2:10).
  function fmtDur(mins) {
    return `${Math.floor(mins / 60)}:${pad(mins % 60)}`;
  }

  // Convert an ISO date string (YYYY-MM-DD) to MM/DD/YYYY format. If the
  // input is invalid, return the original string. Note that this
  // utility does not change the underlying date object; it merely
  // reformats the string for display. This is useful for rendering
  // dates in the US style (e.g. 2025-08-19 -> 08/19/2025).
  function isoToMMDD(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return dateStr;
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    const [y, m, d] = parts;
    return `${m}/${d}/${y}`;
  }

  // Convert a MM/DD/YYYY string to ISO format (YYYY-MM-DD). If the
  // input is invalid or cannot be parsed, returns null. This helper
  // splits on either '/' or '-' for robustness. Leading zeros are
  // added to the month and day parts. The year must be four digits.
  function mmddToIso(mmdd) {
    if (!mmdd || typeof mmdd !== 'string') return null;
    // Split on common separators
    const parts = mmdd.trim().split(/[\/-]/);
    if (parts.length !== 3) return null;
    let [m, d, y] = parts;
    // Ensure year has four digits
    if (y.length !== 4) return null;
    // Pad month and day to two digits
    m = m.padStart(2, '0');
    d = d.padStart(2, '0');
    // Basic validation
    const mm = parseInt(m, 10);
    const dd = parseInt(d, 10);
    const yyyy = parseInt(y, 10);
    if (
      isNaN(mm) || isNaN(dd) || isNaN(yyyy) ||
      mm < 1 || mm > 12 ||
      dd < 1 || dd > 31 ||
      yyyy < 1000 || yyyy > 9999
    ) {
      return null;
    }
    return `${y}-${m}-${d}`;
  }

  // Convert HM string to 12‑hour display format (e.g. "14:00" -> "2:00p").
  function fmtHM(hm) {
    return to12(dtFromHM(hm));
  }

  // Load persisted state from localStorage. Merge with defaults to fill in
  // any missing keys. Called automatically on first access.
  function load() {
    if (state) return state;
    let loaded = {};
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      if (raw) loaded = JSON.parse(raw);
    } catch (e) {
      console.error('Failed to parse saved state', e);
    }
    state = { ...defaultState, ...loaded };
    // When rehydrating from localStorage, convert any serialized Dates back
    // into Date objects. Otherwise fields like manualShows.start/end or
    // overrides.start will remain strings and later property accesses
    // (e.g. getTime()) will throw. Iterate through collections and
    // hydrate strings into Date instances. This only runs once during
    // initial load.
    // Convert manual show start/end strings to Dates
    if (state.manualShows && Array.isArray(state.manualShows)) {
      state.manualShows.forEach(ms => {
        if (ms && typeof ms.start === 'string') {
          const d = new Date(ms.start);
          if (!isNaN(d)) ms.start = d;
        }
        if (ms && typeof ms.end === 'string') {
          const d2 = new Date(ms.end);
          if (!isNaN(d2)) ms.end = d2;
        }
      });
    }
    // Convert override start strings to Dates
    if (state.overrides && typeof state.overrides === 'object') {
      Object.values(state.overrides).forEach(ov => {
        if (ov && typeof ov.start === 'string') {
          const d = new Date(ov.start);
          if (!isNaN(d)) ov.start = d;
        }
      });
    }
    // Ensure primeRows and extraRows are arrays
    if (!Array.isArray(state.primeRows)) state.primeRows = [];
    if (!Array.isArray(state.extraRows)) state.extraRows = [];
    if (!Array.isArray(state.manualShows)) state.manualShows = [];
    if (!state.overrides || typeof state.overrides !== 'object') state.overrides = {};
    if (!state.hiddenShows || typeof state.hiddenShows !== 'object') state.hiddenShows = {};
    if (!Array.isArray(state.undoStack)) state.undoStack = [];

    // Ensure siteName and siteNumber fields exist. These identify the theatre
    // or site and are included in exported JSON. When not provided, default
    // to empty strings so that input fields bind to valid values.
    if (state.siteName === undefined || state.siteName === null) state.siteName = '';
    if (state.siteNumber === undefined || state.siteNumber === null) state.siteNumber = '';
    return state;
  }

  // Persist current state to localStorage. Certain transient keys may be
  // excluded here if needed (e.g. undoStack), but currently everything is
  // persisted.
  function save() {
    // When multi‑date support is enabled and a current date is set,
    // update the scheduleByDate entry for the current date before
    // persisting. This ensures that changes to primeRows, extraRows,
    // manualShows, overrides, hiddenShows and undoStack are captured
    // under the currentDate key. This is safe because JSON.stringify
    // will serialise Date objects to ISO strings. If scheduleByDate
    // doesn't exist, create it.
    if (state && state.currentDate) {
      if (!state.scheduleByDate || typeof state.scheduleByDate !== 'object') {
        state.scheduleByDate = {};
      }
      state.scheduleByDate[state.currentDate] = {
        primeRows: Array.isArray(state.primeRows) ? state.primeRows : [],
        extraRows: Array.isArray(state.extraRows) ? state.extraRows : [],
        manualShows: Array.isArray(state.manualShows) ? state.manualShows : [],
        overrides: state.overrides || {},
        hiddenShows: state.hiddenShows || {},
        undoStack: Array.isArray(state.undoStack) ? state.undoStack : [],
      };
      // Keep only the most recent 7 dates to avoid unbounded growth
      pruneOldSchedules();
    }
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
    } catch (e) {
      console.error('Failed to save state', e);
    }
    // Notify listeners within the same tab that the state has changed. The
    // native 'storage' event only fires on other tabs; dispatching a
    // custom event allows components like the start‑time order panel to
    // react immediately without polling or page navigation. The event name
    // is namespaced to avoid collisions.
    try {
      const evt = new Event('showtimeStateUpdated');
      window.dispatchEvent(evt);
    } catch (err) {
      // Older browsers may not support Event constructor; ignore.
    }
  }

  // Helper to clone an object (shallow) using JSON. Only used for
  // simple clones of state prior to modification when pushing to undo.
  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  // Retrieve film by id.
  function filmById(id) {
    return state.films.find(f => f.id === id) || null;
  }

  // Retrieve auditorium by id.
  function audById(id) {
    return state.auds.find(a => a.id === id) || null;
  }

  // Compute all showtime records for a single row based on its primeHM,
  // filmId and audId. A record contains id, rowId, offset, film info and
  // computed start/end times. Only shows within the first/last show
  // window are included.
  function buildRowShowtimes(row) {
    const film = filmById(row.filmId);
    const aud = audById(row.audId);
    if (!film || !aud || !row.primeHM) return [];
    const first = dtFromHM(state.firstShowHM);
    const last = dtFromHM(state.lastShowHM);
    // If last show is between midnight and 4:59, treat as next day
    if (last.getHours() < 5) last.setDate(last.getDate() + 1);
    const prime = dtFromHM(row.primeHM);
    // Determine cycle length
    const cycle = cycleMinutes(film);
    // Guard against zero or negative cycles (e.g., films with 0 runtime/trailer/clean).
    // A zero cycle would cause divide‑by‑zero in preCount/postCount calculations and hang the grid.
    if (!cycle || cycle <= 0) {
      return [];
    }
    const out = [];
    // Determine how many pre and post shows fit in the window
    const preCount = Math.floor(diffMins(prime, first) / cycle);
    const postCount = Math.floor(diffMins(last, prime) / cycle);
    for (let i = preCount; i >= 1; i--) {
      const st = addMins(prime, -i * cycle);
      if (st < first) continue;
      out.push(makeRec(row, -i, st, film, aud));
    }
    // Always include the prime show itself regardless of the first/last
    // window. Without this, rows whose primeHM falls outside the
    // configured start/end window disappear from the schedule grid.  We
    // still filter pre/post shows relative to the window below.
    out.push(makeRec(row, 0, prime, film, aud));
    for (let i = 1; i <= postCount; i++) {
      const st = addMins(prime, i * cycle);
      if (st > last) continue;
      out.push(makeRec(row, i, st, film, aud));
    }
    return out;
  }

  // Helper to build a single show record from row and offset.
  function makeRec(row, off, start, film, aud) {
    return {
      id: `${row.rowId}:${off}`,
      rowId: row.rowId,
      offset: off,
      audId: aud.id,
      audName: aud.name,
      filmId: film.id,
      // Include film format in the display title if present.  If a film has a
      // non‑empty format (e.g. "3D"), append it to the film title.  This
      // ensures that downstream consumers like the schedule and Gantt pages
      // display the parent film name together with its format.
      filmTitle: film.title + (film.format ? ' ' + film.format : ''),
      start: start,
      end: endOfMovie(start, film),
      runtime: film.runtime,
      trailer: film.trailer,
      clean: film.clean,
      cycle: cycleMinutes(film),
      source: 'Prime',
    };
  }

  // Compute a flattened array of all shows, applying overrides and
  // excluding hidden shows. Includes manual shows at their specified
  // times. If an override exists for a show id, its start or
  // auditorium assignment is updated accordingly. Overrides on filmId
  // are also applied.
  function getAllShows() {
    const shows = [];
    // Build from prime and extra rows
    const rows = (state.primeRows || []).concat(state.extraRows || []);
    rows.forEach(row => {
      buildRowShowtimes(row).forEach(rec => {
        shows.push(rec);
      });
    });
    // Include manual shows
    (state.manualShows || []).forEach(ms => {
      shows.push({ ...ms, source: 'Manual' });
    });
    // Apply overrides and filter hidden shows
    const mapped = shows
      .filter(r => !state.hiddenShows[r.id])
      .map(r => {
        const ov = state.overrides[r.id];
        if (!ov) return r;
        const updated = { ...r };
        // Apply start override
        if (ov.start) {
          updated.start = new Date(ov.start);
          const film = filmById(ov.filmId || r.filmId);
          updated.end = endOfMovie(updated.start, film);
        }
        // Apply auditorium override
        if (ov.audId) {
          updated.audId = ov.audId;
          const a = audById(ov.audId);
          updated.audName = a ? a.name : updated.audName;
        }
        // Apply film override
        if (ov.filmId && ov.filmId !== r.filmId) {
          const film = filmById(ov.filmId);
          if (film) {
            updated.filmId = film.id;
            // Append the film format to the display title when applying a
            // film override.  This mirrors makeRec() so that the film title
            // consistently includes its format across all contexts.
            updated.filmTitle = film.title + (film.format ? ' ' + film.format : '');
            updated.runtime = film.runtime;
            updated.trailer = film.trailer;
            updated.clean = film.clean;
            updated.cycle = cycleMinutes(film);
            updated.end = endOfMovie(updated.start, film);
          }
        }
        // Determine dynamic row grouping: if the override changed auditorium or film relative to base, group by dest auditorium and film
        if ((ov.audId && ov.audId !== r.audId) || (ov.filmId && ov.filmId !== r.filmId)) {
          // Use updated audId and filmId values after applying overrides to build the group id
          const destAud = updated.audId || r.audId;
          const destFilm = updated.filmId || r.filmId;
          updated.rowId = `OV-${destAud}-${destFilm}`;
          updated.source = 'Override';
        }
        return updated;
      });
    // Deduplicate shows by start time, auditorium and film.  In some
    // scenarios (e.g. entering times outside the first/last window or
    // overriding a show to the same time as another show) multiple
    // records can exist with identical start, auditorium and film.  To
    // prevent duplicate entries from appearing in the Gantt or Start‑Time
    // Order views, remove duplicates while preserving the first occurrence.
    mapped.sort((a, b) => a.start - b.start);
    const unique = [];
    const seen = new Set();
    mapped.forEach(rec => {
      // Use milliseconds for start time; fall back to number if not a Date
      const startTime = rec.start instanceof Date ? rec.start.getTime() : new Date(rec.start).getTime();
      const key = `${startTime}_${rec.audId}_${rec.filmId}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(rec);
      }
    });
    return unique;
  }

  // Generate options (HM strings) around a given show start time. Options
  // are 5‑minute increments within ±90 minutes of the start. Times
  // outside of the first/last show window are excluded.
  function optionsAround(start) {
    const opts = [];
    const first = dtFromHM(state.firstShowHM);
    const last = dtFromHM(state.lastShowHM);
    if (last.getHours() < 5) last.setDate(last.getDate() + 1);
    const base = new Date(start);
    for (let m = -90; m <= 90; m += 5) {
      const t = addMins(base, m);
      if (t < first || t > last) continue;
      opts.push(hmFromDate(t));
    }
    // Remove duplicates and sort ascending
    return [...new Set(opts)].sort();
  }

  // Update the start time of a specific show via override. This affects
  // only the given show id and does not alter other shows in the same
  // row. The previous override or base start time is pushed onto
  // undoStack so the change can be reverted. Passing an empty string
  // hides the show instead of changing its start.
  function updateShowStart(showId, hm) {
    load();
    const shows = getAllShows();
    const rec = shows.find(r => r.id === showId);
    if (!rec) return;
    // If hm is empty string, hide the show
    if (hm === '') {
      // Save previous hidden status for undo
      state.undoStack.push({ type: 'hide', showId: showId, prevHidden: !!state.hiddenShows[showId] });
      state.hiddenShows[showId] = true;
      save();
      return;
    }
    // Determine previous start override or base start
    const prevStart = state.overrides[showId]?.start || rec.start;
    state.undoStack.push({ type: 'edit', showId: showId, prevStart: prevStart });
    // Set new override start
    const newStart = dtFromHM(hm);
    if (state.overrides[showId]) {
      state.overrides[showId].start = newStart;
    } else {
      state.overrides[showId] = { start: newStart };
    }
    save();
  }

  // Update the auditorium assignment of a specific show via override.  This
  // function mirrors updateShowStart but for the auditorium (audId). It
  // records the previous auditorium on the undo stack so the change can
  // be reverted. Passing a null or empty value resets the override to
  // the base auditorium. Moving shows between auditoriums is needed for
  // the Gantt view to support vertical drag operations.
  function updateShowAud(showId, audId) {
    load();
    const shows = getAllShows();
    const rec = shows.find(r => r.id === showId);
    if (!rec) return;
    const newAud = (audId !== undefined && audId !== null && audId !== '') ? parseInt(audId, 10) : null;
    // Determine previous override or base auditorium
    const prevAud = state.overrides[showId]?.audId || rec.audId;
    // Special handling for manual shows: update the manual show record
    // directly instead of using overrides. Manual shows have a source
    // property set to 'Manual'. This ensures moving a manual show
    // between auditoriums updates its own audId/audName fields and
    // supports undo. Overrides are better suited for shows derived
    // from prime/extra rows.
    if (rec.source === 'Manual') {
      const msIdx = state.manualShows.findIndex(x => x.id === showId);
      if (msIdx !== -1) {
        // If clearing, revert to previous auditorium
        const targetAud = newAud === null ? prevAud : newAud;
        // If no change, do nothing
        if (targetAud === prevAud) return;
        // Push undo entry
        state.undoStack.push({ type: 'moveAud', showId: showId, prevAudId: prevAud });
        state.manualShows[msIdx].audId = targetAud;
        const audObj = audById(targetAud);
        state.manualShows[msIdx].audName = audObj ? audObj.name : '';
        save();
        return;
      }
    }
    // For non‑manual shows, use overrides
    if (newAud === null) {
      // Only act if an override currently exists for this show
      if (state.overrides[showId] && Object.prototype.hasOwnProperty.call(state.overrides[showId], 'audId')) {
        // Push undo entry
        state.undoStack.push({ type: 'moveAud', showId: showId, prevAudId: prevAud });
        delete state.overrides[showId].audId;
        if (Object.keys(state.overrides[showId]).length === 0) {
          delete state.overrides[showId];
        }
        save();
      }
      return;
    }
    // If the new auditorium matches the current assignment, do nothing
    if (newAud === prevAud) return;
    // Push undo entry
    state.undoStack.push({ type: 'moveAud', showId: showId, prevAudId: prevAud });
    if (!state.overrides[showId]) {
      state.overrides[showId] = { audId: newAud };
    } else {
      state.overrides[showId].audId = newAud;
    }
    save();
  }

  /**
   * Update the film assignment of a specific show via override. This mirrors
   * updateShowAud but for the film. If a manual show is edited, the
   * manual show record is updated directly (filmId, filmTitle, runtime,
   * trailer, clean, cycle, end). For non‑manual shows, a filmId
   * override is written to state.overrides. Passing a null or empty
   * value clears the override and reverts to the base film. Undo
   * operations are recorded so edits can be reverted.
   * @param {string} showId
   * @param {string|null} filmId
   */
  function updateShowFilm(showId, filmId) {
    load();
    const shows = getAllShows();
    const rec = shows.find(r => r.id === showId);
    if (!rec) return;
    const newFilmId = filmId === '' || filmId === null || filmId === undefined ? null : filmId;
    // Determine previous film assignment (override or base)
    const prevFilmId = state.overrides[showId]?.filmId || rec.filmId;
    // If nothing changes, do nothing
    if (newFilmId === prevFilmId) return;
    // Manual shows: update record directly
    if (rec.source === 'Manual') {
      const msIdx = state.manualShows.findIndex(x => x.id === showId);
      if (msIdx !== -1) {
        // Push undo entry
        state.undoStack.push({ type: 'editFilm', showId: showId, prevFilmId: prevFilmId });
        if (newFilmId === null) {
          // Clearing override for manual shows reverts to previous film; nothing to do
          save();
          return;
        }
        // Lookup film and update manual show fields
        const filmObj = filmById(newFilmId);
        if (!filmObj) return;
        const ms = state.manualShows[msIdx];
        ms.filmId = filmObj.id;
        // Include format when updating the film title for a manual show
        ms.filmTitle = filmObj.title + (filmObj.format ? ' ' + filmObj.format : '');
        ms.runtime = filmObj.runtime;
        ms.trailer = filmObj.trailer;
        ms.clean = filmObj.clean;
        ms.cycle = cycleMinutes(filmObj);
        // Recompute end based on existing start and new film runtime/trailer
        ms.end = endOfMovie(ms.start, filmObj);
        save();
        return;
      }
    }
    // Non‑manual shows: write override or clear override
    if (newFilmId === null) {
      // Remove film override if it exists
      if (state.overrides[showId] && Object.prototype.hasOwnProperty.call(state.overrides[showId], 'filmId')) {
        // Record undo
        state.undoStack.push({ type: 'editFilm', showId: showId, prevFilmId: prevFilmId });
        delete state.overrides[showId].filmId;
        if (Object.keys(state.overrides[showId]).length === 0) {
          delete state.overrides[showId];
        }
        save();
      }
      return;
    }
    // Otherwise set override
    // Record undo entry
    state.undoStack.push({ type: 'editFilm', showId: showId, prevFilmId: prevFilmId });
    if (!state.overrides[showId]) {
      state.overrides[showId] = { filmId: newFilmId };
    } else {
      state.overrides[showId].filmId = newFilmId;
    }
    save();
  }

  // Remove (unhide) a show by id. Used when undoing a hide operation.
  function unhideShow(showId, prevHidden) {
    if (!prevHidden) {
      // Remove the hidden flag
      delete state.hiddenShows[showId];
    } else {
      // Restore previous hidden state
      state.hiddenShows[showId] = true;
    }
  }

  // Remove or revert override for a show. Used when undoing an edit.
  function revertOverride(showId, prevStart) {
    if (!state.overrides[showId]) {
      state.overrides[showId] = { start: prevStart };
    } else {
      state.overrides[showId].start = prevStart;
    }
  }

  // Undo the most recent edit or manual show creation. Pops from
  // undoStack and applies the inverse operation.
  function undo() {
    load();
    const entry = state.undoStack.pop();
    if (!entry) return;
    if (entry.type === 'edit') {
      revertOverride(entry.showId, entry.prevStart);
    } else if (entry.type === 'hide') {
      unhideShow(entry.showId, entry.prevHidden);
    } else if (entry.type === 'manual') {
      // Remove a manual show entirely
      const idx = state.manualShows.findIndex(x => x.id === entry.show.id);
      if (idx !== -1) state.manualShows.splice(idx, 1);
    } else if (entry.type === 'moveAud') {
      // Revert an auditorium move.  If the previous auditorium matches the
      // base row assignment (i.e. no override was originally set), then
      // remove the override; otherwise restore the previous override value.
      const sid = entry.showId;
      const prev = entry.prevAudId;
      const currentBase = getAllShows().find(r => r.id === sid)?.audId;
      if (prev === currentBase) {
        // Remove audId override entirely
        if (state.overrides[sid]) {
          delete state.overrides[sid].audId;
          // If override becomes empty object, remove it
          if (Object.keys(state.overrides[sid]).length === 0) {
            delete state.overrides[sid];
          }
        }
      } else {
        if (!state.overrides[sid]) {
          state.overrides[sid] = { audId: prev };
        } else {
          state.overrides[sid].audId = prev;
        }
      }
    }

    // Revert film edit
    else if (entry.type === 'editFilm') {
      const sid = entry.showId;
      const prevFilm = entry.prevFilmId;
      // If rec is a manual show, revert manual show directly
      const msIdx = state.manualShows.findIndex(x => x.id === sid);
      if (msIdx !== -1) {
        const ms = state.manualShows[msIdx];
        const filmObj = filmById(prevFilm);
        if (filmObj) {
          ms.filmId = filmObj.id;
          // When reverting a film edit, restore the film title with its format if present
          ms.filmTitle = filmObj.title + (filmObj.format ? ' ' + filmObj.format : '');
          ms.runtime = filmObj.runtime;
          ms.trailer = filmObj.trailer;
          ms.clean = filmObj.clean;
          ms.cycle = cycleMinutes(filmObj);
          ms.end = endOfMovie(ms.start, filmObj);
        }
      } else {
        // For overrides, restore previous filmId or remove override
        if (!prevFilm || prevFilm === (getAllShows().find(r => r.id === sid)?.filmId)) {
          // Remove film override
          if (state.overrides[sid] && state.overrides[sid].filmId) {
            delete state.overrides[sid].filmId;
            if (Object.keys(state.overrides[sid]).length === 0) {
              delete state.overrides[sid];
            }
          }
        } else {
          if (!state.overrides[sid]) {
            state.overrides[sid] = { filmId: prevFilm };
          } else {
            state.overrides[sid].filmId = prevFilm;
          }
        }
      }
    }
    save();
  }

  // Create a new manual show at the selected time in the specified row.
  // The filmId and audId are taken from the row. Records an undo entry.
  function addManualShow(rowId, hm) {
    load();
    const row = state.primeRows.concat(state.extraRows).find(r => r.rowId === rowId);
    if (!row) return;
    const film = filmById(row.filmId);
    const aud = audById(row.audId);
    if (!film || !aud) return;
    const start = dtFromHM(hm);
    const end = endOfMovie(start, film);
    const id = `M-${Date.now()}-${Math.floor(Math.random()*1000)}`;
    const rec = {
      id: id,
      rowId: rowId,
      audId: aud.id,
      audName: aud.name,
      filmId: film.id,
      // Include the film format in the title for manual shows
      filmTitle: film.title + (film.format ? ' ' + film.format : ''),
      start: start,
      end: end,
      runtime: film.runtime,
      trailer: film.trailer,
      clean: film.clean,
      cycle: cycleMinutes(film),
      source: 'Manual'
    };
    state.manualShows.push(rec);
    state.undoStack.push({ type: 'manual', show: rec });
    save();
  }

  // Add a new extra row (manual row). Returns the new row object. Row ids
  // are unique strings starting with "EX-" followed by timestamp.
  function addExtraRow() {
    load();
    const id = `EX-${Date.now()}-${Math.floor(Math.random()*1000)}`;
    const slot = String((state.primeRows.length + state.extraRows.length) + 1);
    const row = { rowId: id, bookingId: null, slot: slot, audId: null, filmId: null, primeHM: '' };
    state.extraRows.push(row);
    save();
    return row;
  }

  // Set a field on a row (prime or extra). field is 'audId', 'filmId' or
  // 'primeHM'. For primeHM this does not cascade to show overrides; it
  // simply updates the cycle start time for that row.
  function setRowField(rowId, field, value) {
    load();
    let row = state.primeRows.find(r => r.rowId === rowId);
    if (!row) row = state.extraRows.find(r => r.rowId === rowId);
    if (!row) return;
    row[field] = value;
    // When editing row-level auditorium or film, propagate changes to manual
    // shows associated with this row. Manual shows are single show
    // instances created directly on the schedule grid. They copy the
    // row's auditorium and film at creation time, so they can fall out of
    // sync when the row is later edited. To mirror the behaviour of the
    // original React app, update manual show records when the row's
    // auditorium or film changes. This keeps the Start‑time Order panel
    // consistent with the schedule grid.
    if (field === 'audId') {
      const newAudId = value ? parseInt(value, 10) : null;
      (state.manualShows || []).forEach(ms => {
        if (ms.rowId === rowId) {
          ms.audId = newAudId;
          const aud = audById(newAudId);
          ms.audName = aud ? aud.name : '';
        }
      });
    } else if (field === 'filmId') {
      const newFilmId = value || null;
      (state.manualShows || []).forEach(ms => {
        if (ms.rowId === rowId) {
          const film = filmById(newFilmId);
          if (film) {
            ms.filmId = film.id;
            // When updating the film of a manual show, update the title to include the
            // format so that it appears consistently across the UI
            ms.filmTitle = film.title + (film.format ? ' ' + film.format : '');
            ms.runtime = film.runtime;
            ms.trailer = film.trailer;
            ms.clean = film.clean;
            ms.cycle = cycleMinutes(film);
            // update end time based on new film runtime and trailer; clean
            const totalMins = (film.runtime || 0) + (film.trailer || 0);
            ms.end = addMins(ms.start, totalMins);
          } else {
            // if no film, clear film-related fields
            ms.filmId = null;
            ms.filmTitle = '';
            ms.runtime = 0;
            ms.trailer = 0;
            ms.clean = 0;
            ms.cycle = 0;
            ms.end = ms.start;
          }
        }
      });
    }
    save();
  }

  // Hide or reveal end times on the grid
  function toggleEndTimes() {
    load();
    state.showEndTimes = !state.showEndTimes;
    save();
  }

  // Clear all showtimes across the application. This resets prime times,
  // removes all overrides and manual shows, and clears hidden shows. It
  // preserves the structure of primeRows and extraRows so that users can
  // assign new times from scratch. This is useful for starting over.
  function clearAllTimes() {
    load();
    // Reset prime times on prime and extra rows
    if (Array.isArray(state.primeRows)) {
      state.primeRows.forEach(r => { r.primeHM = ''; });
    }
    if (Array.isArray(state.extraRows)) {
      state.extraRows.forEach(r => { r.primeHM = ''; });
    }
    // Remove all overrides and manual shows and hidden shows
    state.overrides = {};
    state.manualShows = [];
    state.hiddenShows = {};
    // Also reset undo stack
    state.undoStack = [];
    save();
  }

  /**
   * Ensure that multi‑date support is initialised. When called, this will
   * initialise the scheduleByDate and currentDate fields on the state if
   * they are missing. It will also migrate any existing top‑level
   * schedule fields (primeRows, extraRows, manualShows, overrides,
   * hiddenShows and undoStack) into the schedule entry for the current
   * date. Once initialised, it loads the schedule for the current date
   * into the top‑level fields so that the rest of the app continues
   * operating as before. If no currentDate is present, today's date
   * (local time) is used. Finally it persists the changes to storage.
   */
  function initDateSupport() {
    load();
    // Create the scheduleByDate container if missing
    if (!state.scheduleByDate || typeof state.scheduleByDate !== 'object') {
      state.scheduleByDate = {};
    }
    // Determine the current date; if not set, default to today's date
    if (!state.currentDate) {
      const today = new Date();
      const dateStr = today.toISOString().split('T')[0];
      state.currentDate = dateStr;
    }
    // If there is no schedule stored for the current date, migrate the
    // existing top‑level schedule fields into a new entry. This ensures
    // users upgrading from a single‑date state keep their existing
    // schedule as the schedule for the current date.
    if (!state.scheduleByDate[state.currentDate]) {
      state.scheduleByDate[state.currentDate] = {
        primeRows: Array.isArray(state.primeRows) ? state.primeRows : [],
        extraRows: Array.isArray(state.extraRows) ? state.extraRows : [],
        manualShows: Array.isArray(state.manualShows) ? state.manualShows : [],
        overrides: state.overrides || {},
        hiddenShows: state.hiddenShows || {},
        undoStack: Array.isArray(state.undoStack) ? state.undoStack : [],
      };
    }
    // Load the schedule for the current date into top‑level fields
    loadSchedule(state.currentDate);
    // Persist the state so that currentDate and scheduleByDate are saved
    save();
  }

  /**
   * Persist the current schedule into the scheduleByDate map. The schedule
   * fields (primeRows, extraRows, manualShows, overrides, hiddenShows,
   * undoStack) are saved under the key of state.currentDate. Manual
   * shows are stored with their start/end fields preserved as Date
   * objects; these will be serialised to ISO strings when persisted via
   * save(). A retention policy keeps only the most recent 7 dates to
   * avoid unbounded growth.
   */
  function saveCurrentSchedule() {
    load();
    if (!state.currentDate) return;
    if (!state.scheduleByDate || typeof state.scheduleByDate !== 'object') {
      state.scheduleByDate = {};
    }
    state.scheduleByDate[state.currentDate] = {
      primeRows: Array.isArray(state.primeRows) ? state.primeRows : [],
      extraRows: Array.isArray(state.extraRows) ? state.extraRows : [],
      manualShows: Array.isArray(state.manualShows) ? state.manualShows : [],
      overrides: state.overrides || {},
      hiddenShows: state.hiddenShows || {},
      undoStack: Array.isArray(state.undoStack) ? state.undoStack : [],
    };
    pruneOldSchedules();
  }

  /**
   * Load the schedule for a given date into the top‑level schedule fields.
   * If the specified date does not yet have a schedule entry, a new
   * blank schedule is created. This function does not persist the
   * change; callers should invoke save() after calling loadSchedule() if
   * they want the change to be stored. Dates must be provided as
   * strings in ISO format (YYYY-MM-DD).
   * @param {string} date 
   */
  function loadSchedule(date) {
    load();
    if (!state.scheduleByDate || typeof state.scheduleByDate !== 'object') {
      state.scheduleByDate = {};
    }
    if (!date) {
      // If no date provided, fall back to currentDate or today's date
      if (!state.currentDate) {
        const today = new Date();
        date = today.toISOString().split('T')[0];
      } else {
        date = state.currentDate;
      }
    }
    // Ensure there is a schedule entry for this date
    if (!state.scheduleByDate[date]) {
      state.scheduleByDate[date] = {
        primeRows: [],
        extraRows: [],
        manualShows: [],
        overrides: {},
        hiddenShows: {},
        undoStack: [],
      };
    }
    // Copy schedule fields into top‑level state
    const sched = state.scheduleByDate[date];
    state.primeRows = Array.isArray(sched.primeRows) ? sched.primeRows : [];
    state.extraRows = Array.isArray(sched.extraRows) ? sched.extraRows : [];
    // Deep copy manual shows, converting start/end strings to Date objects
    state.manualShows = Array.isArray(sched.manualShows) ? sched.manualShows.map(ms => {
      const copy = { ...ms };
      if (typeof copy.start === 'string') {
        const d = new Date(copy.start);
        if (!isNaN(d)) copy.start = d;
      }
      if (typeof copy.end === 'string') {
        const d2 = new Date(copy.end);
        if (!isNaN(d2)) copy.end = d2;
      }
      return copy;
    }) : [];
    state.overrides = sched.overrides ? { ...sched.overrides } : {};
    state.hiddenShows = sched.hiddenShows ? { ...sched.hiddenShows } : {};
    state.undoStack = Array.isArray(sched.undoStack) ? sched.undoStack : [];
    state.currentDate = date;
  }

  /**
   * Remove old schedules to maintain only the most recent N dates. We
   * extend the retention window from 7 to 14 entries so that copying
   * schedules across multiple days does not inadvertently drop the
   * source day or newly copied dates. The keys are sorted
   * lexicographically (which corresponds to chronological order for
   * ISO‑8601 strings) and the oldest keys beyond the retention limit
   * are deleted. If the total number of keys is less than or equal
   * to the retention limit, nothing is deleted.
   */
  function pruneOldSchedules() {
    if (!state.scheduleByDate || typeof state.scheduleByDate !== 'object') return;
    const keys = Object.keys(state.scheduleByDate);
    // Retain up to this many schedules (roughly two weeks). Adjust if
    // you need a larger or smaller window.
    const retention = 14;
    if (keys.length <= retention) return;
    keys.sort();
    const toDelete = keys.slice(0, keys.length - retention);
    toDelete.forEach(k => {
      delete state.scheduleByDate[k];
    });
  }

  /**
   * Change the current schedule date. This will first save the current
   * schedule under state.currentDate, then load the schedule for the
   * specified date and update the state accordingly. Finally it
   * persists the changes and dispatches a custom event to allow
   * listeners to react to the date change. If the provided date is
   * empty or null, this function returns without action.
   * @param {string} date  The new date in YYYY-MM-DD format
   */
  function setDate(date) {
    if (!date) return;
    load();
    // Save the current schedule before switching
    saveCurrentSchedule();
    // Load the new schedule
    loadSchedule(date);
    // Persist changes
    save();
    // Notify listeners that the date has changed
    try {
      const evt = new Event('showtimeDateChanged');
      window.dispatchEvent(evt);
    } catch (err) {}
  }

  /**
   * Copy a schedule from one date to one or more target dates.  This will
   * first ensure that the current schedule is saved, then duplicate the
   * schedule data (primeRows, extraRows, manualShows, overrides,
   * hiddenShows) for each target date provided.  If a target date
   * already exists, it will be overwritten.  The undoStack is
   * intentionally cleared on the copied schedules because undo history
   * should not carry over between days.  After copying, changes are
   * persisted.  If fromDate is falsy or targetDates is not an array,
   * the function returns without doing anything.
   *
   * @param {string} fromDate
   *   The date to copy from (YYYY-MM-DD).  If null, the current date
   *   (state.currentDate) will be used.
   * @param {string[]} targetDates
   *   An array of target dates (YYYY-MM-DD) to copy the schedule to.
   */
  function copySchedule(fromDate, targetDates) {
    load();
    if (!Array.isArray(targetDates) || targetDates.length === 0) return;
    // Determine the source date.  If fromDate is not provided, use the current date.
    const sourceDate = fromDate || state.currentDate;
    if (!sourceDate) return;
    // Ensure the current schedule is saved before copying
    saveCurrentSchedule();
    const srcSched = state.scheduleByDate[sourceDate];
    if (!srcSched) return;
    // Deep copy helper for rows (primeRows/extraRows)
    const deepCopyRows = (rows) => rows.map(r => JSON.parse(JSON.stringify(r)));
    // Deep copy manual shows: copy object and ensure Date fields are actual Date objects
    const deepCopyManualShows = (ms) => ms.map(show => {
      const c = { ...show };
      c.start = show.start instanceof Date ? new Date(show.start) : new Date(show.start);
      c.end = show.end instanceof Date ? new Date(show.end) : new Date(show.end);
      return c;
    });
    targetDates.forEach(targetDate => {
      if (!targetDate) return;
      // Ensure scheduleByDate exists
      if (!state.scheduleByDate || typeof state.scheduleByDate !== 'object') {
        state.scheduleByDate = {};
      }
      // Assign deep copies to target date
      state.scheduleByDate[targetDate] = {
        primeRows: Array.isArray(srcSched.primeRows) ? deepCopyRows(srcSched.primeRows) : [],
        extraRows: Array.isArray(srcSched.extraRows) ? deepCopyRows(srcSched.extraRows) : [],
        manualShows: Array.isArray(srcSched.manualShows) ? deepCopyManualShows(srcSched.manualShows) : [],
        overrides: srcSched.overrides ? { ...srcSched.overrides } : {},
        hiddenShows: srcSched.hiddenShows ? { ...srcSched.hiddenShows } : {},
        // Reset undo stack on copied schedules
        undoStack: [],
      };
    });
    // Persist changes
    save();
  }

  /**
   * Clear the schedule for a specific date. If no date is provided, the
   * current date is cleared. This resets primeRows, extraRows,
   * manualShows, overrides, hiddenShows and undoStack for that date.
   * If the cleared date is the currently selected date, the top‑level
   * collections are also emptied so the UI reflects the changes
   * immediately. After clearing, the state is saved. Use this to
   * quickly remove all shows from a single day without deleting
   * auditoriums or bookings.
   * @param {string|null} date
   */
  function clearSchedule(date) {
    load();
    const iso = date || state.currentDate;
    if (!iso) return;
    if (!state.scheduleByDate || typeof state.scheduleByDate !== 'object') {
      state.scheduleByDate = {};
    }
    state.scheduleByDate[iso] = {
      primeRows: [],
      extraRows: [],
      manualShows: [],
      overrides: {},
      hiddenShows: {},
      undoStack: [],
    };
    // If clearing the current date, also reset top-level schedule arrays
    if (iso === state.currentDate) {
      state.primeRows = [];
      state.extraRows = [];
      state.manualShows = [];
      state.overrides = {};
      state.hiddenShows = {};
      state.undoStack = [];
    }
    save();
  }

  /**
   * Clear schedules for all dates. This iterates over scheduleByDate
   * entries and replaces each schedule with an empty one. It also
   * clears the top‑level schedule fields to reflect the currently
   * selected date (if any). After clearing, the state is saved.
   */
  function clearAllSchedules() {
    load();
    if (!state.scheduleByDate || typeof state.scheduleByDate !== 'object') {
      state.scheduleByDate = {};
    }
    Object.keys(state.scheduleByDate).forEach((d) => {
      state.scheduleByDate[d] = {
        primeRows: [],
        extraRows: [],
        manualShows: [],
        overrides: {},
        hiddenShows: {},
        undoStack: [],
      };
    });
    // Clear top‑level schedule arrays
    state.primeRows = [];
    state.extraRows = [];
    state.manualShows = [];
    state.overrides = {};
    state.hiddenShows = {};
    state.undoStack = [];
    save();
  }

  /**
   * Clear all bookings and all schedule data across every date. This
   * helper removes every booking entry and resets all schedule
   * collections (primeRows, extraRows, manualShows, overrides,
   * hiddenShows and undoStack) both at the top level and for each
   * date in scheduleByDate. It preserves auditorium and film
   * definitions. After clearing, the state is saved. Use this when
   * you need to start over with a completely blank schedule and
   * bookings list.
   */
  function clearBookingsAndTimes() {
    load();
    // Clear bookings list
    state.bookings = [];
    // Clear top‑level schedule arrays
    state.primeRows = [];
    state.extraRows = [];
    state.manualShows = [];
    state.overrides = {};
    state.hiddenShows = {};
    state.undoStack = [];
    // Clear schedule entries for every date if multi‑date support is enabled
    if (state.scheduleByDate && typeof state.scheduleByDate === 'object') {
      Object.keys(state.scheduleByDate).forEach((d) => {
        state.scheduleByDate[d] = {
          primeRows: [],
          extraRows: [],
          manualShows: [],
          overrides: {},
          hiddenShows: {},
          undoStack: [],
        };
      });
    }
    save();
  }

  /**
   * Return a sorted array of all dates present in scheduleByDate. Dates are
   * returned in ascending order (oldest first).
   */
  function listDates() {
    load();
    if (!state.scheduleByDate || typeof state.scheduleByDate !== 'object') return [];
    return Object.keys(state.scheduleByDate).sort();
  }

  /**
   * Return the currently selected date. If null, returns null.
   */
  function getCurrentDate() {
    load();
    return state.currentDate || null;
  }

  // Expose the state and helper methods on window.ShowtimeState
  window.ShowtimeState = {
    get state() { return load(); },
    load,
    save,
    filmById,
    audById,
    buildRowShowtimes,
    getAllShows,
    optionsAround,
    updateShowStart,
    updateShowAud,
    updateShowFilm,
    addManualShow,
    addExtraRow,
    setRowField,
    toggleEndTimes,
    clearAllTimes,
    // Clear the schedule for the current date or a specific date
    clearSchedule,
    // Clear schedules for all dates
    clearAllSchedules,
    // Clear all bookings and times across every date
    clearBookingsAndTimes,
    undo,
    fmtHM,
    to12,
    hmFromDate,
    dtFromHM,
    cycleMinutes,
    fmtDur,
    // Date support API
    initDateSupport,
    saveCurrentSchedule,
    loadSchedule,
    setDate,
    listDates,
    getCurrentDate,
    copySchedule,
    // Expose date formatting helpers so pages can convert between
    // ISO strings and MM/DD/YYYY. These do not modify the state.
    isoToMMDD,
    mmddToIso,
  };

  /**
   * Prompt the user for one or more target dates and copy the current schedule
   * to those dates.  This helper uses a simple comma‑separated list input
   * rather than a complex multi‑date picker to minimise UI clutter.  After
   * copying, a confirmation alert is displayed.  If no input is provided,
   * the function returns without making any changes.
   */
  window.copyScheduleUI = function () {
    const currentDate = ShowtimeState.getCurrentDate();
    if (!currentDate) {
      alert('No date selected.');
      return;
    }
    const input = prompt(
      'Enter one or more target dates (YYYY‑MM‑DD) separated by commas:',
      ''
    );
    if (!input) return;
    const dates = input
      .split(',')
      .map((d) => d.trim())
      .filter((d) => d);
    if (dates.length === 0) return;
    ShowtimeState.copySchedule(currentDate, dates);
    alert(
      `Schedule for ${currentDate} copied to: ${dates.join(', ')}. You can switch dates to view changes.`
    );
  };

  /**
   * Film highlight selector and highlighting logic
   *
   * On every page that includes a <nav> element this code will inject a
   * dropdown to select a film by title. Selecting a film will persist
   * the selection in state.highlightFilmId, fire a custom
   * `filmHighlightChange` event and apply a pink highlight to every
   * element marked with a `data-filmid` attribute matching the
   * selected film.  The highlight uses a semi‑dark pinkish colour
   * defined in theme.css via the .film-highlight class.
   */
  document.addEventListener('DOMContentLoaded', () => {
    try {
      const nav = document.querySelector('nav');
      if (!nav) return;
      const state = ShowtimeState.state;
      // Create select for highlighting films
      const select = document.createElement('select');
      select.id = 'filmHighlightSelect';
      // Style the film highlight dropdown to stand out against the dark nav background.
      // Use a white background and dark text so the options are legible.
      select.className = 'ml-2 px-2 py-1 border border-gray-300 rounded text-sm bg-white text-gray-800';
      // Placeholder option
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Highlight Film';
      select.appendChild(placeholder);
      // Function to refresh option list from current films
      function refreshOptions() {
        // Remove all options except the placeholder
        while (select.options.length > 1) {
          select.remove(1);
        }
        // Compute the set of filmIds that are currently in use across
        // bookings, prime rows, extra rows and manual shows.  Only
        // films that are actually scheduled or booked should appear in
        // the highlight dropdown.  This prevents long lists of unused
        // films from cluttering the UI.
        // Only collect film IDs that are currently referenced on the Bookings
        // page.  Exclude prime rows, extra rows and manual shows so that
        // old films cleared from the bookings list do not linger in the
        // highlight dropdown.
        const usedIds = new Set();
        try {
          const st = ShowtimeState.state || state;
          (st.bookings || []).forEach(b => {
            if (b && b.filmId) usedIds.add(String(b.filmId));
          });
        } catch (_) {}
        // Map titles to a single film record to avoid duplicates when
        // multiple film objects share the same title (e.g. different
        // formats).  Keys are lowercase trimmed titles.
        const filmMap = {};
        usedIds.forEach(fid => {
          let f = null;
          try {
            if (ShowtimeState && typeof ShowtimeState.filmById === 'function') {
              f = ShowtimeState.filmById(fid);
            }
          } catch (_) {}
          if (!f) {
            // fallback to scanning state.films
            const st = ShowtimeState.state || state;
            if (st && st.films) {
              f = st.films.find(item => String(item.id) === fid);
            }
          }
          if (f && f.title) {
            const key = (f.title || '').toLowerCase().trim();
            if (!filmMap[key]) {
              filmMap[key] = f;
            }
          }
        });
        const films = Object.values(filmMap);
        films.sort((a, b) => a.title.localeCompare(b.title));
        films.forEach(f => {
          const opt = document.createElement('option');
          opt.value = String(f.id);
          opt.textContent = f.title;
          select.appendChild(opt);
        });
        // Restore previous selection if still present; otherwise clear
        if (state.highlightFilmId) {
          const exists = films.some(f => String(f.id) === state.highlightFilmId);
          if (exists) {
            select.value = state.highlightFilmId;
          } else {
            // Clear highlight if the previously selected film is no longer in use
            state.highlightFilmId = '';
            ShowtimeState.save();
            select.value = '';
          }
        }
      }
      refreshOptions();
      // After initially populating the dropdown with all films, override
      // the refresh logic to filter the list to only those films that
      // are currently used in the schedule.  This helper computes a
      // set of used film IDs from bookings, prime rows, extra rows and
      // manual shows, then deduplicates by film title.  The existing
      // highlight selection is cleared if the film is no longer used.
      function refreshUsedFilmOptions() {
        // Remove all options except the placeholder
        while (select.options.length > 1) {
          select.remove(1);
        }
        // Only collect film IDs referenced in bookings. Exclude primeRows,
        // extraRows and manualShows so that films cleared from bookings do
        // not linger in the dropdown.  If state is undefined, usedIds
        // remains empty.
        const usedIds = new Set();
        try {
          const st = ShowtimeState.state;
          (st.bookings || []).forEach(b => {
            if (b && b.filmId != null && b.filmId !== '') usedIds.add(String(b.filmId));
          });
        } catch (e) {
          // ignore errors when computing used ids
        }
        const filmMap = new Map();
        (state.films || []).forEach(f => {
          if (!f || !f.title) return;
          const idStr = String(f.id);
          if (!usedIds.has(idStr)) return;
          if (!filmMap.has(f.title)) filmMap.set(f.title, f);
        });
        const films = Array.from(filmMap.values()).sort((a, b) => a.title.localeCompare(b.title));
        films.forEach(f => {
          const opt = document.createElement('option');
          opt.value = String(f.id);
          opt.textContent = f.title;
          select.appendChild(opt);
        });
        // If the current highlight film is no longer used, clear it
        if (state.highlightFilmId && !usedIds.has(String(state.highlightFilmId))) {
          state.highlightFilmId = '';
          ShowtimeState.save();
        }
        // Restore previous selection if still valid
        if (state.highlightFilmId) {
          select.value = state.highlightFilmId;
        } else {
          select.value = '';
        }
      }
      // Override the global refresh function with the used-films version
      window.refreshFilmHighlightOptions = refreshUsedFilmOptions;
      // Immediately repopulate the dropdown using only used films
      refreshUsedFilmOptions();
      // Persist highlight selection and apply highlight on change
      select.addEventListener('change', () => {
        state.highlightFilmId = select.value || '';
        ShowtimeState.save();
        // Dispatch an event to notify page scripts of the change
        try {
          const evt = new CustomEvent('filmHighlightChange', { detail: { filmId: state.highlightFilmId } });
          window.dispatchEvent(evt);
        } catch {}
        // Apply highlight on the current page immediately
        if (typeof window.applyFilmHighlight === 'function') {
          window.applyFilmHighlight();
        }
      });
      // Insert the select into a designated placeholder if present.  Pages
      // can include a <span id="filmHighlightPlaceholder"></span> in
      // their navigation markup to control where the highlight dropdown
      // appears.  If no placeholder exists, fall back to inserting the
      // select immediately after the last navigation link as before.
      try {
        const placeholder = document.getElementById('filmHighlightPlaceholder');
        if (placeholder) {
          // Clear any existing children and append the select.  Keeping the
          // placeholder element allows future refreshes to target the same
          // container.
          while (placeholder.firstChild) {
            placeholder.removeChild(placeholder.firstChild);
          }
          placeholder.appendChild(select);
        } else {
          // If no placeholder exists, do not insert the highlight dropdown on
          // this page.  The absence of a placeholder indicates the page
          // does not wish to display the film highlight control (e.g. the
          // Prime schedule).  Simply skip insertion here.  Pages that
          // require the dropdown should include a #filmHighlightPlaceholder
          // element in their navigation markup.
          return;
        }
      } catch (_) {
        nav.appendChild(select);
      }
      // Expose refresh function globally so pages can repopulate the
      // options when films change (e.g. via bulk bookings).  The
      // refreshUsedFilmOptions function ensures only films referenced on
      // the Bookings tab are listed.  This assignment intentionally
      // overrides any previous assignments on window.
      window.refreshFilmHighlightOptions = refreshUsedFilmOptions;
      // Ensure highlightFilmId exists in state
      if (state.highlightFilmId === undefined) {
        state.highlightFilmId = '';
        ShowtimeState.save();
      }
      // Apply any existing highlight once after the first render cycle.
      // We wait briefly to allow page-specific render functions to run.
      setTimeout(() => {
        if (typeof window.applyFilmHighlight === 'function') {
          window.applyFilmHighlight();
        }
      }, 100);

      // When the underlying localStorage state changes (e.g. when
      // bookings are cleared or films are added on another page),
      // refresh the options list.  The storage event normally only
      // fires across different documents, but we trigger it manually
      // after saving state to keep pages in sync.
      window.addEventListener('storage', () => {
        try {
          if (typeof window.refreshFilmHighlightOptions === 'function') {
            window.refreshFilmHighlightOptions();
          }
        } catch (_) {}
      });
    } catch (err) {
      // Suppress errors to avoid breaking page load if nav is missing
    }
  });

  // Global helper to apply film highlight on the current page.  This
  // function iterates over all elements with a data-filmid attribute and
  // toggles the 'film-highlight' class based on whether the value
  // matches the currently selected highlightFilmId stored in state. It
  // also highlights Gantt bars (divs with data-filmid) if present.
  window.applyFilmHighlight = function() {
    try {
      const state = ShowtimeState.state;
      const highlightId = state.highlightFilmId || '';
      // If no film is selected, remove all highlights
      if (!highlightId) {
        document.querySelectorAll('[data-filmid]').forEach(el => {
          el.classList.remove('film-highlight');
        });
        return;
      }
      // Look up the selected film's title.  If not found, clear highlights.
      let highlightTitle = '';
      try {
        const film = ShowtimeState.filmById(highlightId);
        if (film && film.title) {
          highlightTitle = (film.title || '').toLowerCase().trim();
        }
      } catch (_) {}
      if (!highlightTitle) {
        document.querySelectorAll('[data-filmid]').forEach(el => {
          el.classList.remove('film-highlight');
        });
        return;
      }
      // For each element with data-filmid, compare its film's title to the highlight title
      const els = document.querySelectorAll('[data-filmid]');
      els.forEach(el => {
        const fid = el.dataset.filmid;
        if (!fid) {
          el.classList.remove('film-highlight');
          return;
        }
        let f2;
        try {
          f2 = ShowtimeState.filmById(fid);
        } catch (_) {}
        const t = f2 && f2.title ? f2.title.toLowerCase().trim() : '';
        if (t && t === highlightTitle) {
          el.classList.add('film-highlight');
        } else {
          el.classList.remove('film-highlight');
        }
      });
    } catch (err) {}
  };

  /**
   * Refresh the film highlight dropdown based on currently used films.
   *
   * This function inspects bookings, prime rows, extra rows, manual shows
   * and multi‑date schedule entries to determine which films are
   * actively referenced in the schedule.  It rebuilds the list of
   * options in the #filmHighlightSelect element, removes duplicates
   * and unused films, and clears the selection if the highlighted
   * film is no longer used.  The placeholder option is preserved.
   */
  window.refreshFilmHighlightOptions = function() {
    try {
      const state = ShowtimeState.state;
      const select = document.getElementById('filmHighlightSelect');
      if (!select) return;
      // Remove all options except the first (placeholder)
      while (select.options.length > 1) {
        select.remove(1);
      }
      // Determine which film IDs are currently referenced on the Bookings page.
      // We only consider films attached to bookings (not primeRows, extraRows or manual shows)
      // so the highlight dropdown contains unique titles from the bookings tab.
      const usedIds = new Set();
      const st = state || {};
      const bookings = Array.isArray(st.bookings) ? st.bookings : [];
      bookings.forEach(item => {
        if (item && item.filmId) usedIds.add(String(item.filmId));
      });
      // Look up film objects for each used ID
      const allFilms = Array.isArray(st.films) ? st.films : [];
      const usedFilms = [];
      usedIds.forEach(fid => {
        const film = allFilms.find(f => f && String(f.id) === fid);
        if (film && film.title) usedFilms.push(film);
      });
      // Sort alphabetically by title and build option elements
      usedFilms.sort((a, b) => a.title.localeCompare(b.title));
      usedFilms.forEach(f => {
        const opt = document.createElement('option');
        opt.value = String(f.id);
        opt.textContent = f.title;
        select.appendChild(opt);
      });
      // If the current highlight film is no longer used, clear the selection
      if (state.highlightFilmId && !usedIds.has(state.highlightFilmId)) {
        state.highlightFilmId = '';
        ShowtimeState.save();
      }
      select.value = state.highlightFilmId || '';
    } catch (e) {
      // ignore errors to avoid breaking the page
    }
  };

  // After the document has loaded, refresh the film highlight list using
  // the latest schedule data.  Use a slight delay to allow page‑specific
  // render functions to populate tables before computing the used films.
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      if (typeof window.refreshFilmHighlightOptions === 'function') {
        window.refreshFilmHighlightOptions();
      }
    }, 200);
  });
  // Whenever the schedule state is updated, refresh the film highlight list
  // so that the dropdown reflects any newly added or removed bookings.
  window.addEventListener('showtimeStateUpdated', () => {
    try {
      if (typeof window.refreshFilmHighlightOptions === 'function') {
        window.refreshFilmHighlightOptions();
      }
    } catch (_) {}
  });

  /**
   * Generate an array of date strings (YYYY-MM-DD) representing the previous three
   * days and the next ten days relative to the provided date.  The given date
   * is excluded from the returned array.  This helper is used by the copy
   * schedule panel to provide common target dates for copying a schedule.
   * @param {string} dateStr A date string in YYYY-MM-DD format.
   * @returns {string[]} An array of nearby dates in ascending order.
   */
  function getNearbyDates(dateStr) {
    try {
      const base = new Date(dateStr);
      if (isNaN(base)) return [];
      const dates = [];
      for (let i = -3; i <= 10; i++) {
        if (i === 0) continue;
        const d = new Date(base);
        d.setDate(base.getDate() + i);
        const iso = d.toISOString().slice(0, 10);
        dates.push(iso);
      }
      return dates;
    } catch (e) {
      return [];
    }
  }

  /**
   * Show a floating panel to select multiple target dates for copying the current
   * schedule.  The panel is positioned near the triggering button.  When the
   * user clicks "Apply", the schedule from the selected date input is copied
   * to the checked dates.  A "Cancel" button closes the panel without
   * performing any action.
   *
   * @param {HTMLElement} btn The button element that triggers the panel.
   * @param {string} dateInputId The ID of the date input element whose value
   * will be used as the source date.  If the value is empty, an alert is
   * shown and the panel is not displayed.
   */
  window.openCopyPanel = function (btn, dateInputId) {
    // Remove any existing panel
    const existing = document.getElementById('copySchedulePanel');
    if (existing) {
      existing.remove();
      return;
    }
    const dateInput = document.getElementById(dateInputId);
    if (!dateInput || !dateInput.value) {
      alert('Please select a date first.');
      return;
    }
    // The date input displays values in MM/DD/YYYY format. Convert to ISO
    // before generating nearby dates and copying schedules. If the conversion
    // fails, fall back to the raw value so that getNearbyDates at least
    // attempts to interpret it. We keep the original mm/dd string for
    // display in the alert below.
    const mmddCurrent = dateInput.value;
    const isoCurrent = mmddToIso(mmddCurrent) || mmddCurrent;
    const targets = getNearbyDates(isoCurrent);
    if (targets.length === 0) {
      alert('Unable to generate target dates.');
      return;
    }
    // Create panel
    const panel = document.createElement('div');
    panel.id = 'copySchedulePanel';
    panel.className = 'absolute z-50 bg-white border border-gray-300 rounded-lg shadow p-3 text-sm';
    // Position panel below the button
    const rect = btn.getBoundingClientRect();
    // Use page offsets to handle scrolling
    panel.style.top = `${rect.bottom + window.scrollY + 4}px`;
    panel.style.left = `${rect.left + window.scrollX}px`;
    // Build list of checkboxes
    targets.forEach((iso) => {
      const row = document.createElement('label');
      row.className = 'flex items-center space-x-2 mb-1';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = iso;
      // Highlight dates that already contain schedule data by making
      // the label bold and coloured. Use closure-scoped state for lookup.
      let hasData = false;
      try {
        if (state && state.scheduleByDate && state.scheduleByDate[iso]) {
          const sched = state.scheduleByDate[iso];
          if (
            (sched.primeRows && sched.primeRows.length) ||
            (sched.extraRows && sched.extraRows.length) ||
            (sched.manualShows && sched.manualShows.length)
          ) {
            hasData = true;
          }
        }
      } catch (e) {
        // ignore lookup errors
      }
      row.appendChild(cb);
      const span = document.createElement('span');
      span.textContent = isoToMMDD(iso);
      if (hasData) {
        span.classList.add('font-bold', 'text-blue-700');
      }
      row.appendChild(span);
      panel.appendChild(row);
    });
    // Action buttons
    const btnRow = document.createElement('div');
    btnRow.className = 'mt-2 flex justify-end space-x-2';
    const applyBtn = document.createElement('button');
    applyBtn.textContent = 'Apply';
    applyBtn.className = 'px-3 py-1 bg-blue-700 text-white rounded hover:bg-blue-800';
    applyBtn.onclick = function () {
      const selected = Array.from(panel.querySelectorAll('input[type=checkbox]:checked')).map((c) => c.value);
      if (selected.length === 0) {
        alert('No target dates selected.');
        return;
      }
      // Copy from isoCurrent (the canonical ISO string) but show the mm/dd
      // version in the confirmation alert. The selected array already
      // contains ISO strings.
      ShowtimeState.copySchedule(isoCurrent, selected);
      alert(`Schedule for ${mmddCurrent} copied to: ${selected.map(isoToMMDD).join(', ')}.`);
      panel.remove();
    };
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'px-3 py-1 bg-gray-500 text-white rounded hover:bg-gray-600';
    cancelBtn.onclick = function () {
      panel.remove();
    };
    btnRow.appendChild(applyBtn);
    btnRow.appendChild(cancelBtn);
    panel.appendChild(btnRow);
    document.body.appendChild(panel);
  };

  // Inject global navigation styles to give the nav links a pill shape. In the
  // original app the navigation buttons were rounded and padded. We apply
  // similar styling here by targeting anchor tags with the nav-link class
  // inside a nav element. This runs once on initial load.
  (function injectNavPillStyles(){
    if (typeof document === 'undefined') return;
    if (document.getElementById('nav-pill-style')) return;
    try {
      const style = document.createElement('style');
      style.id = 'nav-pill-style';
      style.textContent = `
        nav a.nav-link {
          border-radius: 9999px;
          padding: 0.375rem 0.75rem;
          margin-right: 0.25rem;
          transition: background-color 0.15s;
        }
        nav a.nav-link:hover {
          background-color: rgba(255, 255, 255, 0.2);
        }
      `;
      document.head.appendChild(style);
    } catch (err) {}
  })();
})();