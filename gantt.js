// Gantt timeline view for the Showtime Builder application.
// This script renders a horizontal timeline of shows grouped by
// auditorium and supports dragging to adjust start times or move
// shows between auditoriums. It listens for global state changes
// and active show highlights to keep in sync with the schedule grid
// and order panel. The timeline spans from the configured first show
// time to the last show time and uses the same normalization rules
// (times before 5:00a belong to the next day).

(function(){
  const ShowtimeState = window.ShowtimeState;
  if (!ShowtimeState) return;
  // Normalize a date such that times before 5:00a are treated as
  // belonging to the next day. This matches the behaviour in the
  // order panel and schedule grid for comparing show times across
  // midnight. Returns a new Date instance.
  function normalizeDate(dt) {
    const d = new Date(dt);
    if (d.getHours() < 5) {
      d.setDate(d.getDate() + 1);
    }
    return d;
  }
  // State tracking for active show and dragging.  activeShowId
  // represents the show currently selected across components.  dragState
  // stores information about the show being dragged.
  let activeShowId = null;
  let dragState = null;
  // Mappings to quickly look up DOM elements and data by show id
  let showIdToBar = {};
  let showIdToRec = {};
  let rowEls = [];
  let rowIndexOfShow = {};

  // Current film being dragged from the tray. When a film chip is dragged, this
  // variable stores the filmId so that drop handlers can create a manual show.
  let currentDragFilmId = null;

  // Film selected for click‑to‑insert mode.  When the user clicks a film
  // chip rather than dragging it, this variable stores the filmId.  While
  // clickInsertFilmId is set, moving over the timeline will show a ghost
  // preview and clicking on a timeline row will insert a show at that
  // position.  Selecting a film again will cancel insert mode.  This mode
  // exists alongside HTML5 drag‑and‑drop to make adding shows easier on
  // touch devices or when dragging feels janky.
  let clickInsertFilmId = null;

  // Render the film selection tray. Films are pulled from the bookings list
  // and deduplicated by filmId. Blank rows or bookings without a valid film
  // title are ignored. Each film is presented as a draggable chip showing the
  // title and total cycle length (runtime + trailer + clean) in minutes. The
  // tray is rebuilt on every render so it reflects the latest booking data.
  function renderFilmTray() {
    const tray = document.getElementById('filmTray');
    if (!tray) return;
    // Clear existing chips
    tray.innerHTML = '';
    const state = ShowtimeState.state;
    const filmIds = new Set();
    // Gather unique filmIds from bookings that have a valid film attached
    (state.bookings || []).forEach(b => {
      if (b && b.filmId) filmIds.add(b.filmId);
    });
    // Build chips for each film. Sort alphabetically by title for consistency.
    const films = Array.from(filmIds).map(fid => ShowtimeState.filmById(fid)).filter(f => f && f.title);
    films.sort((a,b) => a.title.localeCompare(b.title));
    // Compute timeline duration for sizing film chips relative to the Gantt bars.
    // The timeline spans from 9:00 a.m. to midnight by default, but can extend
    // earlier or later based on the configured first and last show times. Use
    // the same computation as the main render() function to derive the
    // timeline length. This ensures that film chips are sized in proportion
    // to the visible timeline used by the Gantt bars.
    const cfgFirst = normalizeDate(ShowtimeState.dtFromHM(state.firstShowHM));
    const cfgLast = normalizeDate(ShowtimeState.dtFromHM(state.lastShowHM));
    const baselineStart = normalizeDate(ShowtimeState.dtFromHM('09:00'));
    const baselineEnd = normalizeDate(ShowtimeState.dtFromHM('00:00'));
    const lastDate = cfgLast > baselineEnd ? cfgLast : baselineEnd;
    const timelineStart = new Date(baselineStart);
    timelineStart.setSeconds(0);
    timelineStart.setMilliseconds(0);
    const timelineMins = Math.max(1, (lastDate - timelineStart) / 60000);

    films.forEach(f => {
      const chip = document.createElement('button');
      // Compute film length in minutes using runtime + trailer (excluding clean).
      const filmMinutes = (f.runtime || 0) + (f.trailer || 0);
      const widthPercent = (filmMinutes / timelineMins) * 100;
      // Apply pill styling: grey background, rounded full corners, consistent padding,
      // truncated title and fixed height.  Use flex properties so the chip
      // occupies a proportional width relative to the timeline.
      chip.className = 'flex-none border border-gray-300 bg-gray-100 text-gray-700 rounded-full px-2 py-1 text-xs cursor-grab hover:bg-gray-200 overflow-hidden whitespace-nowrap';
      // Set the flex basis based on the film duration. Ensure chips are not
      // extremely small or excessively wide by constraining the percentage.
      const minPct = 3; // minimum percent width
      const maxPct = 30; // maximum percent width
      const pct = Math.max(minPct, Math.min(maxPct, widthPercent));
      chip.style.flexBasis = pct.toFixed(2) + '%';
      chip.style.flexShrink = '0';
      chip.style.flexGrow = '0';
      // Truncate the film title to a maximum of 13 characters and append an ellipsis
      const title = f.title || '';
      const maxChars = 13;
      let shortTitle = title;
      if (title.length > maxChars) {
        shortTitle = title.slice(0, maxChars - 1) + '…';
      }
      chip.textContent = shortTitle;
      // Tooltip shows full film name, optional format and runtime+trailer duration
      const filmDurationMin = (f.runtime || 0) + (f.trailer || 0);
      chip.title = `${f.format ? f.format + ': ' : ''}${f.title} • ${ShowtimeState.fmtDur(filmDurationMin)}`;
      chip.draggable = true;
      // Highlight the chip if it is currently selected for click insertion
      if (clickInsertFilmId === f.id) {
        chip.classList.add('ring-2','ring-offset-1','ring-blue-400');
      }
      // Drag start: begin inserting new show; cancel click insert mode
      chip.addEventListener('dragstart', (e) => {
        currentDragFilmId = f.id;
        clickInsertFilmId = null;
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/plain', f.id);
      });
      // Drag end: clear current drag and re-render to update highlights
      chip.addEventListener('dragend', () => {
        currentDragFilmId = null;
        renderFilmTray();
      });
      // Click handler: toggle click‑to‑insert mode
      chip.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (clickInsertFilmId === f.id) {
          clickInsertFilmId = null;
        } else {
          clickInsertFilmId = f.id;
        }
        renderFilmTray();
      });
      tray.appendChild(chip);
    });
  }

  // Store last computed timeline start and duration so that drag
  // calculations are consistent with the render window.  When
  // dragging, we need to compute offsets relative to the same
  // baseline start used in render(), not necessarily the configured
  // first show time.  Without this, a mismatch between the
  // configured first show (e.g. 9:30a) and the baseline start (9:00a)
  // causes bars to drift relative to the hour markers.  These
  // variables are updated in render() and read in the drag handlers.
  let lastFirstDate = null;
  let lastTimelineMins = null;

  // Build and render the entire timeline.  Recreates rows and bars
  // from scratch based on the current state.  Called whenever state
  // changes or the active show changes.
  function render() {
    // Ensure state is loaded
    ShowtimeState.load();
    // Rebuild the film selection tray on every render so it reflects
    // current bookings. This must run before any early return from
    // render() to ensure the tray is cleared when there are no
    // bookings.
    try {
      renderFilmTray();
    } catch {}
    const state = ShowtimeState.state;
    // Compute start and end of the timeline window
    // Determine the baseline visible window.  We always want to show at
    // least 9:00am through 1:00am (the next day).  If the configured
    // first show time is earlier than 9:00am, we extend the start to
    // that earlier time.  If the configured last show time is later
    // than 1:00am, we extend the end to that later time.
    const cfgFirst = normalizeDate(ShowtimeState.dtFromHM(state.firstShowHM));
    const cfgLast = normalizeDate(ShowtimeState.dtFromHM(state.lastShowHM));
    // Baseline start at 9:00am today. When computing the visible window we
    // always include 9:00a through midnight at minimum.  If the first
    // configured show begins earlier than 9:00, the window will extend
    // earlier; likewise if the last configured show ends after midnight
    // the window extends later.  Midnight (00:00) is normalized to the
    // next day by normalizeDate() below so it always sorts after
    // evening shows.
    const baselineStart = normalizeDate(ShowtimeState.dtFromHM('09:00'));
    // Baseline end at 12:00am (midnight). This is normalized to the next
    // day so that the timeline spans at least until the end of the
    // current day.
    const baselineEnd = normalizeDate(ShowtimeState.dtFromHM('00:00'));
    // Choose the raw first date: the earlier of the configured first show and baseline start.
    const rawFirstDate = cfgFirst < baselineStart ? cfgFirst : baselineStart;
    // Choose the last date: the later of the configured last show and baseline end.
    const lastDate = cfgLast > baselineEnd ? cfgLast : baselineEnd;
    // Always align the timeline start to the baseline (9:00a) so that hour
    // markers land on the clock (e.g. 10:00, 10:30, 11:00). Shows before
    // the baseline will still render, but may extend off the left side of
    // the visible window.
    const timelineStart = new Date(baselineStart);
    timelineStart.setSeconds(0);
    timelineStart.setMilliseconds(0);
    // Duration in minutes of the full timeline (not floored) so that
    // fractional minutes are preserved. Ensure at least one minute to avoid divide-by-zero.
    const timelineMins = Math.max(1, (lastDate - timelineStart) / 60000);
    // The firstDate remains the earlier of the configured first show and baseline start.
    const firstDate = rawFirstDate;
    // Persist the computed baseline start and duration so drag handlers can
    // refer to them.  Without capturing these values, the drag
    // computations might use the configured first show time instead of
    // the baseline start, resulting in bars misaligned with the hour
    // markers during dragging or after release.
    lastFirstDate = timelineStart;
    lastTimelineMins = timelineMins;
    // Clear previous mappings
    showIdToBar = {};
    showIdToRec = {};
    rowEls = [];
    rowIndexOfShow = {};
    // Group shows by auditorium
    const shows = ShowtimeState.getAllShows();
    const auds = (state.auds || []).slice().sort((a,b) => a.id - b.id);
    const showsByAud = {};
    auds.forEach(a => { showsByAud[a.id] = []; });
    shows.forEach(rec => {
      // fallback for missing audId: group into first row
      const aid = rec.audId || (auds[0] && auds[0].id);
      if (!showsByAud[aid]) showsByAud[aid] = [];
      showsByAud[aid].push(rec);
    });
    // Sort shows within each auditorium by start time
    Object.values(showsByAud).forEach(list => {
      list.sort((a,b) => normalizeDate(a.start) - normalizeDate(b.start));
    });
    // Build the DOM
    const container = document.getElementById('ganttContainer');
    if (!container) return;
    container.innerHTML = '';
    // Header with 30‑minute and hour ticks.  We generate tick marks at
    // every half hour boundary aligned to the clock (e.g. 10:00, 10:30,
    // 11:00).  Hour ticks include labels; half‑hour ticks are drawn
    // without labels.  Lines before the visible window are skipped.
    //
    // The timeline rows include a fixed label column at the left (5rem wide).
    // Previously, the header’s tick marks were positioned relative to
    // the full container width, causing the vertical lines and labels to
    // misalign with the show bars (which live in the timeline cell after
    // the label).  To fix this, build the header as a flex container
    // with a spacer for the label column and a separate tick container
    // that fills the remaining width.  All tick positioning is relative
    // to this tick container so hour markers align perfectly with the
    // bars below.
    const header = document.createElement('div');
    // Apply grad-header class so the tick header uses the same gradient
    // colours as other table headers.  The grad-header class also
    // applies white text colour, so we omit any explicit text colour here.
    header.className = 'relative flex h-6 text-[0.625rem] select-none grad-header';
    header.style.minWidth = '100%';
    // Spacer cell to align with the 5rem label column on each row. We
    // replicate the sticky styling from row labels so that the header
    // remains aligned when horizontally scrolled. The spacer itself is
    // empty; its only purpose is to occupy the same width as the
    // auditorium name column below.
    const spacer = document.createElement('div');
    spacer.className = 'sticky left-0 z-10 bg-white border-r border-gray-200';
    spacer.style.width = '5rem';
    spacer.style.flexShrink = '0';
    header.appendChild(spacer);
    // Container for the timeline ticks. This flexes to fill the
    // remaining horizontal space. All tick lines and labels are
    // absolutely positioned relative to this element so that their
    // percentages map to the same width as the show bars.
    const tickContainer = document.createElement('div');
    tickContainer.className = 'relative flex-1';
    // Determine the first tick at or before the firstDate on a 30‑minute boundary
    const firstTick = new Date(timelineStart);
    firstTick.setSeconds(0); firstTick.setMilliseconds(0);
    const mins = firstTick.getMinutes();
    // Round down to nearest 30‑minute boundary
    firstTick.setMinutes(Math.floor(mins / 30) * 30);
    // Generate ticks every 30 minutes until the end of the timeline.  Skip
    // ticks that fall before the firstDate.  For each tick, draw a
    // vertical line.  For hour ticks (minute === 0), also draw a
    // label.
    for (let t = new Date(firstTick); t <= lastDate; t = new Date(t.getTime() + 30 * 60000)) {
      if (t < firstDate) continue;
      const minutesFromFirst = (t.getTime() - timelineStart.getTime()) / 60000;
      const leftPercent = (minutesFromFirst / timelineMins) * 100;
      // Vertical line for this tick
      const line = document.createElement('div');
      // Hour lines use a darker colour, half‑hour lines lighter
      const isHour = t.getMinutes() === 0;
      line.className = 'absolute top-0 bottom-0 border-l';
      line.classList.add(isHour ? 'border-gray-300' : 'border-gray-200');
      line.style.left = `${leftPercent}%`;
      line.style.width = '0';
      tickContainer.appendChild(line);
      // Label for hour ticks
      if (isHour) {
        const label = document.createElement('span');
        // Use white text for hour labels so they remain legible on the
        // gradient header background.  The grad-header class on the
        // parent header sets the text colour to white; specifying
        // text-white here ensures consistency even if CSS changes.
        label.className = 'absolute text-white';
        label.textContent = ShowtimeState.to12(t);
        label.style.left = `${leftPercent}%`;
        label.style.transform = 'translateX(-50%)';
        label.style.top = '0.125rem';
        tickContainer.appendChild(label);
      }
    }
    header.appendChild(tickContainer);
    container.appendChild(header);
    // Build each row for each auditorium
    auds.forEach((aud, rowIndex) => {
      // Row container
      const row = document.createElement('div');
      row.className = 'relative flex items-stretch border-b border-gray-200 text-xs';
      row.style.minHeight = '2rem';
      // Sticky label cell
      const label = document.createElement('div');
      label.className = 'sticky left-0 z-10 bg-white border-r border-gray-200 flex items-center px-2 whitespace-nowrap';
      label.style.width = '5rem';
      label.textContent = aud.name;
      row.appendChild(label);
      // Timeline cell (bars live here)
      const timeline = document.createElement('div');
      timeline.className = 'relative flex-1';
      timeline.style.minHeight = '2rem';
      // Store the auditorium id on the timeline element so drop handlers
      // can determine which auditorium the user is dropping onto.
      timeline.dataset.audId = String(aud.id);

      // Drag‑over handler: when a film chip is dragged over this row, we
      // compute the preview position and show a dashed ghost bar to
      // indicate where the new show will land. We allow dropping only
      // when a film is being dragged.
      let ghostDiv = null;
      function showGhost(pxLeft, pxWidth) {
        if (!ghostDiv) {
          ghostDiv = document.createElement('div');
          ghostDiv.className = 'absolute top-1/4 h-1/2 opacity-60 border-2 border-dashed border-gray-400 bg-gray-200';
          timeline.appendChild(ghostDiv);
        }
        ghostDiv.style.left = pxLeft + 'px';
        ghostDiv.style.width = Math.max(2, pxWidth) + 'px';
      }
      function clearGhost() {
        if (ghostDiv) {
          ghostDiv.remove();
          ghostDiv = null;
        }
      }
      timeline.addEventListener('dragover', (e) => {
        const filmId = currentDragFilmId || e.dataTransfer.getData('text/plain');
        if (!filmId) return;
        e.preventDefault();
        const rect = timeline.getBoundingClientRect();
        // Position relative to the timeline width
        let px = e.clientX - rect.left;
        if (px < 0) px = 0;
        if (px > rect.width) px = rect.width;
        const leftPct = px / rect.width;
        // Compute minutes relative to the rendered timeline. Use the same
        // timeline duration captured during render().  Snap to 5 minutes.
        const minutes = Math.round((leftPct * lastTimelineMins) / 5) * 5;
        const film = ShowtimeState.filmById(filmId);
        const cycleMins = ShowtimeState.cycleMinutes(film || { runtime: 0, trailer: 0, clean: 0 }) || 0;
        // Pixel width for preview based on cycle duration
        const pxWidth = rect.width * (cycleMins / lastTimelineMins);
        showGhost(px, pxWidth);
      });
      timeline.addEventListener('dragleave', (e) => {
        clearGhost();
      });
      timeline.addEventListener('drop', (e) => {
        // Prevent the event from bubbling so the global drop handler does not
        // also handle this drop. Without stopping propagation, the drop
        // event would bubble to document and insert a duplicate show.
        e.stopPropagation();
        const filmId = currentDragFilmId || e.dataTransfer.getData('text/plain');
        clearGhost();
        if (!filmId) return;
        e.preventDefault();
        const rect = timeline.getBoundingClientRect();
        let px = e.clientX - rect.left;
        if (px < 0) px = 0;
        if (px > rect.width) px = rect.width;
        const leftPct = px / rect.width;
        // Compute minutes from start of timeline. Snap to nearest 5 minutes.
        const minutes = Math.round((leftPct * lastTimelineMins) / 5) * 5;
        // Determine absolute start time from timeline baseline
        const dropDate = new Date(lastFirstDate.getTime() + minutes * 60000);
        const hm = ShowtimeState.hmFromDate(dropDate);
        const audId = parseInt(timeline.dataset.audId, 10);
        // Find an existing row matching this film and auditorium.  Convert
        // audId values to numbers and filmId values to strings for
        // comparison so that type differences (e.g. '1' vs 1) do not
        // prevent a match.  Search both prime and extra rows.
        const st = ShowtimeState.state;
        let row = null;
        const allRows = [].concat(st.primeRows || [], st.extraRows || []);
        for (const r of allRows) {
          const rAud = typeof r.audId === 'undefined' ? undefined : parseInt(r.audId, 10);
          const rFilm = r.filmId != null ? String(r.filmId) : null;
          if (rAud === audId && rFilm === String(filmId)) {
            row = r;
            break;
          }
        }
        // If no matching row exists, create a new extra row and assign
        // both the auditorium and film.  The row IDs are strings so
        // convert the auditorium id back to a string when setting the
        // field to match other rows.
        if (!row) {
          row = ShowtimeState.addExtraRow();
          ShowtimeState.setRowField(row.rowId, 'audId', audId);
          ShowtimeState.setRowField(row.rowId, 'filmId', String(filmId));
        }
        // Add a manual show at the computed time.
        ShowtimeState.addManualShow(row.rowId, hm);
        // Re-render timeline to include the new show
        render();
      });

      // Hover preview for click‑to‑insert mode.  When a film is selected via the
      // film tray (clickInsertFilmId not null) and the user moves the cursor
      // over a timeline row, show a dashed ghost bar indicating where the
      // show would be inserted.  Do not show a preview if a drag is in
      // progress (currentDragFilmId) to avoid conflicting visuals.
      timeline.addEventListener('mousemove', (e) => {
        if (!clickInsertFilmId || currentDragFilmId) return;
        const rect = timeline.getBoundingClientRect();
        let px = e.clientX - rect.left;
        if (px < 0) px = 0;
        if (px > rect.width) px = rect.width;
        // Use baseline timeline duration and start captured earlier
        const leftPct = px / rect.width;
        const minutes = Math.round((leftPct * lastTimelineMins) / 5) * 5;
        const film = ShowtimeState.filmById(clickInsertFilmId);
        const cycleMins = ShowtimeState.cycleMinutes(film || { runtime: 0, trailer: 0, clean: 0 }) || 0;
        const pxWidth = rect.width * (cycleMins / lastTimelineMins);
        showGhost(px, pxWidth);
      });
      // Clear the ghost when the cursor leaves the row during click insertion
      timeline.addEventListener('mouseleave', (e) => {
        clearGhost();
      });
      // Click to insert a show.  If a film is currently selected via the
      // tray (clickInsertFilmId), compute the time and add a manual show
      // at that time in the clicked auditorium row.  Afterwards, clear
      // clickInsertFilmId and ghost preview.  Ignore clicks while
      // dragging.
      timeline.addEventListener('click', (e) => {
        if (!clickInsertFilmId || currentDragFilmId) return;
        const rect = timeline.getBoundingClientRect();
        let px = e.clientX - rect.left;
        if (px < 0) px = 0;
        if (px > rect.width) px = rect.width;
        const leftPct = px / rect.width;
        const minutes = Math.round((leftPct * lastTimelineMins) / 5) * 5;
        const dropDate = new Date(lastFirstDate.getTime() + minutes * 60000);
        const hm = ShowtimeState.hmFromDate(dropDate);
        const audId = parseInt(timeline.dataset.audId, 10);
        // Find an existing row matching this film and auditorium
        const st = ShowtimeState.state;
        let rowMatch = null;
        const allRows = [].concat(st.primeRows || [], st.extraRows || []);
        for (const r of allRows) {
          const rAud = typeof r.audId === 'undefined' ? undefined : parseInt(r.audId, 10);
          const rFilm = r.filmId != null ? String(r.filmId) : null;
          if (rAud === audId && rFilm === String(clickInsertFilmId)) {
            rowMatch = r;
            break;
          }
        }
        if (!rowMatch) {
          rowMatch = ShowtimeState.addExtraRow();
          ShowtimeState.setRowField(rowMatch.rowId, 'audId', audId);
          ShowtimeState.setRowField(rowMatch.rowId, 'filmId', String(clickInsertFilmId));
        }
        ShowtimeState.addManualShow(rowMatch.rowId, hm);
        // Exit insert mode and clear preview
        clickInsertFilmId = null;
        clearGhost();
        // Refresh the film tray highlight and timeline
        render();
      });
      // Grid lines for this row: half‑hour and hour marks.  Use a
      // lighter colour for half‑hours and darker for hours.  Lines
      // before firstDate are skipped.
      const rowFirstTick = new Date(firstTick);
      // Iterate ticks across the timeline
      for (let tt = new Date(rowFirstTick); tt <= lastDate; tt = new Date(tt.getTime() + 30 * 60000)) {
        if (tt < firstDate) continue;
        const minutesFromFirst = (tt.getTime() - timelineStart.getTime()) / 60000;
        const leftPercent = (minutesFromFirst / timelineMins) * 100;
        const line = document.createElement('div');
        const isHour = tt.getMinutes() === 0;
        line.className = 'absolute top-0 bottom-0 border-l';
        line.classList.add(isHour ? 'border-gray-200' : 'border-gray-100');
        line.style.left = `${leftPercent}%`;
        line.style.width = '0';
        timeline.appendChild(line);
      }
      // Render each show in this auditorium
      (showsByAud[aud.id] || []).forEach(rec => {
        // Compute relative positions
        // Rather than using normalizeDate() directly for both start and end,
        // normalize the dates carefully to avoid adding an extra day to
        // end times that already fall on the next day.  The previous
        // implementation always added a day to times before 5:00 a.m.
        // regardless of their existing date, which caused movies that
        // ended after midnight to appear excessively long on the
        // timeline.  Here, we only bump times before 5 a.m. when they
        // occur on the same date as the start.  Otherwise, we preserve
        // the provided date.
        const rawStart = new Date(rec.start);
        const rawEnd = new Date(rec.end);
        // Normalize the start: if the show starts before 5 a.m., treat it
        // as belonging to the next day.  This matches the behavior in
        // normalizeDate() for early‑morning starts.
        let start = new Date(rawStart);
        if (start.getHours() < 5) {
          start.setDate(start.getDate() + 1);
        }
        // Normalize the end: only bump the date forward if it ends
        // before 5 a.m. *and* still shares the same date as the start.
        // Without this check, a show that already ends on the next
        // calendar day (e.g. 1:30 a.m. next day) would incorrectly be
        // moved two days forward.  See GH issue # and user report.
        let end = new Date(rawEnd);
        if (end.getHours() < 5 && end.getDate() === rawStart.getDate()) {
          end.setDate(end.getDate() + 1);
        }
        // Compute minutes from the timeline start rather than raw first
        // date to ensure bar alignment with tick marks.  Avoid flooring
        // these values so fractional minutes are preserved, which
        // prevents bars from snapping to 30‑minute boundaries and keeps
        // them aligned with the hour markers.  DurMin uses the exact
        // duration as a float.
        // Compute the bar position relative to the timeline.  Use
        // timelineStart and lastDate (the end of the visible window) so
        // shows that finish after the window are truncated rather than
        // spilling past the right edge.  Without clamping the end
        // time, shows that end after midnight (or after the configured
        // last show) would render too wide because their full duration
        // is divided by the window length.
        const startMin = (start - timelineStart) / 60000;
        // Clamp the end time to the last visible date so width is
        // truncated when shows extend past the end of the window.
        const clampedEnd = end > lastDate ? lastDate : end;
        const endMin = (clampedEnd - timelineStart) / 60000;
        // Ensure at least 1 minute width to make the bar visible
        const durMin = Math.max(1, endMin - startMin);
        let leftPercent = (startMin / timelineMins) * 100;
        let widthPercent = (durMin / timelineMins) * 100;
        // Create bar
        const bar = document.createElement('div');
        bar.className = 'absolute rounded-md text-white text-[0.65rem] flex items-center pl-1 pr-1 whitespace-nowrap overflow-hidden shadow';
        bar.style.left = `${leftPercent}%`;
        bar.style.width = `${widthPercent}%`;
        bar.style.top = '0.25rem';
        bar.style.bottom = '0.25rem';
        // Default gradient
        // Apply the gradient bar class defined in theme.css instead of hardcoding
        // Tailwind colours. The grad-bar class uses CSS variables set via the
        // theme picker so bars automatically change colours when the swatch
        // selection changes. See theme.css for details.
        bar.classList.add('grad-bar');
        // Tag bar with filmId for highlighting.  When a film is selected
        // from the highlight dropdown, bars whose data-filmid matches
        // the selection will receive a pink highlight via CSS.
        if (rec.filmId) {
          bar.dataset.filmid = String(rec.filmId);
        }
        bar.dataset.id = rec.id;
        bar.dataset.audid = rec.audId;
        bar.style.cursor = 'pointer';
        // Content: start time and film title
        const startSpan = document.createElement('span');
        startSpan.className = 'font-mono tabular-nums';
        startSpan.textContent = ShowtimeState.to12(rec.start);
        const filmSpan = document.createElement('span');
        filmSpan.className = 'ml-1 truncate';
        filmSpan.textContent = rec.filmTitle || '';
        bar.appendChild(startSpan);
        bar.appendChild(filmSpan);
        // Highlight active show: remove the gradient bar and apply a subtle purple
        // highlight so the selected show stands out.  The grad-bar class is
        // removed here and restored when the bar is deselected.
        if (rec.id === activeShowId) {
          bar.classList.remove('grad-bar');
          bar.classList.add('ring-2','ring-purple-400','bg-purple-50','text-black');
        }

        // If a film is selected in the highlight dropdown, ensure the
        // corresponding bars remain highlighted even after selecting a show or
        // applying other classes.  Check the global state for the
        // highlightFilmId and add the film-highlight class when the current
        // record matches.  Also set the text colour to black for
        // readability.
        try {
          const highlightId = ShowtimeState.state && ShowtimeState.state.highlightFilmId;
          if (highlightId && rec.filmId && String(rec.filmId) === String(highlightId)) {
            bar.classList.add('film-highlight');
            bar.classList.add('text-black');
          }
        } catch (_) {
          /* ignore */
        }
        // Event handlers
        bar.addEventListener('pointerdown', onPointerDown);
        bar.addEventListener('click', onBarClick);
        timeline.appendChild(bar);
        // Map show id to bar and rec for lookup
        showIdToBar[rec.id] = bar;
        showIdToRec[rec.id] = rec;
        rowIndexOfShow[rec.id] = rowIndex;
      });
      row.appendChild(timeline);
      rowEls[rowIndex] = row;
      container.appendChild(row);
    });
  }

  // Apply film highlight after rendering the timeline.  This will add
  // a pink highlight to any bars whose data‑filmid matches the
  // current selection in the highlight dropdown.  The
  // applyFilmHighlight() function is defined globally in app.js.  Wrap
  // in a try/catch to avoid errors if the function is not defined yet.
  try {
    if (typeof window.applyFilmHighlight === 'function') {
      window.applyFilmHighlight();
    }
  } catch (e) {}
  // Handle bar click to set active show
  function onBarClick(e) {
    // Prevent click during dragging: if dragState exists, ignore click
    if (dragState) return;
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    activeShowId = id;
    // Dispatch global event so other components highlight this show
    try {
      const evt = new CustomEvent('activeShowChange', { detail: { showId: id } });
      window.dispatchEvent(evt);
    } catch {}
    // Re-render to apply highlight locally
    render();
  }
  // Initiate a drag on pointerdown
  function onPointerDown(e) {
    if (!e.isPrimary) return;
    // Only respond to left mouse button or primary touch
    e.preventDefault();
    const bar = e.currentTarget;
    const id = bar.dataset.id;
    const rec = showIdToRec[id];
    const rowIndex = rowIndexOfShow[id];
    const startX = e.clientX;
    const startY = e.clientY;
    const timelineWidth = bar.parentElement.getBoundingClientRect().width;
    const state = ShowtimeState.state;
    // Use the baseline first date and timeline mins computed in render().  This
    // ensures horizontal drag distance maps consistently to minutes regardless
    // of the configured first show time.  Fallback to configured times if
    // render() hasn’t run yet.
    const firstDate = lastFirstDate || normalizeDate(ShowtimeState.dtFromHM(state.firstShowHM));
    const timelineMins = lastTimelineMins || Math.max(1, Math.floor((normalizeDate(ShowtimeState.dtFromHM(state.lastShowHM)) - firstDate) / 60000));
    // Compute the original start offset relative to the baseline first date
    const originalStartMin = Math.floor((normalizeDate(rec.start) - firstDate) / 60000);
    const originalAudId = rec.audId;
    dragState = {
      id,
      rec,
      rowIndex,
      startX,
      startY,
      timelineWidth,
      firstDate,
      timelineMins,
      originalStartMin,
      originalAudId,
      bar,
      rowEls
    };

    // If a film was previously selected for click-to-insert mode, cancel that
    // selection when dragging an existing show. Without this, a stray click
    // event after the drag would trigger the click-to-insert handler and
    // insert an extra manual show. Clearing clickInsertFilmId here prevents
    // that unintended insertion. Re-render the film tray so that any
    // highlighted chip loses its selection ring.
    if (typeof clickInsertFilmId !== 'undefined' && clickInsertFilmId !== null) {
      clickInsertFilmId = null;
      try {
        renderFilmTray();
      } catch (err) {
        /* ignore */
      }
    }
    // Capture pointer events on this bar
    bar.setPointerCapture(e.pointerId);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }
  // Drag preview handler: update bar position and colour during drag
  function onPointerMove(e) {
    if (!dragState) return;
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;
    // Convert horizontal movement into minutes
    const deltaMin = (dx / dragState.timelineWidth) * dragState.timelineMins;
    let newStartMin = dragState.originalStartMin + deltaMin;
    // Snap to nearest 5 minute increment
    newStartMin = Math.round(newStartMin / 5) * 5;
    // Determine target row based on vertical movement
    const rowHeight = dragState.rowEls[0] ? dragState.rowEls[0].getBoundingClientRect().height : 32;
    let rowShift = Math.round(dy / rowHeight);
    let newRowIndex = dragState.rowIndex + rowShift;
    if (newRowIndex < 0) newRowIndex = 0;
    if (newRowIndex >= dragState.rowEls.length) newRowIndex = dragState.rowEls.length - 1;
    // Compute new auditorium id
    const state = ShowtimeState.state;
    const auds = (state.auds || []).slice().sort((a,b) => a.id - b.id);
    const newAudId = (auds[newRowIndex] && auds[newRowIndex].id) || dragState.originalAudId;
    // Compute preview position
    const leftPercent = (newStartMin / dragState.timelineMins) * 100;
    dragState.bar.style.left = `${leftPercent}%`;
    // Translate vertically to preview row change
    const translateY = (newRowIndex - dragState.rowIndex) * (rowHeight);
    dragState.bar.style.transform = `translate(0, ${translateY}px)`;
    // Detect overlap in preview
    const previewStartDate = new Date(dragState.firstDate.getTime() + newStartMin * 60000);
    const filmDuration = Math.max(1, Math.floor((normalizeDate(dragState.rec.end) - normalizeDate(dragState.rec.start)) / 60000));
    const previewEndDate = new Date(previewStartDate.getTime() + filmDuration * 60000);
    let conflict = false;
    // Check overlap with existing shows in target auditorium
    const allShows = ShowtimeState.getAllShows();
    allShows.forEach(other => {
      if (other.id === dragState.id) return;
      if (other.audId !== newAudId) return;
      const oStart = normalizeDate(other.start);
      const oEnd = normalizeDate(other.end);
      if (previewStartDate < oEnd && previewEndDate > oStart) {
        conflict = true;
      }
    });
    // Set preview colour
    if (conflict) {
      dragState.bar.classList.add('bg-red-500');
      dragState.bar.classList.remove('grad-bar','bg-purple-50','ring-2','ring-purple-400','text-black');
    } else {
      // Reset classes to default gradient when not active or conflicting
      dragState.bar.classList.remove('bg-red-500');
      // Only add gradient if this bar is not the active show; highlight will be applied in onPointerUp or on click
      dragState.bar.classList.add('grad-bar');
      dragState.bar.classList.remove('bg-purple-50','ring-2','ring-purple-400','text-black');
    }
  }
  // Finalize drag: commit changes and clean up
  function onPointerUp(e) {
    if (!dragState) return;
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;
    const deltaMin = (dx / dragState.timelineWidth) * dragState.timelineMins;
    let newStartMin = dragState.originalStartMin + deltaMin;
    newStartMin = Math.round(newStartMin / 5) * 5;
    const rowHeight = dragState.rowEls[0] ? dragState.rowEls[0].getBoundingClientRect().height : 32;
    let rowShift = Math.round(dy / rowHeight);
    let newRowIndex = dragState.rowIndex + rowShift;
    if (newRowIndex < 0) newRowIndex = 0;
    if (newRowIndex >= dragState.rowEls.length) newRowIndex = dragState.rowEls.length - 1;
    const state = ShowtimeState.state;
    const auds = (state.auds || []).slice().sort((a,b) => a.id - b.id);
    const newAudId = (auds[newRowIndex] && auds[newRowIndex].id) || dragState.originalAudId;
    // Compute final start HM
    const finalStartDate = new Date(dragState.firstDate.getTime() + newStartMin * 60000);
    const newHM = ShowtimeState.hmFromDate(finalStartDate);
    // Commit auditorium change if changed
    if (newAudId !== dragState.originalAudId) {
      // Always override the show auditorium only. Do not alter the entire row.
      // If moving back to the original auditorium, clear the override by
      // passing null. Otherwise set the override to the new auditorium.
      if (newAudId === dragState.originalAudId) {
        ShowtimeState.updateShowAud(dragState.id, null);
      } else {
        ShowtimeState.updateShowAud(dragState.id, newAudId);
      }
    }
    // Commit start time change if changed
    const origHM = ShowtimeState.hmFromDate(new Date(dragState.firstDate.getTime() + dragState.originalStartMin * 60000));
    if (newHM !== origHM) {
      ShowtimeState.updateShowStart(dragState.id, newHM);
    }
    // Set this show as active and notify other components
    activeShowId = dragState.id;
    try {
      const evt = new CustomEvent('activeShowChange', { detail: { showId: dragState.id } });
      window.dispatchEvent(evt);
    } catch {}
    // Release pointer capture and remove listeners
    dragState.bar.releasePointerCapture(e.pointerId);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    dragState = null;
    // Re-render to reset transforms and apply highlight
    render();
  }
  // When the global state changes (other pages editing show times), re-render
  window.addEventListener('showtimeStateUpdated', () => {
    render();
  });
  // When another component selects a show, update active highlight
  window.addEventListener('activeShowChange', (e) => {
    const id = e && e.detail && e.detail.showId;
    if (!id) return;
    if (activeShowId !== id) {
      activeShowId = id;
      render();
    }
  });

  // Helper to determine if the currently focused element is an input or editable field.
  function isFormField(el) {
    return el && (/input|select|textarea/i.test(el.tagName) || el.isContentEditable);
  }
  // Global key handler for deletion, undo and cancelling selection. When a bar is
  // selected (activeShowId), pressing Delete or Backspace will remove
  // it by setting its start time to blank. Escape clears the selection.
  // Ctrl/Cmd+Z triggers the global undo.
  document.addEventListener('keydown', (e) => {
    // Ignore if focus is inside a form field (e.g. search bar)
    if (isFormField(document.activeElement)) return;
    // Delete/Backspace to remove a show
    if ((e.key === 'Delete' || e.key === 'Backspace') && activeShowId) {
      e.preventDefault();
      // Soft delete the show by clearing its start time
      ShowtimeState.updateShowStart(activeShowId, '');
      activeShowId = null;
      render();
    }
    // Undo with Ctrl/Cmd+Z
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      ShowtimeState.undo();
      render();
    }
    // Escape to clear selection
    if (e.key === 'Escape') {
      if (activeShowId) {
        activeShowId = null;
        render();
      }
    }
  });

  // Improve drag and drop experience for adding shows from the film tray. When
  // a film chip is being dragged, allow dropping anywhere on the page (not
  // just over a timeline row) without showing the red "no drop" cursor. This
  // global dragover handler prevents the default browser behaviour so the
  // cursor shows a copy icon instead of a prohibited sign. It only
  // activates when a film is currently being dragged.
  document.addEventListener('dragover', (e) => {
    if (currentDragFilmId) {
      e.preventDefault();
      // Show copy cursor so the user knows dropping will insert a show
      if (e.dataTransfer) {
        try {
          e.dataTransfer.dropEffect = 'copy';
        } catch {} // Some browsers may throw
      }
    }
  });

  // Global drop handler for film chips. If a user drops a film outside of
  // any specific timeline row, attempt to insert the show at the nearest
  // row based on the drop position. This makes the drop feel less fussy
  // because the user doesn’t have to precisely hit the row element. Drops
  // onto the film tray or navigation bar are ignored. After inserting the
  // show, clear the current drag state and re-render the timeline.
  document.addEventListener('drop', (e) => {
    // Determine the film being dragged from either the global state or
    // the drag data transfer (for fallback support). If no film is
    // present, exit early.
    const filmId = currentDragFilmId || (e.dataTransfer && e.dataTransfer.getData('text/plain'));
    if (!filmId) return;
    // Prevent the browser from navigating or doing other default drop
    // behaviour
    e.preventDefault();
    // Ignore drops onto the film tray or the nav bar – these should
    // simply cancel the drag without inserting a show
    const tray = document.getElementById('filmTray');
    const nav = document.querySelector('nav');
    if ((tray && tray.contains(e.target)) || (nav && nav.contains(e.target))) {
      currentDragFilmId = null;
      clickInsertFilmId = null;
      render();
      return;
    }
    // Compute which row was targeted by the drop. Use the Y coordinate
    // relative to the gantt container to find the nearest row. Subtract
    // the height of the header (the first child of ganttContainer) so
    // that rows align correctly. Fall back to first row if calculation
    // yields a negative index.
    const container = document.getElementById('ganttContainer');
    if (!container) {
      currentDragFilmId = null;
      clickInsertFilmId = null;
      render();
      return;
    }
    const contRect = container.getBoundingClientRect();
    // Determine header height from the first child element (the tick header)
    let headerHeight = 0;
    if (container.firstChild && container.firstChild.getBoundingClientRect) {
      const headerRect = container.firstChild.getBoundingClientRect();
      headerHeight = headerRect.height;
    }
    // Y offset within the rows (excluding header). If the drop is above
    // the first row, rowIndex will become negative and will be clamped to 0.
    const yOffset = e.clientY - contRect.top - headerHeight;
    // Height of a row (use first row’s height if available).
    const rowHeight = rowEls && rowEls.length > 0 && rowEls[0].getBoundingClientRect ? rowEls[0].getBoundingClientRect().height : 32;
    let rowIndex = Math.floor(yOffset / rowHeight);
    if (rowIndex < 0) rowIndex = 0;
    if (rowIndex >= rowEls.length) rowIndex = rowEls.length - 1;
    // Find the timeline cell in the selected row. It’s the last child of
    // the row because the first child is the sticky label.
    const rowEl = rowEls[rowIndex];
    if (!rowEl) {
      currentDragFilmId = null;
      clickInsertFilmId = null;
      render();
      return;
    }
    const timeline = rowEl.querySelector('[data-aud-id]');
    if (!timeline) {
      currentDragFilmId = null;
      clickInsertFilmId = null;
      render();
      return;
    }
    // Compute the drop’s position within the timeline horizontally. If
    // the user drops to the left or right of the timeline, clamp to
    // bounds.
    const rect = timeline.getBoundingClientRect();
    let px = e.clientX - rect.left;
    if (px < 0) px = 0;
    if (px > rect.width) px = rect.width;
    const leftPct = rect.width > 0 ? (px / rect.width) : 0;
    // Calculate minutes relative to the timeline baseline and snap to
    // 5-minute increments
    const minutes = Math.round((leftPct * lastTimelineMins) / 5) * 5;
    const dropDate = new Date(lastFirstDate.getTime() + minutes * 60000);
    const hm = ShowtimeState.hmFromDate(dropDate);
    const audId = parseInt(timeline.dataset.audId, 10);
    // Find or create a row matching this auditorium and film. Use string
    // comparisons for filmIds to handle numeric vs string mismatches.
    const st = ShowtimeState.state;
    let targetRow = null;
    const allRows = [].concat(st.primeRows || [], st.extraRows || []);
    for (const r of allRows) {
      const rAud = typeof r.audId === 'undefined' ? undefined : parseInt(r.audId, 10);
      const rFilm = r.filmId != null ? String(r.filmId) : null;
      if (rAud === audId && rFilm === String(filmId)) {
        targetRow = r;
        break;
      }
    }
    if (!targetRow) {
      targetRow = ShowtimeState.addExtraRow();
      ShowtimeState.setRowField(targetRow.rowId, 'audId', audId);
      ShowtimeState.setRowField(targetRow.rowId, 'filmId', String(filmId));
    }
    ShowtimeState.addManualShow(targetRow.rowId, hm);
    // Clear film selection and click insert modes
    currentDragFilmId = null;
    clickInsertFilmId = null;
    // Re-render to show the new show and update film tray
    render();
  });
  // Initial render once the DOM is ready
  function initGanttPage() {
    // Initialise multi‑date support. This will migrate existing schedules
    // and ensure the current date is set. It must be called before
    // rendering or modifying the schedule.
    ShowtimeState.initDateSupport();
    ShowtimeState.load();
    // References to first/last show selectors and date input/buttons
    const dateInput = document.getElementById('scheduleDateGantt');
    const firstSel = document.getElementById('firstShowGanttSelect');
    const lastSel = document.getElementById('lastShowGanttSelect');
    const prevBtn = document.getElementById('prevDateGanttBtn');
    const nextBtn = document.getElementById('nextDateGanttBtn');

    // Populate the time selectors with 30‑minute increments.  This mirrors
    // the prime and schedule list/grid pages.  Last show options span
    // 20:00 through 02:00 to accommodate late shows crossing midnight.
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

    // Attach change handlers to first/last selectors
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

    // Shift the current date by delta days (-1 for previous, +1 for next)
    function shiftDate(delta) {
      const curIso = ShowtimeState.getCurrentDate();
      let d = curIso ? new Date(curIso) : new Date();
      if (isNaN(d)) d = new Date();
      d.setDate(d.getDate() + delta);
      const iso = d.toISOString().slice(0, 10);
      ShowtimeState.setDate(iso);
      if (dateInput) dateInput.value = ShowtimeState.isoToMMDD(iso);
      render();
    }
    if (prevBtn) prevBtn.addEventListener('click', () => shiftDate(-1));
    if (nextBtn) nextBtn.addEventListener('click', () => shiftDate(1));

    // Set up the date input if present.  Allow manual entry and
    // conversion between MM/DD/YYYY and ISO.  Re-render on changes.
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
      // Update date input and re-render when other components change the date
      window.addEventListener('showtimeDateChanged', () => {
        const c = ShowtimeState.getCurrentDate();
        if (c) dateInput.value = ShowtimeState.isoToMMDD(c);
        // Update time selectors in case they changed elsewhere
        populateTimeSelectors();
        render();
      });
    }

    // Populate selectors immediately on first load
    populateTimeSelectors();
    render();
    // After the initial render, apply any film highlight on the timeline.  The
    // applyFilmHighlight() function checks data-filmid attributes on
    // bars and adds the .film-highlight class when the selected film
    // matches.  This ensures the initial view respects the current
    // highlight selection.
    try {
      if (typeof window.applyFilmHighlight === 'function') {
        window.applyFilmHighlight();
      }
    } catch (e) {}
    // Listen for highlight changes so that the timeline updates when
    // the user selects a different film in the nav dropdown.  Without
    // this listener, the highlight would not update until the next
    // render (e.g. after a drag or configuration change).
    window.addEventListener('filmHighlightChange', () => {
      try {
        if (typeof window.applyFilmHighlight === 'function') {
          window.applyFilmHighlight();
        }
      } catch (e) {}
    });
    window.addEventListener('showtimeViewActivated', (evt) => {
      const detail = evt && evt.detail;
      const view = detail && detail.view ? detail.view : evt && evt.view;
      if (view === 'gantt') {
        setTimeout(() => render(), 0);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGanttPage);
  } else {
    initGanttPage();
  }
})();
