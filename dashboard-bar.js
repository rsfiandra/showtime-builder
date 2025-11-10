// Dashboard Bar (Tabbed Version)
//
// This variant of the dashboard widget presents summary charts in a fixed‑height
// bar at the bottom of every page.  Rather than displaying all charts at
// once, the widget uses tabs to switch between four views: shows by film,
// shows by auditorium, start/end time distribution, and utilisation & issues.
// Each tab contains a chart rendered with Chart.js.  Limiting the number
// of categories prevents the charts from growing indefinitely and keeps
// the widget compact.  The bar height is fixed so that no internal
// scrolling occurs, and the body’s bottom padding is adjusted dynamically
// whenever the bar opens or its contents update.

(function() {
  const ShowtimeState = window.ShowtimeState;
  if (!ShowtimeState) return;

  // Persist dashboard bar open state across page navigations. Use a
  // dedicated key in localStorage to remember whether the bar was
  // previously open. When the bar is shown or hidden via the toggle
  // button, we update this key accordingly. On page load, we read
  // this key and re‑open the bar if needed. Choosing a namespaced
  // key avoids collisions with other modules.
  const DASHBAR_OPEN_KEY = 'showtime:dashboardBarOpen';

  // Chart instances (one per tab)
  let filmChart = null;
  let audChart = null;
  let timeChart = null;
  let utilChart = null;

  // Maximum number of categories to display in bar charts.  Additional
  // categories are aggregated into an "Other" bar.
  const MAX_BAR_CATEGORIES = 8;

  // Threshold constants for downtime and late‑first flagging.  These values
  // mirror those used on the dedicated dashboard page.  A gap shorter
  // than GAP_THRESHOLD_MIN minutes is ignored; a gap equal or above
  // GAP_HUGE_MIN is considered a huge gap.  FIT_SLOT_MIN defines the
  // minimum duration between the operating window start and the first show
  // that constitutes a late‑first slot.
  const GAP_THRESHOLD_MIN = 45;
  const GAP_HUGE_MIN = 90;
  const FIT_SLOT_MIN = 105;

  /**
   * Dynamically load Chart.js if it hasn’t been loaded already.  Returns a
   * Promise that resolves once the library is available.  Loading from a
   * CDN ensures the page isn’t weighed down by unused scripts until
   * necessary.
   */
  function loadChartJs() {
    return new Promise(resolve => {
      if (window.Chart) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/chart.js';
      script.onload = () => resolve();
      script.onerror = () => {
        console.error('Failed to load Chart.js from CDN');
        resolve();
      };
      document.head.appendChild(script);
    });
  }

  /**
   * Convert a 24‑hour integer into a human‑friendly 12‑hour label.
   * Example: 0 -> 12a, 13 -> 1p.
   * @param {number} h  Hour of day (0–23)
   * @returns {string}
   */
  function formatHour(h) {
    const hour12 = ((h + 11) % 12) + 1;
    return hour12 + (h < 12 ? 'a' : 'p');
  }

  /**
   * Compute shows and seats grouped by hour as well as by end hour.  The
   * returned object contains labels (hours), start counts, end counts and
   * total seat counts per hour.  Hours with no shows are included to
   * maintain consistent ordering.
   */
  function computeTimeDistribution(shows) {
    const startCounts = {};
    const endCounts = {};
    const seatCounts = {};
    shows.forEach(rec => {
      // Normalise start time to ensure it’s a Date
      const start = rec.start instanceof Date ? rec.start : new Date(rec.start);
      const sh = start.getHours();
      startCounts[sh] = (startCounts[sh] || 0) + 1;
      // Seats per start hour
      let seats = 0;
      try {
        const audId = rec.audId;
        if (ShowtimeState.audById && audId != null) {
          const audObj = ShowtimeState.audById(audId);
          seats = audObj && audObj.seats != null ? parseInt(audObj.seats, 10) || 0 : 0;
        }
      } catch (_) {
        seats = 0;
      }
      seatCounts[sh] = (seatCounts[sh] || 0) + seats;
      // Normalise end time (may be missing)
      let end = rec.end;
      if (!end || !(end instanceof Date)) {
        let film = null;
        if (rec.filmId && ShowtimeState.filmById) {
          try { film = ShowtimeState.filmById(rec.filmId); } catch (_) { film = null; }
        }
        if (film) {
          const total = (film.runtime || 0) + (film.trailer || 0) + (film.clean || 0);
          end = new Date(start.getTime() + total * 60000);
        } else {
          end = new Date(start);
        }
      }
      const eh = end.getHours();
      endCounts[eh] = (endCounts[eh] || 0) + 1;
    });
    // Build ordered arrays for 24 hours (0–23).  This ensures the x‑axis
    // ordering is consistent even if there are no shows in some hours.
    const labels = [];
    const starts = [];
    const ends = [];
    const seats = [];
    for (let h = 0; h < 24; h++) {
      labels.push(formatHour(h));
      starts.push(startCounts[h] || 0);
      ends.push(endCounts[h] || 0);
      seats.push(seatCounts[h] || 0);
    }
    return { labels, starts, ends, seats };
  }

  /**
   * Compute flagged issues across all auditoriums.  Issues include
   * late‑first slots and gaps (normal and huge).  Returns a count of
   * issues by type.  This function mirrors the logic used on the
   * dedicated dashboard page but summarises counts rather than listing
   * each gap individually.
   */
  function computeFlaggedCounts(shows) {
    const GAP_THRESHOLD_MIN = 45;
    const GAP_HUGE_MIN = 90;
    const FIT_SLOT_MIN = 105;
    const byAud = {};
    shows.forEach(rec => {
      const audId = rec.audId;
      if (!audId) return;
      if (!byAud[audId]) byAud[audId] = [];
      // Determine end time; compute fallback if missing
      let endDate = rec.end;
      if (!endDate) {
        let film = null;
        if (rec.filmId && ShowtimeState.filmById) {
          try { film = ShowtimeState.filmById(rec.filmId); } catch (_) { film = null; }
        }
        if (film) {
          const total = (film.runtime || 0) + (film.trailer || 0) + (film.clean || 0);
          endDate = new Date(rec.start.getTime() + total * 60000);
        } else {
          endDate = new Date(rec.start);
        }
      }
      byAud[audId].push({ start: rec.start instanceof Date ? rec.start : new Date(rec.start), end: endDate });
    });
    const counts = { late: 0, gap: 0, huge: 0 };
    // Determine operating window start per auditorium from state
    const state = ShowtimeState.state || {};
    const dateIso = ShowtimeState.getCurrentDate && ShowtimeState.getCurrentDate();
    let globalFirstHM = (state && state.firstShowHM) || '07:00';
    if (dateIso && state.scheduleByDate && state.scheduleByDate[dateIso]) {
      globalFirstHM = state.scheduleByDate[dateIso].firstShowHM || globalFirstHM;
    }
    Object.keys(byAud).forEach(audId => {
      const list = byAud[audId];
      list.sort((a,b) => a.start - b.start);
      const windowStart = ShowtimeState.dtFromHM ? ShowtimeState.dtFromHM(globalFirstHM) : new Date();
      const firstStart = list[0].start;
      const diffFirst = (firstStart - windowStart) / 60000;
      if (diffFirst >= FIT_SLOT_MIN) counts.late++;
      for (let i = 0; i < list.length - 1; i++) {
        const gapMin = (list[i + 1].start - list[i].end) / 60000;
        if (gapMin >= GAP_THRESHOLD_MIN) {
          counts[gapMin >= GAP_HUGE_MIN ? 'huge' : 'gap']++;
        }
      }
    });
    return counts;
  }

  /**
   * Normalize a date so that times before 5AM are considered part of the next day.
   * Mirrors the logic used in the dedicated dashboard page and schedule grid.
   *
   * @param {Date} dt
   * @returns {Date}
   */
  function normalizeDateForGap(dt) {
    const n = new Date(dt);
    if (n.getHours() < 5) {
      n.setDate(n.getDate() + 1);
    }
    return n;
  }

  /**
   * Format a duration in minutes into an HhMMm string (e.g. 1h30m).
   *
   * @param {number} mins
   * @returns {string}
   */
  function formatDuration(mins) {
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return `${h}h${String(m).padStart(2, '0')}m`;
  }

  /**
   * Compute a detailed list of flagged issues (downtime gaps and late‑first slots)
   * for the current schedule.  Returns an array of objects with auditorium name,
   * type (late, gap, huge), descriptive message and gap duration in minutes.
   *
   * This mirrors the logic on the dedicated dashboard page.
   *
   * @param {Array} shows
   * @returns {Array<{audName: string, type: string, message: string, minutes: number}>}
   */
  function computeFlaggedIssues(shows) {
    const issues = [];
    if (!shows || !shows.length) return issues;
    const byAud = {};
    // Group shows by auditorium ID and compute end times if missing
    shows.forEach(rec => {
      const audId = rec.audId;
      if (!audId) return;
      if (!byAud[audId]) byAud[audId] = [];
      let endDate = rec.end;
      if (!endDate) {
        // Compute end based on film runtime, trailer and clean durations
        let film = null;
        if (rec.filmId && ShowtimeState.filmById) {
          try { film = ShowtimeState.filmById(rec.filmId); } catch (_) { film = null; }
        }
        if (film) {
          const total = (film.runtime || 0) + (film.trailer || 0) + (film.clean || 0);
          endDate = new Date(rec.start.getTime() + total * 60000);
        } else {
          endDate = new Date(rec.start);
        }
      }
      byAud[audId].push({
        start: rec.start instanceof Date ? rec.start : new Date(rec.start),
        end: endDate,
        audName: rec.audName || ''
      });
    });
    // Use current first show time as operating window start
    const state = ShowtimeState.state || {};
    const firstHM = (state && state.firstShowHM) || '07:00';
    const windowStartRaw = ShowtimeState.dtFromHM ? ShowtimeState.dtFromHM(firstHM) : new Date();
    Object.keys(byAud).forEach(audId => {
      const list = byAud[audId];
      list.sort((a,b) => normalizeDateForGap(a.start) - normalizeDateForGap(b.start));
      if (!list.length) return;
      const audName = list[0].audName || `Aud ${audId}`;
      // Late first slot
      const windowStart = normalizeDateForGap(windowStartRaw);
      const firstStart = normalizeDateForGap(list[0].start);
      const diffFirst = (firstStart - windowStart) / 60000;
      if (diffFirst >= FIT_SLOT_MIN) {
        const startDisp = ShowtimeState.to12 ? ShowtimeState.to12(windowStartRaw) : '';
        const endDisp = ShowtimeState.to12 ? ShowtimeState.to12(list[0].start) : '';
        const durationStr = formatDuration(diffFirst);
        issues.push({
          audName,
          type: 'late',
          message: `${audName}: slot before first show from ${startDisp} to ${endDisp} (${durationStr})`,
          minutes: diffFirst
        });
      }
      // Consecutive gaps within the auditorium
      for (let i = 0; i < list.length - 1; i++) {
        const currEnd = normalizeDateForGap(list[i].end);
        const nextStart = normalizeDateForGap(list[i + 1].start);
        const gapMin = (nextStart - currEnd) / 60000;
        if (gapMin >= GAP_THRESHOLD_MIN) {
          const startDisp = ShowtimeState.to12 ? ShowtimeState.to12(list[i].end) : '';
          const endDisp = ShowtimeState.to12 ? ShowtimeState.to12(list[i + 1].start) : '';
          const durationStr = formatDuration(gapMin);
          const type = gapMin >= GAP_HUGE_MIN ? 'huge' : 'gap';
          issues.push({
            audName,
            type,
            message: `${audName}: gap from ${startDisp} to ${endDisp} (${durationStr})`,
            minutes: gapMin
          });
        }
      }
    });
    // Sort by longest duration first
    issues.sort((a, b) => b.minutes - a.minutes);
    return issues;
  }

  /**
   * Update all tabbed charts.  This function reads the current shows from
   * ShowtimeState, aggregates data and updates or creates the charts in
   * each tab.  It must only be called once Chart.js has loaded.
   */
  function updateCharts() {
    const shows = ShowtimeState.getAllShows ? (ShowtimeState.getAllShows() || []) : [];
    // Aggregate counts by film and auditorium
    const filmCounts = {};
    const audCounts = {};
    shows.forEach(rec => {
      const fName = rec.filmTitle || 'Unknown';
      filmCounts[fName] = (filmCounts[fName] || 0) + 1;
      const aName = rec.audName || 'Unassigned';
      audCounts[aName] = (audCounts[aName] || 0) + 1;
    });
    // Sort entries and limit to top categories
    function limitEntries(obj) {
      const entries = Object.entries(obj).sort((a,b) => b[1] - a[1]);
      if (entries.length <= MAX_BAR_CATEGORIES) return entries;
      const limited = entries.slice(0, MAX_BAR_CATEGORIES);
      const otherTotal = entries.slice(MAX_BAR_CATEGORIES).reduce((sum, [, val]) => sum + val, 0);
      limited.push(['Other', otherTotal]);
      return limited;
    }
    const filmEntries = limitEntries(filmCounts);
    const audEntries = limitEntries(audCounts);
    const filmLabels = filmEntries.map(([n]) => n);
    const filmData = filmEntries.map(([, v]) => v);
    const audLabels = audEntries.map(([n]) => n);
    const audData = audEntries.map(([, v]) => v);
    // Time distributions (start, end, seats)
    const timeDist = computeTimeDistribution(shows);
    // Utilisation per auditorium (percentage of available window used)
    const utilLabels = [];
    const utilVals = [];
    try {
      const state = ShowtimeState.state;
      let firstHM = (state && state.firstShowHM) || '07:00';
      let lastHM = (state && state.lastShowHM) || '23:00';
      const dateIso2 = ShowtimeState.getCurrentDate && ShowtimeState.getCurrentDate();
      if (dateIso2 && state.scheduleByDate && state.scheduleByDate[dateIso2]) {
        const entry = state.scheduleByDate[dateIso2];
        firstHM = entry.firstShowHM || firstHM;
        lastHM = entry.lastShowHM || lastHM;
      }
      const firstDate = ShowtimeState.dtFromHM(firstHM);
      const lastDate = ShowtimeState.dtFromHM(lastHM);
      let available = (lastDate - firstDate) / 60000;
      if (available <= 0) available += 24 * 60;
      Object.keys(audCounts).forEach(name => {
        utilLabels.push(name);
        utilVals.push(0);
      });
      const idxMap = {};
      utilLabels.forEach((name, idx) => { idxMap[name] = idx; });
      shows.forEach(rec => {
        const name = rec.audName || 'Unassigned';
        const i = idxMap[name];
        if (i == null) return;
        const start = rec.start instanceof Date ? rec.start : new Date(rec.start);
        const end = rec.end instanceof Date ? rec.end : new Date(rec.end);
        let duration = (end - start) / 60000;
        if (duration < 0) duration = 0;
        utilVals[i] += duration;
      });
      utilVals.forEach((mins, idx) => {
        utilVals[idx] = available > 0 ? Math.min(100, (mins / available) * 100) : 0;
      });
    } catch (_) {}
    // Limit utilisation categories as well
    const utilEntries = utilLabels.map((n, i) => [n, utilVals[i]]).sort((a,b) => b[1] - a[1]);
    const utilLimited = utilEntries.length > MAX_BAR_CATEGORIES ?
      utilEntries.slice(0, MAX_BAR_CATEGORIES).concat([[ 'Other', utilEntries.slice(MAX_BAR_CATEGORIES).reduce((sum, [, v]) => sum + v, 0) ]]) :
      utilEntries;
    const utilLabelsLimited = utilLimited.map(([n]) => n);
    const utilValsLimited = utilLimited.map(([, v]) => v);
    // Flagged issue counts
    const issueCounts = computeFlaggedCounts(shows);
    // Determine brand colours from CSS variables
    const rootStyle = getComputedStyle(document.documentElement);
    let primary = rootStyle.getPropertyValue('--brand-from').trim();
    if (!primary) primary = '#3b82f6';
    const lighten = (hex, percent) => {
      const h = hex.replace('#','');
      const r = parseInt(h.substr(0,2), 16);
      const g = parseInt(h.substr(2,2), 16);
      const b = parseInt(h.substr(4,2), 16);
      const nr = Math.min(255, Math.round(r + (255 - r) * percent / 100));
      const ng = Math.min(255, Math.round(g + (255 - g) * percent / 100));
      const nb = Math.min(255, Math.round(b + (255 - b) * percent / 100));
      return '#' + [nr,ng,nb].map(x => x.toString(16).padStart(2,'0')).join('');
    };
    const darken = (hex, percent) => {
      const h = hex.replace('#','');
      const r = parseInt(h.substr(0,2), 16);
      const g = parseInt(h.substr(2,2), 16);
      const b = parseInt(h.substr(4,2), 16);
      const nr = Math.max(0, Math.round(r - r * percent / 100));
      const ng = Math.max(0, Math.round(g - g * percent / 100));
      const nb = Math.max(0, Math.round(b - b * percent / 100));
      return '#' + [nr,ng,nb].map(x => x.toString(16).padStart(2,'0')).join('');
    };
    const colors = {
      film: primary,
      aud: lighten(primary, 20),
      timeStart: darken(primary, 10),
      timeEnd: lighten(primary, 30),
      seats: lighten(primary, 40),
      util: darken(primary, 20)
    };
    // Build or update film chart
    const filmCanvas = document.getElementById('dashboardFilmTabCanvas');
    if (filmCanvas) {
      const ctx = filmCanvas.getContext('2d');
      if (filmChart) {
        filmChart.data.labels = filmLabels;
        filmChart.data.datasets[0].data = filmData;
        filmChart.update();
      } else {
        filmChart = new Chart(ctx, {
          type: 'bar',
          data: {
            labels: filmLabels,
            datasets: [{ label: 'Shows', data: filmData, backgroundColor: colors.film }]
          },
          options: {
            // Disable responsiveness so the chart respects the explicit canvas size
            responsive: false,
            maintainAspectRatio: false,
            indexAxis: 'y',
            scales: {
              x: { beginAtZero: true },
              y: { ticks: { autoSkip: false } }
            }
          }
        });
      }
    }
    // Build or update auditorium chart
    const audCanvas = document.getElementById('dashboardAudTabCanvas');
    if (audCanvas) {
      const ctx = audCanvas.getContext('2d');
      if (audChart) {
        audChart.data.labels = audLabels;
        audChart.data.datasets[0].data = audData;
        audChart.update();
      } else {
        audChart = new Chart(ctx, {
          type: 'bar',
          data: {
            labels: audLabels,
            datasets: [{ label: 'Shows', data: audData, backgroundColor: colors.aud }]
          },
          options: {
            responsive: false,
            maintainAspectRatio: false,
            indexAxis: 'y',
            scales: {
              x: { beginAtZero: true },
              y: { ticks: { autoSkip: false } }
            }
          }
        });
      }
    }
    // Build or update time distribution chart (start vs end vs seats)
    const timeCanvas = document.getElementById('dashboardTimeTabCanvas');
    if (timeCanvas) {
      const ctx = timeCanvas.getContext('2d');
      // Destroy any existing chart to properly reconfigure axes
      if (timeChart) { try { timeChart.destroy(); } catch (_) {} }
      timeChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: timeDist.labels,
          datasets: [
            {
              label: 'Starts',
              data: timeDist.starts,
              borderColor: colors.timeStart,
              backgroundColor: colors.timeStart,
              tension: 0.2,
              fill: false,
              yAxisID: 'y'
            },
            {
              label: 'Ends',
              data: timeDist.ends,
              borderColor: colors.timeEnd,
              backgroundColor: colors.timeEnd,
              tension: 0.2,
              fill: false,
              yAxisID: 'y'
            },
            {
              label: 'Seats',
              data: timeDist.seats,
              borderColor: colors.seats,
              backgroundColor: colors.seats,
              tension: 0.2,
              fill: false,
              yAxisID: 'y1'
            }
          ]
        },
        options: {
          responsive: false,
          maintainAspectRatio: false,
          scales: {
            y: {
              type: 'linear',
              position: 'left',
              beginAtZero: true,
              title: { display: true, text: 'Shows' }
            },
            y1: {
              type: 'linear',
              position: 'right',
              beginAtZero: true,
              title: { display: true, text: 'Seats' },
              grid: { drawOnChartArea: false }
            }
          },
          interaction: { intersect: false, mode: 'index' },
          plugins: { legend: { display: true } }
        }
      });
    }
    // Build or update utilisation chart
    const utilCanvas = document.getElementById('dashboardUtilTabCanvas');
    if (utilCanvas) {
      const ctx = utilCanvas.getContext('2d');
      if (utilChart) {
        utilChart.data.labels = utilLabelsLimited;
        utilChart.data.datasets[0].data = utilValsLimited;
        utilChart.update();
      } else {
        utilChart = new Chart(ctx, {
          type: 'bar',
          data: {
            labels: utilLabelsLimited,
            datasets: [{ label: 'Utilisation (%)', data: utilValsLimited, backgroundColor: colors.util }]
          },
          options: {
            responsive: false,
            maintainAspectRatio: false,
            scales: {
              y: {
                beginAtZero: true,
                max: 100,
                ticks: {
                  callback: value => value + '%'
                },
                title: { display: true, text: 'Utilisation (%)' }
              }
            },
            plugins: {
              tooltip: {
                callbacks: {
                  label: context => context.parsed.y.toFixed(1) + '%'
                }
              }
            }
          }
        });
      }
    }
    // Update issues summary in the util tab
    const summaryEl = document.getElementById('dashboardUtilIssues');
    if (summaryEl) {
      const parts = [];
      if (issueCounts.late) parts.push(`${issueCounts.late} late`);
      if (issueCounts.huge) parts.push(`${issueCounts.huge} huge gap${issueCounts.huge > 1 ? 's' : ''}`);
      if (issueCounts.gap) parts.push(`${issueCounts.gap} gap${issueCounts.gap > 1 ? 's' : ''}`);
      summaryEl.textContent = parts.length ? parts.join(' \u00b7 ') : 'No issues';
    }

    // Populate the flagged issues tab with detailed messages
    const issuesListEl = document.getElementById('dashboardIssuesList');
    if (issuesListEl) {
      // Clear existing list
      issuesListEl.innerHTML = '';
      const fullIssues = computeFlaggedIssues(shows);
      fullIssues.forEach(issue => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = `schedule-grid.html?jump=${encodeURIComponent(issue.audName)}`;
        a.textContent = issue.message;
        let colourClass = '';
        if (issue.type === 'late') {
          colourClass = 'text-blue-800';
        } else if (issue.type === 'gap') {
          colourClass = 'text-yellow-700';
        } else if (issue.type === 'huge') {
          colourClass = 'text-red-700';
        }
        a.className = `${colourClass} underline`;
        a.title = 'View in schedule';
        li.appendChild(a);
        issuesListEl.appendChild(li);
      });
      if (fullIssues.length === 0) {
        const li = document.createElement('li');
        li.className = 'text-green-700';
        li.textContent = 'No downtime or late-first issues detected.';
        issuesListEl.appendChild(li);
      }
    }
    // No need to adjust body padding for the floating popup
  }

  /**
   * Initialise the dashboard bar: insert toggle button, build the bar
   * structure with tabs and attach event listeners.  When the user
   * toggles the bar open, Chart.js is loaded on demand and charts are
   * rendered.  Updating is triggered whenever the date or show window
   * selectors change.
   */
  function initDashboardBar() {
    const nav = document.querySelector('nav');
    if (!nav) return;
    const controlsContainer = nav.querySelector('.nav-controls') || nav;
    // Avoid inserting multiple toggles
    if (document.getElementById('dashboardBarToggleBtn')) return;
    // Create toggle button
    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'dashboardBarToggleBtn';
    toggleBtn.textContent = 'Show Dashboard';
    toggleBtn.className = 'ml-2 px-3 py-1 bg-indigo-700 text-white rounded-lg hover:bg-indigo-800 text-sm';
    controlsContainer.appendChild(toggleBtn);

    // On load, restore the open state from localStorage.  If the user
    // previously had the dashboard bar open, automatically open it
    // immediately.  Use a short timeout to defer until after the bar is
    // attached, ensuring that applyBarState can access required
    // variables.  If localStorage is unavailable or the key is
    // missing, the bar will remain hidden by default.
    let _persistOpen = false;
    try {
      _persistOpen = localStorage.getItem(DASHBAR_OPEN_KEY) === '1';
    } catch (e) {
      _persistOpen = false;
    }
    if (_persistOpen) {
      // Defer to ensure DOM elements exist and Chart.js can be loaded.
      setTimeout(() => applyBarState(true), 0);
    }
    // Create bar container.  Instead of spanning the full width of the
    // page, this dashboard widget floats near the bottom-left of the
    // viewport.  The user can move it by dragging the header and
    // resize it via native browser handles.  Overflow is set to
    // "auto" so the resize handles appear and content can adjust.
    const bar = document.createElement('div');
    bar.id = 'dashboardBar';
    bar.className = 'hidden fixed bg-white border border-gray-300 shadow-lg z-50';
    // Default positioning and dimensions for the floating bar
    bar.style.left = '20px';
    bar.style.bottom = '20px';
    bar.style.width = '420px';
    bar.style.height = '320px';
    bar.style.resize = 'both';
    bar.style.overflow = 'auto';
    // Header with title and close button
    const header = document.createElement('div');
    header.className = 'flex justify-between items-center grad-header px-4 py-2';
    const title = document.createElement('span');
    title.textContent = 'Dashboard';
    title.className = 'font-semibold text-sm text-white';
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '\u00d7';
    closeBtn.className = 'text-white hover:text-gray-200';
    closeBtn.addEventListener('click', () => applyBarState(false));
    header.appendChild(title);
    header.appendChild(closeBtn);
    bar.appendChild(header);

    // Make the bar draggable by dragging the header.  This helper sets up
    // listeners on the header to update the bar’s left and bottom
    // position based on mouse movement.  We store the original
    // positions and adjust them as the cursor moves.  Dragging is
    // disabled when the mouse button is released.
    (function enableDrag(el, handle) {
      handle.style.cursor = 'move';
      let isDragging = false;
      let startX, startY, origLeft, origBottom;
      function onMove(ev) {
        if (!isDragging) return;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        // Update left and bottom positions.  Moving up (negative dy)
        // increases the bottom offset, while moving down decreases it.
        el.style.left = (origLeft + dx) + 'px';
        el.style.bottom = (origBottom - dy) + 'px';
      }
      function onUp() {
        if (!isDragging) return;
        isDragging = false;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      handle.addEventListener('mousedown', ev => {
        ev.preventDefault();
        isDragging = true;
        startX = ev.clientX;
        startY = ev.clientY;
        origLeft = parseFloat(el.style.left) || 0;
        origBottom = parseFloat(el.style.bottom) || 0;
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    })(bar, header);
    // Tabs header
    const tabHeader = document.createElement('div');
    tabHeader.className = 'flex border-b border-gray-300 text-sm';
    // Tab definitions
    const tabs = [
      { id: 'film', label: 'Films' },
      { id: 'aud', label: 'Auditoria' },
      { id: 'time', label: 'Start/End' },
      { id: 'util', label: 'Utilisation' },
      { id: 'issues', label: 'Issues' }
    ];
    tabs.forEach((tab, idx) => {
      const btn = document.createElement('button');
      btn.textContent = tab.label;
      btn.dataset.tabId = tab.id;
      btn.className = 'px-4 py-2 focus:outline-none border-r border-gray-200';
      if (idx === 0) btn.classList.add('font-semibold', 'bg-gray-100');
      btn.addEventListener('click', () => {
        // Switch active tab
        Array.from(tabHeader.children).forEach(child => child.classList.remove('font-semibold','bg-gray-100'));
        btn.classList.add('font-semibold','bg-gray-100');
        // Show/hide panels
        tabs.forEach(t => {
          const panel = document.getElementById('dashboardTabPanel-' + t.id);
          if (panel) panel.classList.add('hidden');
        });
        const active = document.getElementById('dashboardTabPanel-' + tab.id);
        if (active) active.classList.remove('hidden');
        // After switching, resize any chart in the newly visible panel so Chart.js recalculates dimensions
        setTimeout(() => {
          if (tab.id === 'film' && filmChart) filmChart.resize();
          if (tab.id === 'aud' && audChart) audChart.resize();
          if (tab.id === 'time' && timeChart) timeChart.resize();
          if (tab.id === 'util' && utilChart) utilChart.resize();
        }, 50);
      });
      tabHeader.appendChild(btn);
    });
    bar.appendChild(tabHeader);
    // Content area
    const content = document.createElement('div');
    content.className = 'p-4 h-full overflow-hidden';
    // Film tab panel
    const filmPanel = document.createElement('div');
    filmPanel.id = 'dashboardTabPanel-film';
    filmPanel.className = '';
    // Fix the height of each tab panel to match its canvas so it never grows
    filmPanel.style.height = '220px';
    // Add slight padding at the bottom to prevent chart cut‑off
    filmPanel.style.paddingBottom = '10px';
    const filmCanvas = document.createElement('canvas');
    filmCanvas.id = 'dashboardFilmTabCanvas';
    filmCanvas.setAttribute('height','220');
    filmPanel.appendChild(filmCanvas);
    content.appendChild(filmPanel);
    // Auditorium tab panel
    const audPanel = document.createElement('div');
    audPanel.id = 'dashboardTabPanel-aud';
    audPanel.className = 'hidden';
    audPanel.style.height = '220px';
    audPanel.style.paddingBottom = '10px';
    const audCanvas = document.createElement('canvas');
    audCanvas.id = 'dashboardAudTabCanvas';
    audCanvas.setAttribute('height','220');
    audPanel.appendChild(audCanvas);
    content.appendChild(audPanel);
    // Time tab panel
    const timePanel = document.createElement('div');
    timePanel.id = 'dashboardTabPanel-time';
    timePanel.className = 'hidden';
    timePanel.style.height = '220px';
    timePanel.style.paddingBottom = '10px';
    const timeCanvas = document.createElement('canvas');
    timeCanvas.id = 'dashboardTimeTabCanvas';
    timeCanvas.setAttribute('height','220');
    timePanel.appendChild(timeCanvas);
    content.appendChild(timePanel);
    // Utilisation tab panel
    const utilPanel = document.createElement('div');
    utilPanel.id = 'dashboardTabPanel-util';
    utilPanel.className = 'hidden flex flex-col';
    // Slightly taller to accommodate the summary text below the chart
    utilPanel.style.height = '220px';
    utilPanel.style.paddingBottom = '10px';
    const utilCanvas = document.createElement('canvas');
    utilCanvas.id = 'dashboardUtilTabCanvas';
    utilCanvas.setAttribute('height','180');
    utilPanel.appendChild(utilCanvas);
    const utilIssues = document.createElement('div');
    utilIssues.id = 'dashboardUtilIssues';
    utilIssues.className = 'text-sm mt-2';
    utilPanel.appendChild(utilIssues);
    content.appendChild(utilPanel);

    // Issues tab panel: displays a list of downtime gaps and late-first slots
    const issuesPanel = document.createElement('div');
    issuesPanel.id = 'dashboardTabPanel-issues';
    issuesPanel.className = 'hidden';
    // Fixed height and bottom padding like other panels; allow vertical scrolling within
    issuesPanel.style.height = '220px';
    issuesPanel.style.paddingBottom = '10px';
    issuesPanel.style.overflowY = 'auto';
    const issuesList = document.createElement('ul');
    issuesList.id = 'dashboardIssuesList';
    issuesList.className = 'list-disc pl-5 space-y-1 text-sm';
    issuesPanel.appendChild(issuesList);
    content.appendChild(issuesPanel);
    bar.appendChild(content);
    document.body.appendChild(bar);

    // Observe changes to the bar’s size and update charts accordingly.  When
    // the user resizes the floating popup, Chart.js needs to recalculate
    // its dimensions.  ResizeObserver provides a callback when the
    // element’s size changes.
    if (typeof ResizeObserver !== 'undefined') {
      const resizeObserver = new ResizeObserver(() => {
        if (bar.classList.contains('hidden')) return;
        if (filmChart) filmChart.resize();
        if (audChart) audChart.resize();
        if (timeChart) timeChart.resize();
        if (utilChart) utilChart.resize();
      });
      resizeObserver.observe(bar);
    }
    // Manage bar state
    function applyBarState(open) {
      if (open) {
        bar.classList.remove('hidden');
        toggleBtn.textContent = 'Hide Dashboard';
        // Remember open state in localStorage.  Wrapping in try/catch
        // guards against storage being unavailable (e.g. private mode).
        try {
          localStorage.setItem(DASHBAR_OPEN_KEY, '1');
        } catch (e) {}
        // Load Chart.js and update charts whenever the bar becomes visible.
        loadChartJs().then(() => {
          updateCharts();
        });
      } else {
        bar.classList.add('hidden');
        toggleBtn.textContent = 'Show Dashboard';
        // Persist closed state
        try {
          localStorage.setItem(DASHBAR_OPEN_KEY, '0');
        } catch (e) {}
      }
    }
    toggleBtn.addEventListener('click', () => {
      const hidden = bar.classList.contains('hidden');
      applyBarState(hidden);
    });
    // Listen for changes to global controls (date, first/last show) and
    // update charts when schedule state changes.
    function attachControlListeners() {
      const dateInput = document.getElementById('scheduleDateGlobal');
      if (dateInput) dateInput.addEventListener('change', () => updateCharts());
      const firstSel = document.getElementById('firstShowGlobalSelect');
      const lastSel = document.getElementById('lastShowGlobalSelect');
      if (firstSel) firstSel.addEventListener('change', () => updateCharts());
      if (lastSel) lastSel.addEventListener('change', () => updateCharts());
    }
    attachControlListeners();

    // Register listeners for application events so the dashboard bar
    // updates automatically whenever the schedule state changes or the
    // selected date changes.  These events are dispatched from
    // app.js when data is saved or the date is switched.  In addition,
    // listen to filmHighlightChange to update charts based on the
    // currently highlighted film.  Only update if the bar is
    // currently visible to avoid unnecessary work.
    window.addEventListener('showtimeStateUpdated', () => {
      if (!bar.classList.contains('hidden')) updateCharts();
    });
    window.addEventListener('showtimeDateChanged', () => {
      if (!bar.classList.contains('hidden')) updateCharts();
    });
    window.addEventListener('filmHighlightChange', () => {
      if (!bar.classList.contains('hidden')) updateCharts();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDashboardBar);
  } else {
    initDashboardBar();
  }
})();
