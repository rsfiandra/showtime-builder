// Schedule grid page logic
// Access global ShowtimeState via window
const ShowtimeState = window.ShowtimeState;

// Maintain the next grid cell to focus after a navigation-induced re-render.  When
// assignGridNavHandlers() detects a grid navigation key event (Arrow
// keys, Tab, Enter), it will set gridNavNextFocus to the row/column of
// the destination cell.  After renderAll() completes, we restore focus
// to the cell specified by this object.
let gridNavNextFocus = null;

document.addEventListener('DOMContentLoaded', () => {
  // Initialise multi‑date support so that schedule data is stored per date.
  ShowtimeState.initDateSupport();

  // === Condensed row style when end times are hidden ===
  (function injectScheduleCondenseStyles(){
    // Inject a style element once that defines how the schedule grid should
    // shrink when end times are hidden. The old selectors targeted a
    // combination of Tailwind classes (e.g. w-full table-fixed) that no
    // longer exist on the schedule table, so the rules never applied. We
    // instead scope the rules to the schedule grid via the #gridHead and
    // #gridBody IDs. When the body has the sg-condensed class, the
    // top/bottom padding of header and body cells is reduced, and
    // invisible placeholders used to align end‑time labels are removed so
    // that rows compress vertically.
    if (document.getElementById('schedule-condense-style')) return;
    const style = document.createElement('style');
    style.id = 'schedule-condense-style';
    style.textContent = `
      /* Reduce padding on schedule grid cells when condensed */
      body.sg-condensed #gridHead th,
      body.sg-condensed #gridBody td {
        padding-top: 2px !important;
        padding-bottom: 2px !important;
      }
      /* Remove invisible placeholders used for end‑time alignment when condensed */
      body.sg-condensed #gridBody div.invisible {
        display: none !important;
      }
    `;
    document.head.appendChild(style);
  })();
  function setScheduleCondensed(on){
    document.body.classList.toggle('sg-condensed', !!on);
  }

  const firstSelect = document.getElementById('firstShowSelect');
  const lastSelect = document.getElementById('lastShowSelect');
  const addRowBtn = document.getElementById('addRowBtn');
  const toggleEndBtn = document.getElementById('toggleEndBtn');
  const undoBtn = document.getElementById('undoBtn');
  // Sort rows button (may not exist on all pages)
  const sortRowsBtn = document.getElementById('sortRowsBtn');
  const clearBtn = document.getElementById('clearTimesGridBtn');
  const head = document.getElementById('gridHead');
  const body = document.getElementById('gridBody');

  // Date input for switching schedules
  const dateInput = document.getElementById('scheduleDateGrid');

  // Track which show is currently active in the schedule grid. When a user
  // focuses on a show’s dropdown, we store its id here and highlight the
  // cell. Instead of forcing a full re‑render on every focus, we
  // imperatively add/remove highlight classes on the affected cells. This
  // prevents the dropdown list from closing immediately when the user
  // clicks to open it. We also keep a mapping from show ids to their DOM
  // element so cross‑component highlights can apply without a full re‑render.
  let activeShowId = null;
  // Reference to the currently highlighted cell div in the grid. When a
  // different show becomes active we remove highlight classes from the
  // previous element and apply them to the new one.
  let activeCellDiv = null;
  // Mapping from show id to its corresponding cell div. This is rebuilt
  // whenever the grid re-renders. It enables quickly finding a cell by
  // id when the start‑time order panel notifies us of a new active show.
  let showIdToCellDiv = {};

  // Flag indicating that keyboard navigation is currently in progress. When
  // true, commit handlers should update state but defer re-rendering. This
  // allows arrow navigation to move to the next cell and then trigger a
  // single re-render after focus moves, avoiding multiple re-renders that
  // would break the navigation sequence.
  let gridNavInProgress = false;

  // Ensure first and last show times have sensible defaults. If the
  // persisted state does not include firstShowHM or lastShowHM (e.g. after
  // clearing times), set them to 07:00 and 23:00 respectively. This
  // prevents the schedule grid from rendering blank until the user
  // interacts with the selectors. We update state and save so that
  // subsequent loads use these defaults.
  (() => {
    const st = ShowtimeState.state;
    if (!st.firstShowHM) {
      st.firstShowHM = '07:00';
    }
    if (!st.lastShowHM) {
      st.lastShowHM = '23:00';
    }
    ShowtimeState.save();
  })();

  // Populate first/last show selects. This function can be called
  // independently to refresh the available times and select the saved
  // values. It ensures that state values appear in the dropdowns even
  // if they are not in the default increments.
  function populateTimeSelectors() {
    // Generate first show options: 5:00a to 7:00p (19:00) in 30‑min increments
    function genTimes(startHm, endHm) {
      const times = [];
      let t = ShowtimeState.dtFromHM(startHm);
      const end = ShowtimeState.dtFromHM(endHm);
      while (t <= end) {
        times.push(ShowtimeState.hmFromDate(t));
        t = new Date(t.getTime() + 30 * 60000);
      }
      return times;
    }
    const firstTimes = genTimes('05:00', '19:00');
    const lastTimes = ['20:00','20:30','21:00','21:30','22:00','22:30','23:00','23:30','00:00','00:30','01:00','01:30','02:00'];
    // Clear existing
    firstSelect.innerHTML = '';
    lastSelect.innerHTML = '';
    // Populate options and ensure the current state values appear in the list.
    // If the stored first/last value isn't in the predefined list (e.g., user chose
    // a time that falls between increments), add it to the list so the select
    // correctly reflects the saved value.  Avoid duplicates.
    const currentFirst = ShowtimeState.state.firstShowHM;
    const currentLast = ShowtimeState.state.lastShowHM;
    if (currentFirst && !firstTimes.includes(currentFirst)) {
      firstTimes.push(currentFirst);
      firstTimes.sort();
    }
    if (currentLast && !lastTimes.includes(currentLast)) {
      lastTimes.push(currentLast);
      // Sort last times chronologically across midnight. We map to minutes since 0:00.
      lastTimes.sort((a, b) => {
        const toMins = hm => {
          const [hh, mm] = hm.split(':').map(x => parseInt(x, 10));
          // treat times <5:00 as +24h to keep them at end of list
          const minutes = hh * 60 + mm;
          return minutes < 300 ? minutes + 24 * 60 : minutes;
        };
        return toMins(a) - toMins(b);
      });
    }
    firstTimes.forEach(hm => {
      const opt = document.createElement('option');
      opt.value = hm;
      opt.textContent = ShowtimeState.fmtHM(hm);
      firstSelect.appendChild(opt);
    });
    lastTimes.forEach(hm => {
      const opt = document.createElement('option');
      opt.value = hm;
      opt.textContent = ShowtimeState.fmtHM(hm);
      lastSelect.appendChild(opt);
    });
    // Set selected values from state, defaulting to the earliest options if none or invalid.
    // If the current value is blank or not found in the options, choose the first option.
    if (currentFirst && firstTimes.includes(currentFirst)) {
      firstSelect.value = currentFirst;
    } else {
      firstSelect.value = firstTimes[0];
      // Update state so that other components use the default if none previously saved.
      ShowtimeState.state.firstShowHM = firstTimes[0];
      ShowtimeState.save();
    }
    if (currentLast && lastTimes.includes(currentLast)) {
      lastSelect.value = currentLast;
    } else {
      lastSelect.value = lastTimes[0];
      ShowtimeState.state.lastShowHM = lastTimes[0];
      ShowtimeState.save();
    }
  }

  // Parse user-entered time strings in various shorthand formats. Accept
  // inputs such as "7", "705", "7a", "705a", "9:28", "9:28am", "7p", etc.
  // Returns a 24-hour HH:MM string or null if invalid. If a suffix
  // (a/p/am/pm) is provided, the hours are converted to 24-hour
  // format accordingly. Without a suffix, hours are interpreted in
  // 24-hour form; minutes default to 00 if missing. Invalid inputs
  // return null.
  function parseTimeString(str) {
    if (!str) return null;
    let s = String(str).trim().toLowerCase();
    if (!s) return null;
    let am = null;
    // Detect and strip am/pm suffixes
    if (s.endsWith('am')) {
      am = true;
      s = s.slice(0, -2);
    } else if (s.endsWith('pm')) {
      am = false;
      s = s.slice(0, -2);
    } else if (s.endsWith('a')) {
      am = true;
      s = s.slice(0, -1);
    } else if (s.endsWith('p')) {
      am = false;
      s = s.slice(0, -1);
    }
    // Remove all non-digits from the remaining string
    s = s.replace(/[^0-9]/g, '');
    if (!s) return null;
    let hours, minutes;
    if (s.length <= 2) {
      hours = parseInt(s, 10);
      minutes = 0;
    } else if (s.length === 3) {
      hours = parseInt(s.slice(0, 1), 10);
      minutes = parseInt(s.slice(1), 10);
    } else {
      minutes = parseInt(s.slice(-2), 10);
      hours = parseInt(s.slice(0, -2), 10);
    }
    if (Number.isNaN(hours) || Number.isNaN(minutes) || minutes < 0 || minutes > 59) {
      return null;
    }
    // Apply am/pm logic if suffix present. Interpret 12am as 00 and 12pm as 12.
    if (am !== null) {
      let hr = hours % 12;
      if (!am) hr += 12;
      hours = hr;
    }
    // Without suffix, interpret as 24‑hour value. Reject out-of-range hours.
    if (hours < 0 || hours > 23) return null;
    const hh = String(hours).padStart(2, '0');
    const mm = String(minutes).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  // Floor a Date to the nearest interval in minutes. Returns a new Date
  // instance aligned to the interval or null if the input is invalid.
  function floorDateToInterval(date, minutes) {
    if (!(date instanceof Date)) return null;
    const result = new Date(date);
    if (Number.isNaN(result.getTime())) return null;
    const totalMinutes = result.getHours() * 60 + result.getMinutes();
    const floored = Math.floor(totalMinutes / minutes) * minutes;
    const newHours = Math.floor(floored / 60);
    const newMinutes = floored % 60;
    result.setHours(newHours, newMinutes, 0, 0);
    return result;
  }

  // Determine the earliest show start across prime, extra and manual shows,
  // applying overrides. Returns a Date or null when no shows exist.
  function findEarliestShowStart() {
    let earliest = null;
    try {
      const allShows = typeof ShowtimeState.getAllShows === 'function' ? ShowtimeState.getAllShows() : [];
      allShows.forEach(show => {
        if (!show || !show.start) return;
        const dt = new Date(show.start);
        if (Number.isNaN(dt.getTime())) return;
        if (!earliest || dt < earliest) {
          earliest = dt;
        }
      });
    } catch (err) {
      /* ignore lookup errors */
    }
    return earliest;
  }

  // === Schedule downtime highlighting ===
  // Helper functions and constants used to identify and display
  // idle gaps (≥45m) and opportunities to schedule another film
  // before the first show of the day.  After the grid renders,
  // highlightScheduleDowntime() is invoked to overlay colored
  // bars onto the schedule and append badges to the row labels.

  // Minutes threshold for flagging a downtime gap between shows.
  const GAP_THRESHOLD_MIN = 45;
  // A larger threshold used to distinguish huge gaps (rendered in red).
  const GAP_HUGE_MIN = 90;
  // Minutes representing a typical film slot for late-first show detection.
  const FIT_SLOT_MIN = 105;

  // Normalize a date so that times before 5AM are considered to belong
  // to the next day. This mirrors logic used elsewhere in the app for
  // schedule ordering.
  function normalizeDateForGap(dt) {
    const n = new Date(dt);
    if (n.getHours() < 5) {
      n.setDate(n.getDate() + 1);
    }
    return n;
  }

  function highlightScheduleDowntime() {
    // Clear any existing overlays or badges from a prior render.
    document.querySelectorAll('.dt-overlay').forEach(el => el.remove());
    document.querySelectorAll('.late-first-badge').forEach(el => el.remove());
    // Ensure that timetable cells are set to relative positioning so that
    // absolutely positioned overlays align relative to each cell.
    const allTds = document.querySelectorAll('#gridBody td');
    allTds.forEach(td => {
      const pos = window.getComputedStyle(td).position;
      if (pos === 'static' || pos === '') {
        td.style.position = 'relative';
      }
    });
    // Build an array of column boundaries identical to those used in
    // renderHeader(). Each interval spans 2.5 hours (150 minutes). We
    // normalize the start/end times to support gaps crossing midnight.
    const firstHM = ShowtimeState.state.firstShowHM;
    const lastHM = ShowtimeState.state.lastShowHM;
    const intervalMinutes = 150;
    const first = ShowtimeState.dtFromHM(firstHM);
    const last = ShowtimeState.dtFromHM(lastHM);
    if (last.getHours() < 5) {
      last.setDate(last.getDate() + 1);
    }
    const colBounds = [];
    for (let t = new Date(first); t <= last; ) {
      const startNorm = normalizeDateForGap(t);
      const endNorm = new Date(startNorm.getTime() + intervalMinutes * 60000);
      colBounds.push({ start: startNorm, end: endNorm });
      t = new Date(t.getTime() + intervalMinutes * 60000);
    }
    // Group shows by their rowId.  Each show record holds its start and end
    // times. If a show lacks an end time (e.g. a manual show without a film
    // assigned), attempt to compute one from its film; otherwise fallback to
    // zero duration so that gaps around it are measured conservatively.
    const allShows = ShowtimeState.getAllShows();
    const showsByRow = {};
    allShows.forEach(rec => {
      const rid = rec.rowId;
      if (!rid) return;
      if (!showsByRow[rid]) {
        showsByRow[rid] = [];
      }
      let endDate = rec.end;
      if (!endDate) {
        const film = ShowtimeState.filmById(rec.filmId);
        if (film) {
          const totalMins = film.runtime + (film.trailer || 0) + (film.clean || 0);
          endDate = new Date(rec.start.getTime() + totalMins * 60000);
        } else {
          endDate = new Date(rec.start);
        }
      }
      showsByRow[rid].push({ start: rec.start, end: endDate });
    });
    // Process each row to compute and draw gaps and late-first slots.
    Object.keys(showsByRow).forEach(rid => {
      const list = showsByRow[rid].slice();
      // Sort shows by normalized start time
      list.sort((a, b) => normalizeDateForGap(a.start) - normalizeDateForGap(b.start));
      if (list.length === 0) return;
      // Identify the table row element for this rowId
      const rowTr = document.querySelector(`#gridBody tr[data-rowid='${rid}']`);
      if (!rowTr) return;
      const rowTds = rowTr.querySelectorAll('td');
      // Collect the timeline cells (skip Aud/Film/RT columns)
      const timeCells = [];
      rowTds.forEach((td, idx) => {
        if (idx >= 3) {
          timeCells.push(td);
        }
      });
      // Determine if the first show starts late enough to fit another film
      const windowStart = normalizeDateForGap(ShowtimeState.dtFromHM(firstHM));
      const firstShowStart = normalizeDateForGap(list[0].start);
      const diffFirstMin = (firstShowStart - windowStart) / 60000;
      if (diffFirstMin >= FIT_SLOT_MIN) {
        // Overlay a blue bar from the operating window start to the first show start
        addGapOverlay(timeCells, colBounds, list[0].start, ShowtimeState.dtFromHM(firstHM), diffFirstMin, 'late');
        // Append a small badge to the auditorium cell to indicate a fit slot
        const audTd = rowTds[0];
        if (audTd) {
          const badge = document.createElement('span');
          badge.className = 'late-first-badge ml-1 px-1 rounded text-[10px] text-white';
          badge.style.backgroundColor = '#2563eb';
          badge.textContent = 'slot';
          audTd.appendChild(badge);
        }
      }
      // Check gaps between consecutive shows
      for (let i = 0; i < list.length - 1; i++) {
        const currEnd = normalizeDateForGap(list[i].end);
        const nextStart = normalizeDateForGap(list[i + 1].start);
        const gapMin = (nextStart - currEnd) / 60000;
        if (gapMin >= GAP_THRESHOLD_MIN) {
          addGapOverlay(timeCells, colBounds, list[i + 1].start, list[i].end, gapMin, 'gap');
        }
      }
    });
    // Helper to overlay a gap across the schedule. Accepts raw start and end dates
    // (in original day context), determines their normalized overlap with each
    // column interval, and draws absolutely positioned bars across the cells.
    function addGapOverlay(timeCells, colBounds, gapEnd, gapStart, gapMin, type) {
      const startNorm = normalizeDateForGap(gapStart);
      const endNorm = normalizeDateForGap(gapEnd);
      let colour;
      if (type === 'late') {
        colour = 'rgba(59,130,246,0.4)'; // blue for late slots
      } else if (gapMin >= GAP_HUGE_MIN) {
        colour = 'rgba(220,38,38,0.4)'; // red for huge gaps
      } else {
        colour = 'rgba(234,179,8,0.4)'; // amber for standard gaps
      }
      for (let ci = 0; ci < colBounds.length; ci++) {
        const cb = colBounds[ci];
        const interStartMs = Math.max(cb.start.getTime(), startNorm.getTime());
        const interEndMs = Math.min(cb.end.getTime(), endNorm.getTime());
        if (interEndMs > interStartMs) {
          const totalMs = cb.end.getTime() - cb.start.getTime();
          const ratioStart = (interStartMs - cb.start.getTime()) / totalMs;
          const ratioWidth = (interEndMs - interStartMs) / totalMs;
          const td = timeCells[ci];
          if (!td) continue;
          const overlay = document.createElement('div');
          overlay.className = 'dt-overlay';
          overlay.style.position = 'absolute';
          overlay.style.top = '0';
          overlay.style.bottom = '0';
          overlay.style.left = (ratioStart * 100) + '%';
          overlay.style.width = (ratioWidth * 100) + '%';
          overlay.style.backgroundColor = colour;
          overlay.style.zIndex = '0';
          overlay.style.pointerEvents = 'none';
          td.appendChild(overlay);
        }
      }
    }
  }

  /**
   * Check the current URL for a `jump` parameter and, if present,
   * scroll to and highlight the matching auditorium row.  This helper
   * is invoked after the schedule grid has rendered.  The `jump`
   * value should correspond exactly to the auditorium name shown in
   * the first column of the grid.  Matching is case-sensitive and
   * whitespace trimmed.  Rows are briefly highlighted by applying
   * the `jump-highlight` class and then removing it after a timeout.
   */
  function checkJumpParam() {
    try {
      const url = new URL(window.location.href);
      let jump = url.searchParams.get('jump');
      // Also support hash-based syntax: #jump=<value>
      if (!jump && url.hash && url.hash.startsWith('#jump=')) {
        jump = url.hash.substring(6);
      }
      if (!jump) return;
      jump = decodeURIComponent(jump);
      const rows = document.querySelectorAll('#gridBody tr');
      for (const row of rows) {
        const audCell = row.querySelector('td');
        if (!audCell) continue;
        const cellText = audCell.textContent || '';
        if (cellText.trim() === jump) {
          row.classList.add('jump-highlight');
          // Use smooth scrolling to bring the row into view
          row.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // Remove the highlight after a brief period
          setTimeout(() => {
            row.classList.remove('jump-highlight');
          }, 1200);
          break;
        }
      }
    } catch (err) {
      // Silently ignore errors (e.g. invalid URL parsing)
    }
  }

  // Render the grid header based on current first/last show and 2.5‑hour intervals
  function renderHeader(earliestStart) {
    head.innerHTML = '';
    const tr = document.createElement('tr');
    // Static headers with consistent sizing
    // Define header widths.  Use narrower widths for the auditorium and runtime
    // columns to make the grid more compact.  The film column retains a
    // slightly wider width to accommodate longer titles.  Runtime is short
    // (e.g. 2:20) so we can safely use w-12 (3rem).  These widths tie
    // into theme.css where the max-width for each class is clamped.
    const headers = [
      { label: 'Aud', width: null },
      // Reduce film column from 8rem to 7rem to shrink overall table width
      { label: 'Film', width: 'w-28' },
      { label: 'RT', width: null }
    ];
    headers.forEach(({ label, width }, idx) => {
      const th = document.createElement('th');
      // Apply custom widths: for the Aud (idx 0) and RT (idx 2) columns, set a
      // fixed width of 5ch so they never grow beyond five characters.  If
      // width is specified (Film column), use the class from the config.
      if (idx === 0 || idx === 2) {
        // Double the schedule Aud/RT columns from 5ch to 10ch for improved
        // readability. This prevents the text from being cut off while
        // maintaining a compact grid.
        th.style.width = '10ch';
        th.style.maxWidth = '10ch';
      }
      th.className = `${width || ''} px-2 py-1 text-left`.trim();
      th.textContent = label;
      tr.appendChild(th);
    });
    // Compute interval starts. Each column spans 2.5 hours (150 minutes).
    let first = ShowtimeState.dtFromHM(ShowtimeState.state.firstShowHM);
    if (earliestStart instanceof Date && !Number.isNaN(earliestStart.getTime()) && earliestStart < first) {
      const aligned = floorDateToInterval(earliestStart, 30);
      if (aligned) {
        first = aligned;
      } else {
        first = new Date(earliestStart);
        first.setSeconds(0, 0);
      }
    }
    const last = ShowtimeState.dtFromHM(ShowtimeState.state.lastShowHM);
    if (last.getHours() < 5) last.setDate(last.getDate() + 1);
    const intervalMinutes = 150;
    const cols = [];
    for (let t = new Date(first); t <= last; ) {
      cols.push(new Date(t));
      t = new Date(t.getTime() + intervalMinutes * 60000);
    }
    // Time columns do not need labels; render blank headers. Use a
    // narrower width to prevent the grid from stretching excessively. A
    // Tailwind w-16 class sets width to 4rem (~64px) which accommodates an
    // HH:MMa/p label and our hidden caret. Adjust padding to keep spacing
    // consistent.
    cols.forEach(() => {
      const th = document.createElement('th');
      th.className = 'w-14 px-2 py-1 text-center whitespace-nowrap';
      th.textContent = '';
      tr.appendChild(th);
    });
    head.appendChild(tr);
    return cols;
  }

  // Helper: compute shows for a row. Uses base showtimes from
  // buildRowShowtimes plus manual shows and applies overrides. Hidden
  // shows are excluded. Result is sorted by start time.
  function getShowsForRow(row) {
    const state = ShowtimeState.state;
    // If this is a dynamic row (created by an auditorium override) then
    // collect the corresponding show(s) directly from getAllShows. Dynamic
    // rows are identified by rowIds starting with "OV-". They are not
    // present in primeRows or extraRows, so buildRowShowtimes would
    // return nothing. Instead, fetch all shows and filter by rowId.
    if (row && typeof row.rowId === 'string' && row.rowId.startsWith('OV-')) {
      const list = ShowtimeState.getAllShows().filter(r => r.rowId === row.rowId);
      // Filter hidden shows if necessary
      const filtered = list.filter(r => !state.hiddenShows || !state.hiddenShows[r.id]);
      // Already updated by getAllShows with overrides; just sort by start
      return filtered.sort((a, b) => a.start - b.start);
    }
    let shows = [];
    // Base showtimes from prime/extra rows
    try {
      shows = shows.concat(ShowtimeState.buildRowShowtimes(row));
    } catch (e) {
      // in case buildRowShowtimes fails, fallback to empty
    }
    // Manual shows for this row
    (state.manualShows || []).forEach(ms => {
      if (ms.rowId === row.rowId) shows.push({ ...ms });
    });
    // Apply overrides and filter hidden
    const result = [];
    shows.forEach(s => {
      // Skip hidden shows
      if (state.hiddenShows && state.hiddenShows[s.id]) return;
      const ov = state.overrides ? state.overrides[s.id] : undefined;
      // If this is a base (non-dynamic) row and this show has an override that
      // changes its auditorium or film, omit it from the base row. The
      // overridden show will be rendered in its own dynamic row.
      if (!(row && typeof row.rowId === 'string' && row.rowId.startsWith('OV-')) && ov && ((ov.audId && ov.audId !== s.audId) || (ov.filmId && ov.filmId !== s.filmId))) {
        return;
      }
      let rec = { ...s };
      if (ov) {
        // apply start override
        if (ov.start) {
          const newStart = new Date(ov.start);
          rec.start = newStart;
          // recompute end based on film runtime/trailer/clean
          const film = ShowtimeState.filmById(ov.filmId || rec.filmId);
          if (film) {
            // compute end using runtime, trailer and clean times
            const totalMins = film.runtime + (film.trailer || 0) + (film.clean || 0);
            rec.end = new Date(newStart.getTime() + totalMins * 60000);
            rec.runtime = film.runtime;
            rec.filmId = film.id;
            // Append the film format to the film title when building override records
            rec.filmTitle = film.title + (film.format ? ' ' + film.format : '');
          }
        }
        // apply auditorium override
        if (ov.audId) {
          rec.audId = ov.audId;
          const a = ShowtimeState.state.auds.find(a => a.id === ov.audId);
          rec.audName = a ? a.name : rec.audName;
        }
        // apply film override
        if (ov.filmId && ov.filmId !== rec.filmId) {
          const film = ShowtimeState.filmById(ov.filmId);
          if (film) {
            rec.filmId = film.id;
            rec.filmTitle = film.title + (film.format ? ' ' + film.format : '');
            rec.runtime = film.runtime;
            rec.trailer = film.trailer;
            rec.clean = film.clean;
            // adjust end if start override also exists
            const startTime = rec.start || s.start;
            const totalMins2 = film.runtime + (film.trailer || 0) + (film.clean || 0);
            rec.end = new Date(startTime.getTime() + totalMins2 * 60000);
          }
        }
      }
      result.push(rec);
    });
    result.sort((a, b) => a.start - b.start);
    return result;
  }

  // Render the grid body rows
  function renderRows(cols) {
    body.innerHTML = '';
    const state = ShowtimeState.state;
    // Compose rows: primeRows + extraRows. Copy to avoid modifying state
    // Build list of rows including prime, extra and dynamic rows. Dynamic
    // rows represent individual shows that have been moved to a different
    // auditorium via override. They are identified by rowIds starting
    // with "OV-" on shows returned from getAllShows(). Dynamic rows
    // contain only a single show and do not have editable row-level
    // auditorium or film selectors.
    const baseRows = (state.primeRows || []).concat(state.extraRows || []);
    const dynamicRowsMap = {};
    ShowtimeState.getAllShows().forEach(rec => {
      if (rec.rowId && typeof rec.rowId === 'string' && rec.rowId.startsWith('OV-')) {
        if (!dynamicRowsMap[rec.rowId]) {
          dynamicRowsMap[rec.rowId] = {
            rowId: rec.rowId,
            audId: rec.audId,
            filmId: rec.filmId,
            dynamic: true,
            showIds: []
          };
        }
        dynamicRowsMap[rec.rowId].showIds.push(rec.id);
      }
    });
    // Convert dynamic rows map to an array and sort by auditorium id then film id.
    let dynamicRows = Object.values(dynamicRowsMap);
    dynamicRows.sort((a, b) => {
      const aId = a.audId || Number.MAX_SAFE_INTEGER;
      const bId = b.audId || Number.MAX_SAFE_INTEGER;
      if (aId === bId) {
        // Sort by filmId as secondary key for consistency
        return String(a.filmId).localeCompare(String(b.filmId));
      }
      return aId - bId;
    });
    // Combine base and dynamic rows. Sort entire list by auditorium id so that
    // dynamic rows and base rows intermingle by their destination auditorium.
    let rows = baseRows.concat(dynamicRows);
    rows.sort((a, b) => {
      const aId = a.audId || Number.MAX_SAFE_INTEGER;
      const bId = b.audId || Number.MAX_SAFE_INTEGER;
      if (aId === bId) {
        // Within same auditorium, leave base rows before dynamic rows and
        // maintain their original relative order by comparing rowId strings.
        const aDyn = !!a.dynamic;
        const bDyn = !!b.dynamic;
        if (aDyn !== bDyn) return aDyn ? 1 : -1;
        return String(a.rowId).localeCompare(String(b.rowId));
      }
      return aId - bId;
    });
    // Rebuild mapping and clear active cell reference before generating rows.
    showIdToCellDiv = {};
    activeCellDiv = null;
    // Compute list of films currently used in bookings to populate film selectors.
    // We only include films that are referenced in bookings and have a title to avoid
    // showing old or blank film entries. Deduplicate by film id and sort by title.
    const usedFilmIds = new Set();
    (state.bookings || []).forEach(b => {
      if (b.filmId) {
        usedFilmIds.add(b.filmId);
      }
    });
    const usedFilms = ShowtimeState.state.films
      .filter(f => usedFilmIds.has(f.id) && f.title)
      .sort((a, b) => {
        const ta = (a.title || '').toLowerCase();
        const tb = (b.title || '').toLowerCase();
        return ta.localeCompare(tb);
      });
    // Attach a row index to each rendered row so we can assign
    // data-row attributes for keyboard navigation. Provide rowIndex
    // parameter to the callback.
    rows.forEach((row, rowIndex) => {
      const tr = document.createElement('tr');
      // Attach the rowId as a data attribute so highlight functions can map row IDs to DOM rows
      if (row && row.rowId) {
        tr.dataset.rowid = String(row.rowId);
      }
      // Alternate row shading to more closely mimic the original schedule grid
      tr.className = 'even:bg-gray-50 hover:bg-gray-50';
      // Tag this row with the filmId for highlighting if present.  Rows
      // representing dynamic or base schedule entries will be highlighted
      // when the selected film matches this id.
      if (row && row.filmId) {
        tr.dataset.filmid = String(row.filmId);
      }
      // If this is a dynamic row (created via auditorium override), render
      // editable selects just like a base row. Dynamic rows behave like
      // regular rows to allow editing auditorium, film and adding manual
      // shows. We parse the underlying showId from the rowId (OV-<id>)
      // so we can call updateShowAud and updateShowFilm on that show.
      if (row.dynamic) {
        // Underlying show ids for this dynamic row group. A dynamic row may
        // represent multiple shows that share the same destination auditorium
        // and film. Use row.showIds provided by dynamicRowsMap to update
        // all shows when editing row-level selects.
        const showIds = Array.isArray(row.showIds) ? row.showIds : [];
        // Auditorium select
        const tdAud = document.createElement('td');
        // Constrain auditorium column to 10 characters to prevent truncation
        tdAud.style.width = '10ch';
        tdAud.style.maxWidth = '10ch';
        // Mark this cell for keyboard navigation and identify its coordinates
        tdAud.dataset.row = rowIndex;
        tdAud.dataset.col = 0;
        // Remove the Tailwind vertical padding (py-1) from the auditorium cell so rows are tighter.
        tdAud.className = 'px-2 truncate navcell';
        const selAud = document.createElement('select');
        // Auditorium selector: rely on card-table styling for appearance.  The
        // enclosing cell has a fixed width so the select will fill the
        // available space without causing the column to grow.
        selAud.className = 'appearance-none text-xs w-full';
        const blankAud = document.createElement('option');
        blankAud.value = '';
        blankAud.textContent = '';
        selAud.appendChild(blankAud);
        ShowtimeState.state.auds.forEach(a => {
          const opt = document.createElement('option');
          opt.value = a.id;
          opt.textContent = a.name;
          selAud.appendChild(opt);
        });
        selAud.value = row.audId || '';
        selAud.addEventListener('change', () => {
          const val = selAud.value;
          showIds.forEach(id => {
            ShowtimeState.updateShowAud(id, val ? parseInt(val, 10) : null);
          });
          renderAll();
        });
        tdAud.appendChild(selAud);
        tr.appendChild(tdAud);
        // Film select
        const tdFilm = document.createElement('td');
        // Identify film cell for keyboard navigation
        tdFilm.dataset.row = rowIndex;
        tdFilm.dataset.col = 1;
        // Remove vertical padding from the film cell for a denser appearance.
        tdFilm.className = 'px-2 navcell';
        const selFilm = document.createElement('select');
        // Use a simple class; card-table styling will remove borders.  Use a
        // fixed width of 7rem via inline style for compactness.
        selFilm.className = 'appearance-none text-xs';
        selFilm.style.width = '7rem';
        const blankFilm = document.createElement('option');
        blankFilm.value = '';
        blankFilm.textContent = '';
        selFilm.appendChild(blankFilm);
        usedFilms.forEach(f => {
          const opt = document.createElement('option');
          opt.value = f.id;
          // Display the film format alongside the title if present
          opt.textContent = f.title + (f.format ? ' ' + f.format : '');
          selFilm.appendChild(opt);
        });
        selFilm.value = row.filmId || '';
        selFilm.addEventListener('change', () => {
          const val = selFilm.value;
          showIds.forEach(id => {
            ShowtimeState.updateShowFilm(id, val || null);
          });
          renderAll();
        });
        tdFilm.appendChild(selFilm);
        tr.appendChild(tdFilm);
        // Runtime cell
        const tdRt = document.createElement('td');
        // Constrain runtime column to 10 characters wide; this column is not interactive
        tdRt.style.width = '10ch';
        tdRt.style.maxWidth = '10ch';
        tdRt.className = 'px-2 py-1 truncate';
        const filmObj = ShowtimeState.filmById(row.filmId);
        tdRt.textContent = filmObj ? ShowtimeState.fmtDur(filmObj.runtime) : '0:00';
        tr.appendChild(tdRt);
      } else {
        // Auditorium select
        const tdAud = document.createElement('td');
        // Widen the auditorium column to 10 characters
        tdAud.style.width = '10ch';
        tdAud.style.maxWidth = '10ch';
        // Mark this cell for keyboard navigation and identify its coordinates
        tdAud.dataset.row = rowIndex;
        tdAud.dataset.col = 0;
        // Dynamic rows also need compact cells: omit vertical padding on the auditorium cell.
        tdAud.className = 'px-2 truncate navcell';
        const selAud = document.createElement('select');
        // Auditorium selector: rely on card-table styling for appearance
        selAud.className = 'appearance-none text-xs w-full';
        const blankAud = document.createElement('option');
        blankAud.value = '';
        blankAud.textContent = '';
        selAud.appendChild(blankAud);
        ShowtimeState.state.auds.forEach(a => {
          const opt = document.createElement('option');
          opt.value = a.id;
          opt.textContent = a.name;
          selAud.appendChild(opt);
        });
        selAud.value = row.audId || '';
        selAud.addEventListener('change', () => {
          const val = selAud.value;
          ShowtimeState.setRowField(row.rowId, 'audId', val ? parseInt(val, 10) : null);
          renderAll();
        });
        tdAud.appendChild(selAud);
        tr.appendChild(tdAud);
        // Film select
        const tdFilm = document.createElement('td');
        // Identify film cell for keyboard navigation
        tdFilm.dataset.row = rowIndex;
        tdFilm.dataset.col = 1;
        // Dynamic row film cell without vertical padding.
        tdFilm.className = 'px-2 navcell';
        const selFilm = document.createElement('select');
        // Film selector: rely on card-table styling; set a fixed width via inline style
        selFilm.className = 'appearance-none text-xs';
        selFilm.style.width = '7rem';
        const blankFilm = document.createElement('option');
        blankFilm.value = '';
        blankFilm.textContent = '';
        selFilm.appendChild(blankFilm);
        usedFilms.forEach(f => {
          const opt = document.createElement('option');
          opt.value = f.id;
          opt.textContent = f.title + (f.format ? ' ' + f.format : '');
          selFilm.appendChild(opt);
        });
        selFilm.value = row.filmId || '';
        selFilm.addEventListener('change', () => {
          ShowtimeState.setRowField(row.rowId, 'filmId', selFilm.value || null);
          renderAll();
        });
        tdFilm.appendChild(selFilm);
        tr.appendChild(tdFilm);
        // Runtime
        const tdRt = document.createElement('td');
        // Widen the runtime column to 10 characters
        tdRt.style.width = '10ch';
        tdRt.style.maxWidth = '10ch';
        tdRt.className = 'px-2 py-1 truncate';
        const film = ShowtimeState.filmById(row.filmId);
        tdRt.textContent = film ? ShowtimeState.fmtDur(film.runtime) : '0:00';
        tr.appendChild(tdRt);
      }
      // Gather shows for this row: base + manual + overrides
      const showsForRow = getShowsForRow(row);
      // Determine overlaps (showtimes that overlap with the previous cycle, including clean time).
      // We compute the cycle minutes for each show on the fly. If a show has no film or
      // a zero-duration cycle (runtime+trailer+clean <= 0), we skip overlap checks for it.
      const overlapIds = new Set();
      for (let i = 1; i < showsForRow.length; i++) {
        const prev = showsForRow[i - 1];
        const curr = showsForRow[i];
        // Determine cycle minutes for the previous show. Use the stored cycle
        // on the show if available; otherwise compute from its film. A zero or
        // undefined cycle indicates no meaningful runtime, so we ignore overlap.
        let cycleMins = prev.cycle;
        if (cycleMins === undefined || cycleMins === null) {
          const f = ShowtimeState.filmById(prev.filmId);
          cycleMins = f ? ShowtimeState.cycleMinutes(f) : 0;
        }
        if (cycleMins > 0) {
          const prevEndDate = new Date(prev.start.getTime() + cycleMins * 60000);
          if (curr.start < prevEndDate) {
            overlapIds.add(prev.id);
            overlapIds.add(curr.id);
          }
        }
      }
      // Build cells for each interval
      // Use the same interval length as renderHeader (2.5 hours = 150 minutes)
      const intervalMinutes = 150;
      cols.forEach((boundary, idx) => {
        const end = new Date(boundary.getTime() + intervalMinutes * 60000);
        // choose the earliest show in this interval
        const cellShow = showsForRow.find(s => s.start >= boundary && s.start < end);
        const td = document.createElement('td');
        // Assign navigation metadata: row index and column index (time columns start at 2)
        td.dataset.row = rowIndex;
        td.dataset.col = String(2 + idx);
        td.className = 'navcell';
        // We'll style individual cells via the inner div rather than tailwind classes
        if (cellShow) {
        // Show cell: render an input for editing the show start time.
          const div = document.createElement('div');
          // Remove the default border/background so it blends with the table grid.
          // The highlight styling will be applied conditionally when this show is active.
          let cellClass = '';
          // Apply highlight if this show is currently active
          if (cellShow.id === activeShowId) {
            cellClass = 'ring-2 ring-purple-400 border-2 border-purple-500 bg-purple-50';
            activeCellDiv = div;
          }
          div.className = cellClass;
          // Stack the start time and end time vertically.  Using a column
          // layout provides each element its own line, preventing the end
          // time from overlapping the start time.  The fixed width
          // maintains alignment with other columns.
          div.style.width = '3.5rem';
          div.style.display = 'flex';
          div.style.flexDirection = 'column';
          div.style.alignItems = 'flex-start';
          div.style.justifyContent = 'flex-start';
          // Remove padding so the height is governed by the children.
          div.style.padding = '0';
          // Reduce the gap between lines to zero; the CSS line-height will
          // control spacing between the input and end-time label.
          div.style.gap = '0';
          const inp = document.createElement('input');
          inp.type = 'text';
          // Use a medium font size so that times are more legible, matching
          // the Prime schedule.  Remove the tiny text-xs class and instead
          // apply text-sm (0.875rem) so the dense-schedule CSS can govern
          // overall row height.  Avoid setting inline height or padding here
          // so that table rows can shrink consistently.
          inp.className = 'text-sm w-full';
          // Override the inline font size to 0.875rem (14px) to ensure the
          // input text remains legible.  Previous versions used 0.65rem,
          // which was too small.  This matches the font size used in
          // Prime schedule tables.
          inp.style.fontSize = '0.875rem';
          // Center-align the start time text so that it matches the end time alignment.
          // Without this, inputs default to center alignment on some platforms,
          // which can cause the end time label (left-aligned) to look misaligned.
          inp.style.textAlign = 'center';
          // Do not set line-height, height or padding here; allow CSS to determine
          // the appropriate values for compact rows.
          // Pre-fill with the current start time in 12-hour format
          inp.value = ShowtimeState.to12(cellShow.start);
          // When focused, mark this show as active
          function activate() {
            if (!cellShow || !cellShow.id) return;
            const id = cellShow.id;
            // Remove highlight from previously active cell
            if (activeCellDiv && activeCellDiv !== div) {
              activeCellDiv.classList.remove('ring-2','ring-purple-400','border-2','border-purple-500','bg-purple-50');
            }
            // Apply highlight to current cell if not already
            if (div && div !== activeCellDiv) {
              div.classList.add('ring-2','ring-purple-400','border-2','border-purple-500','bg-purple-50');
            }
            activeCellDiv = div;
            activeShowId = id;
            // Notify other components of the active show change
            try {
              const evt = new CustomEvent('activeShowChange', { detail: { showId: id } });
              window.dispatchEvent(evt);
            } catch {}
          }
          inp.addEventListener('focus', activate);
          // Commit edits on change or blur. Parse the value; if invalid,
          // revert to the existing time; otherwise update the show and re-render.
          function commit() {
            const hm = parseTimeString(inp.value);
            if (!hm) {
              // revert
              inp.value = ShowtimeState.to12(cellShow.start);
              return;
            }
            // Only update if changed
            if (hm !== ShowtimeState.hmFromDate(cellShow.start)) {
              ShowtimeState.updateShowStart(cellShow.id, hm);
              // When navigating with arrow keys, defer re-rendering until after the
              // navigation completes. The nav handler will call renderAll().
              if (!gridNavInProgress) {
                renderAll();
              }
            }
          }
          inp.addEventListener('change', commit);
          inp.addEventListener('blur', commit);
          div.appendChild(inp);
          // Record mapping from show id to cell div for cross‑highlight
          showIdToCellDiv[cellShow.id] = div;
          // End time label or invisible placeholder.
          if (ShowtimeState.state.showEndTimes) {
            const lab = document.createElement('div');
            // Use a small font on a single line.  When overlaps occur, add a yellow
            // background to highlight conflict.
            let labClass = 'text-[10px] text-gray-500';
            if (overlapIds.has(cellShow.id)) {
              labClass += ' bg-yellow-100 rounded px-0.5';
            }
            lab.className = labClass;
            lab.textContent = ShowtimeState.to12(cellShow.end);
            // Center-align the end time label to match the start time input.
            lab.style.textAlign = 'center';
            // Expand the label to fill the full width of the cell so centering works
            lab.style.width = '100%';
            div.appendChild(lab);
          } else {
            const lab = document.createElement('div');
            // Invisible placeholder: keep as small as possible; no margin.
            lab.className = 'text-[10px] invisible';
            lab.textContent = 'x';
            // Ensure placeholder spans the width for proper alignment when end times are shown later
            lab.style.width = '100%';
            div.appendChild(lab);
          }
          td.appendChild(div);
        } else {
          // Empty cell: render a text input for manual show creation
          const div = document.createElement('div');
          // Stack the start time input and placeholder vertically.  A column
          // layout reserves a separate line for the end-time placeholder,
          // mirroring the layout of populated cells.
          div.className = '';
          div.style.width = '3.5rem';
          div.style.display = 'flex';
          div.style.flexDirection = 'column';
          div.style.alignItems = 'flex-start';
          div.style.justifyContent = 'flex-start';
          div.style.gap = '0';
          div.style.padding = '0';
          const inp = document.createElement('input');
          inp.type = 'text';
          inp.className = 'text-sm w-full';
          // Use a medium font size (0.875rem) instead of 0.65rem for better
          // readability.  This matches the Prime schedule table font size.
          inp.style.fontSize = '0.875rem';
          // Center-align the text in manual input for consistent alignment
          inp.style.textAlign = 'center';
          // Do not set inline line-height, height or padding for compact rows.
          inp.value = '';
          // Commit on change or blur. Parse the input; if valid, add a manual show.
          function commit() {
            const hm = parseTimeString(inp.value);
            if (hm) {
              ShowtimeState.addManualShow(row.rowId, hm);
              // Clear the input so subsequent synthetic blur/change events do not
              // reparse the same value and create duplicate manual shows.
              inp.value = '';
              // Defer re-render if a keyboard navigation is in progress; nav handler will re-render.
              if (!gridNavInProgress) {
                renderAll();
              }
            } else {
              inp.value = '';
            }
          }
          inp.addEventListener('change', commit);
          inp.addEventListener('blur', commit);
          div.appendChild(inp);
          // placeholder for end time (invisible). Keep it inline and small
          const lab = document.createElement('div');
          lab.className = 'text-[10px] invisible';
          lab.textContent = 'x';
          // Ensure placeholder spans the width for proper alignment when end times are shown later
          lab.style.width = '100%';
          div.appendChild(lab);
          td.appendChild(div);
        }
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
  }

  // Render both header and rows
  function renderAll() {
    // Ensure prime rows exist if none have been created yet.  If the
    // application has bookings but primeRows is empty (e.g. user never
    // visited the Prime page), derive primeRows from bookings with
    // assigned films. Use booking slot and assign empty audId/primeHM.
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
    populateTimeSelectors();
    const earliestShowStart = findEarliestShowStart();
    const cols = renderHeader(earliestShowStart);
    renderRows(cols);
    // Condense rows when end times are hidden
    setScheduleCondensed(!ShowtimeState.state.showEndTimes);
    // Update toggle button text
    toggleEndBtn.textContent = ShowtimeState.state.showEndTimes ? 'Hide End Times' : 'Show End Times';

    // Refresh the film highlight options (if new films were added) and
    // apply the highlight to rows after re-rendering.  The functions
    // live on window and will gracefully no-op if undefined.
    if (typeof window.refreshFilmHighlightOptions === 'function') {
      window.refreshFilmHighlightOptions();
    }
    if (typeof window.applyFilmHighlight === 'function') {
      window.applyFilmHighlight();
    }

    // Reattach keyboard navigation handlers after each render.  This will
    // collect all navigable cells (auditorium, film and time inputs) and
    // wire up Arrow/Tab/Enter key events to move focus across the grid.
    assignGridNavHandlers();

    // If a navigation handler recorded a cell to focus after re-render,
    // restore focus to that cell in the next microtask.  Without this
    // mechanism, the re-render would blow away the focused element and
    // keyboard navigation would stall.
    if (gridNavNextFocus) {
      const { row: fRow, col: fCol } = gridNavNextFocus;
      // Reset the pointer immediately so subsequent renders don't reuse it.
      gridNavNextFocus = null;
      setTimeout(() => {
        try {
          const cell = document.querySelector(`#gridBody td[data-row='${fRow}'][data-col='${fCol}']`);
          if (cell) {
            const ctrl = cell.querySelector('input, select');
            if (ctrl) {
              ctrl.focus();
              if (typeof ctrl.select === 'function') {
                ctrl.select();
              }
            }
          }
        } catch (err) {
          // Ignore focus errors
        }
      }, 0);
    }

    // After re-rendering and restoring focus, optionally decorate the schedule grid.
    // We intentionally skip downtime highlight overlays here to keep the
    // schedule view uncluttered.  Instead, flagged issues are shown on the
    // dashboard page.  If a "jump" parameter is present in the URL, scroll
    // to and briefly highlight the corresponding auditorium row.
    if (typeof checkJumpParam === 'function') {
      checkJumpParam();
    }

    // Note: we do not dispatch any synthetic storage events here. Instead,
    // app.js dispatches a custom "showtimeStateUpdated" event after
    // every state save, and order-panel.js listens for that event to
    // re-render when the schedule changes within the same tab. This
    // avoids unnecessary overhead while keeping the start-time order
    // panel in sync with edits made on the schedule grid.
  }

  // Event handlers
  firstSelect.addEventListener('change', () => {
    ShowtimeState.state.firstShowHM = firstSelect.value;
    ShowtimeState.save();
    renderAll();
  });
  lastSelect.addEventListener('change', () => {
    ShowtimeState.state.lastShowHM = lastSelect.value;
    ShowtimeState.save();
    renderAll();
  });
  addRowBtn.addEventListener('click', () => {
    ShowtimeState.addExtraRow();
    renderAll();
  });
  toggleEndBtn.addEventListener('click', () => {
    ShowtimeState.toggleEndTimes();
    renderAll();
  });
  undoBtn.addEventListener('click', () => {
    ShowtimeState.undo();
    renderAll();
  });

  // Sort prime and extra rows by auditorium id. Rows without an auditorium
  // assignment (null or empty) are placed at the end. Persist the new
  // order, save state and re-render. This allows quickly organizing
  // rows into numerical auditorium order, similar to the original app.
  if (sortRowsBtn) {
    sortRowsBtn.addEventListener('click', () => {
      const state = ShowtimeState.state;
      const sorter = (a, b) => {
        // undefined or null audIds go to the end
        const aId = a.audId || Number.MAX_SAFE_INTEGER;
        const bId = b.audId || Number.MAX_SAFE_INTEGER;
        // If equal audId, preserve original order by comparing rowId strings
        if (aId === bId) {
          return String(a.rowId).localeCompare(String(b.rowId));
        }
        return aId - bId;
      };
      if (Array.isArray(state.primeRows)) {
        state.primeRows.sort(sorter);
      }
      if (Array.isArray(state.extraRows)) {
        state.extraRows.sort(sorter);
      }
      ShowtimeState.save();
      renderAll();
    });
  }

  // Clear times button: resets all prime times, manual shows and overrides. Use the same behaviour
  // as the Clear Times button on the Prime page. Extra rows remain but prime times and show
  // overrides are cleared. After clearing, the grid re-renders and other pages are notified via
  // the storage event.
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      // Reset all showtimes (prime, overrides, manual) via centralized helper
      ShowtimeState.clearAllTimes();
      // Re-render the grid to reflect the cleared schedule
      renderAll();
      // Dispatch storage event so prime and order views update
      try {
        const evt = new Event('storage');
        window.dispatchEvent(evt);
      } catch {}
    });
  }

  // Listen for external changes (e.g. other tabs)
  window.addEventListener('storage', () => renderAll());

  // Listen for cross‑component show highlight changes. When another
  // component (like the start‑time order panel) sets a show as active,
  // update our highlight without forcing a full re‑render. If we do
  // not know about the cell yet (for instance the grid hasn't been
  // rendered since the show was created), fall back to re‑rendering to
  // apply the highlight.
  window.addEventListener('activeShowChange', (e) => {
    const id = e && e.detail && e.detail.showId;
    if (!id) return;
    if (activeShowId === id) return;
    // Remove highlight from current cell
    if (activeCellDiv) {
      activeCellDiv.classList.remove('ring-2','ring-purple-400','border-2','border-purple-500','bg-purple-50');
      activeCellDiv = null;
    }
    activeShowId = id;
    // Highlight the new cell if we know it
    const div = showIdToCellDiv[id];
    if (div) {
      div.classList.add('ring-2','ring-purple-400','border-2','border-purple-500','bg-purple-50');
      activeCellDiv = div;
    } else {
      // otherwise trigger a full re‑render to rebuild the mapping
      renderAll();
    }
  });

  /**
   * Attach keyboard navigation to the schedule grid. This function
   * assigns a keydown handler to every select element within a cell
   * marked with the `navcell` class and data-row/data-col attributes.
   * ArrowLeft/ArrowRight and Tab/Shift+Tab move horizontally with
   * wrap-around across rows; ArrowUp/ArrowDown and Enter move vertically
   * with wrap-around. Before moving, the current select dispatches
   * change and blur events to commit any edits. Navigation skips
   * non-existent cells (e.g. runtime columns) and wraps when reaching
   * the edges of the grid.
   */
  function assignGridNavHandlers() {
    const navCells = document.querySelectorAll('#gridBody td.navcell');
    if (!navCells || navCells.length === 0) return;
    const rowsMap = {};
    let maxRow = -1;
    let maxCol = -1;
    // Build a map of row/col to the focusable control (input or select)
    navCells.forEach(td => {
      const r = parseInt(td.dataset.row, 10);
      const c = parseInt(td.dataset.col, 10);
      if (Number.isNaN(r) || Number.isNaN(c)) return;
      const ctrl = td.querySelector('input, select');
      if (!ctrl) return;
      if (!rowsMap[r]) rowsMap[r] = {};
      rowsMap[r][c] = ctrl;
      if (r > maxRow) maxRow = r;
      if (c > maxCol) maxCol = c;
    });
    if (maxRow < 0 || maxCol < 0) return;
    navCells.forEach(td => {
      const ctrl = td.querySelector('input, select');
      if (!ctrl) return;
      ctrl.onkeydown = function (e) {
        const key = e.key;
        const cell = this.closest('td');
        const row = cell ? parseInt(cell.dataset.row, 10) : NaN;
        const col = cell ? parseInt(cell.dataset.col, 10) : NaN;
        if (Number.isNaN(row) || Number.isNaN(col)) return;
        let newRow = row;
        let newCol = col;
        let handled = false;
        if (key === 'ArrowLeft' || (key === 'Tab' && e.shiftKey)) {
          newCol = col - 1;
          if (newCol < 0) {
            newCol = maxCol;
            newRow = row - 1;
            if (newRow < 0) newRow = maxRow;
          }
          handled = true;
        } else if (key === 'ArrowRight' || (key === 'Tab' && !e.shiftKey)) {
          newCol = col + 1;
          if (newCol > maxCol) {
            newCol = 0;
            newRow = row + 1;
            if (newRow > maxRow) newRow = 0;
          }
          handled = true;
        } else if (key === 'ArrowUp') {
          newRow = row - 1;
          if (newRow < 0) newRow = maxRow;
          handled = true;
        } else if (key === 'ArrowDown' || key === 'Enter') {
          newRow = row + 1;
          if (newRow > maxRow) newRow = 0;
          handled = true;
        }
        if (handled) {
          // Mark that grid navigation is in progress. Commit handlers should
          // update state without triggering render until we finish moving.
          gridNavInProgress = true;
          // Prevent the key event from inserting arrow characters into the input
          e.preventDefault();
          // Stop propagation to other listeners (including default caret movement)
          e.stopPropagation();
          // Also stop immediate propagation so no other handlers on this element run
          if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
          try {
            // Dispatch change and blur events to commit edits on the current control
            this.dispatchEvent(new Event('change', { bubbles: true }));
            this.dispatchEvent(new Event('blur', { bubbles: true }));
          } catch {}
          let attempts = 0;
          const maxAttempts = (maxRow + 1) * (maxCol + 1);
          let target = null;
          let r = newRow;
          let c = newCol;
          while (attempts < maxAttempts) {
            if (rowsMap[r] && rowsMap[r][c]) {
              target = rowsMap[r][c];
              break;
            }
            c++;
            if (c > maxCol) {
              c = 0;
              r++;
              if (r > maxRow) r = 0;
            }
            attempts++;
          }
          if (target) {
            // Record the row/col of the destination cell so we can restore
            // focus after the grid is redrawn.  Use the r/c values from
            // our search loop, which correspond to the dataset of the target.
            gridNavNextFocus = { row: r, col: c };
            target.focus();
            if (typeof target.select === 'function') {
              try { target.select(); } catch {}
            }
          }
          // End navigation.  Re-render the grid to reflect committed edits.
          gridNavInProgress = false;
          renderAll();
        }
      };
    });
  }

  // Initial render
  // Populate selectors immediately so the grid can draw on first load.
  populateTimeSelectors();
  // Render once now and then again in a microtask. This two‑step render
  // ensures that if the state’s first/last show values were empty or
  // missing, the defaults inserted by populateTimeSelectors() are used
  // for the subsequent render. Without this, the grid may not draw
  // until the user interacts with the selectors.
  renderAll();
  // Use setTimeout with zero delay to queue a second render after the
  // select values and state updates have propagated. This helps avoid
  // a blank grid on initial load when firstShowHM/lastShowHM were unset.
  setTimeout(() => {
    renderAll();
  }, 0);

  // If a date input exists, set its initial value (MM/DD/YYYY) and wire up listeners.
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
      // Normalize display
      dateInput.value = ShowtimeState.isoToMMDD(iso);
      ShowtimeState.setDate(iso);
      // After switching date, re-render the grid
      renderAll();
    });
    // Respond to date changes triggered elsewhere
    window.addEventListener('showtimeDateChanged', () => {
      const current = ShowtimeState.getCurrentDate();
      if (current) {
        dateInput.value = ShowtimeState.isoToMMDD(current);
      }
      renderAll();
    });
  }

  // Wire up previous/next day buttons for the schedule grid.  These
  // buttons flank the date input in the header and allow the user to
  // navigate one day backward or forward at a time.  When clicked,
  // they update the current date via ShowtimeState, update the input
  // display and trigger a re‑render of the grid.
  const prevGridBtn = document.getElementById('prevDateGridBtn');
  const nextGridBtn = document.getElementById('nextDateGridBtn');
  function shiftDateGrid(delta) {
    const curIso = ShowtimeState.getCurrentDate();
    // If current date is not set, fall back to today
    let d = curIso ? new Date(curIso) : new Date();
    if (isNaN(d)) d = new Date();
    d.setDate(d.getDate() + delta);
    const iso = d.toISOString().slice(0, 10);
    ShowtimeState.setDate(iso);
    if (dateInput) dateInput.value = ShowtimeState.isoToMMDD(iso);
    renderAll();
  }
  if (prevGridBtn) prevGridBtn.addEventListener('click', () => shiftDateGrid(-1));
  if (nextGridBtn) nextGridBtn.addEventListener('click', () => shiftDateGrid(1));
});