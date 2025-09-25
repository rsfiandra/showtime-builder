// Dashboard page logic
// This script uses Chart.js to display summary statistics about the
// current day's schedule.  It creates bar charts for the number of shows
// per film, number of shows per auditorium, and a histogram of show
// start times by hour.  Charts update whenever the selected date
// changes.

(function() {
  const ShowtimeState = window.ShowtimeState;
  // Chart instances; retained so we can update data on refresh
  let filmChart = null;
  let audChart = null;
  let timeChart = null;
  let utilChart = null;
  // Chart for end time distribution
  let endTimeChart = null;

  // Threshold constants for downtime and late-first flagging
  const GAP_THRESHOLD_MIN = 45;
  const GAP_HUGE_MIN = 90;
  const FIT_SLOT_MIN = 105;

  /**
   * Normalize a date so that times before 5AM are considered part of the next day.
   * Mirrors the logic used in the schedule grid.
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
   * Format a duration in minutes to an HhMMm string (e.g. 1h30m).
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
   * Compute a list of flagged issues (downtime gaps and late-first slots) for the current schedule.
   * Issues are grouped by auditorium and returned as an array of objects with message and type.
   *
   * @returns {Array<{audName: string, type: string, message: string, minutes: number}>}
   */
  function computeFlaggedIssues() {
    const issues = [];
    if (!ShowtimeState) return issues;
    const shows = ShowtimeState.getAllShows() || [];
    const byAud = {};
    // Group by auditorium ID
    shows.forEach(rec => {
      const audId = rec.audId;
      if (!audId) return;
      if (!byAud[audId]) byAud[audId] = [];
      let endDate = rec.end;
      if (!endDate) {
        // Compute end from film if missing
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
    const firstHM = (ShowtimeState.state && ShowtimeState.state.firstShowHM) || '07:00';
    const windowStartRaw = ShowtimeState.dtFromHM ? ShowtimeState.dtFromHM(firstHM) : new Date();
    Object.keys(byAud).forEach(audId => {
      const list = byAud[audId];
      list.sort((a, b) => normalizeDateForGap(a.start) - normalizeDateForGap(b.start));
      if (!list.length) return;
      const audName = list[0].audName || `Aud ${audId}`;
      // Late-first slot
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
      // Consecutive gaps
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
    // Sort issues by descending minutes to prioritise largest gaps first
    issues.sort((a, b) => b.minutes - a.minutes);
    return issues;
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!ShowtimeState) return;
    // Initialise multi-date support
    ShowtimeState.initDateSupport();
    // Populate the first/last show selectors via header-controls.js (loaded separately)
    // Set up date input to update charts on change
    const dateInput = document.getElementById('scheduleDateGlobal');
    if (dateInput) {
      dateInput.addEventListener('change', () => {
        updateCharts();
      });
    }

    // Also re-render charts and flagged issues whenever the global first/last show selectors change.
    // The header-controls script updates state when these selectors change but does not
    // automatically trigger a dashboard refresh.  Attach listeners here to redraw
    // charts and recompute downtime messages on change.
    const firstSel = document.getElementById('firstShowGlobalSelect');
    const lastSel = document.getElementById('lastShowGlobalSelect');
    if (firstSel) {
      firstSel.addEventListener('change', () => {
        // The state is already updated by header-controls; call updateCharts
        updateCharts();
      });
    }
    if (lastSel) {
      lastSel.addEventListener('change', () => {
        updateCharts();
      });
    }
    // Listen for date changes triggered by other components (e.g., prev/next buttons).
    // Note: Previously we attached an event handler for `showtimeDateChanged` here.
    // However, loading the schedule and drawing charts inside this event can
    // trigger additional `showtimeDateChanged` events via ShowtimeState,
    // causing the dashboard to re-render continuously.  To avoid this loop,
    // we remove the global listener and rely on the date input change to
    // explicitly refresh the charts.  Users can still update the charts by
    // adjusting the date selector in the header.  If you wish to update
    // automatically when navigating dates via arrow buttons, you can
    // manually trigger `change` on the date input in header-controls.js.
    // Build initial charts
    updateCharts();
  });

  /**
   * Refresh chart data and update the dashboard charts. Reads all shows
   * scheduled for the current date and aggregates counts by film title,
   * auditorium name and start hour.  Charts are created lazily and
   * updated if they already exist.  Colours are drawn from the active
   * theme swatch (var(--brand-from)).
   */
  function updateCharts() {
    if (!ShowtimeState) return;
    // Do not call loadSchedule here to avoid triggering additional updates or
    // re-render loops.  The schedule for the current date should already
    // be loaded via header-controls or other page initialisation code.  Simply
    // read the shows from the current state.
    const shows = ShowtimeState.getAllShows() || [];
    // Count shows by film title
    const filmCounts = {};
    // Count shows by auditorium name
    const audCounts = {};
    // Count shows by hour (0-23)
    const hourCounts = {};
    shows.forEach(rec => {
      const filmName = rec.filmTitle || 'Unknown';
      filmCounts[filmName] = (filmCounts[filmName] || 0) + 1;
      const audName = rec.audName || 'Unassigned';
      audCounts[audName] = (audCounts[audName] || 0) + 1;
      const dt = rec.start instanceof Date ? rec.start : new Date(rec.start);
      const hr = dt.getHours();
      hourCounts[hr] = (hourCounts[hr] || 0) + 1;
    });
    // Sort film names by count descending
    const filmEntries = Object.entries(filmCounts).sort((a, b) => b[1] - a[1]);
    const audEntries = Object.entries(audCounts).sort((a, b) => b[1] - a[1]);
    // Prepare data for film chart
    const filmLabels = filmEntries.map(e => e[0]);
    const filmData = filmEntries.map(e => e[1]);
    // Prepare data for auditorium chart
    const audLabels = audEntries.map(e => e[0]);
    const audData = audEntries.map(e => e[1]);

    // Compute utilisation by auditorium.  For each auditorium we sum
    // the durations of scheduled shows (in minutes) and divide by the
    // total available window (from firstShowHM to lastShowHM).  The
    // result is a percentage (0-100).  We display these values on
    // a bar chart with a maximum value of 100.
    const utilLabels = [];
    const utilData = [];
    try {
      const state = ShowtimeState.state;
      // Determine total available minutes using current date's first/last shows.
      // Use ShowtimeState.state.firstShowHM/lastShowHM; fallback to schedule entry.
      let firstHM = (state && state.firstShowHM) || '07:00';
      let lastHM = (state && state.lastShowHM) || '23:00';
      // If scheduleByDate has an entry for current date with times, prefer those.
      const dateIso = ShowtimeState.getCurrentDate();
      if (dateIso && state.scheduleByDate && state.scheduleByDate[dateIso]) {
        const entry = state.scheduleByDate[dateIso];
        firstHM = entry.firstShowHM || firstHM;
        lastHM = entry.lastShowHM || lastHM;
      }
      const firstDate = ShowtimeState.dtFromHM(firstHM);
      const lastDate = ShowtimeState.dtFromHM(lastHM);
      let available = (lastDate - firstDate) / 60000; // minutes
      if (available <= 0) available += 24 * 60;
      // Initialize utilisation for each auditorium
      Object.keys(audCounts).forEach(audName => {
        utilLabels.push(audName);
        utilData.push(0);
      });
      // Map auditorium name to index in utilData
      const utilIndex = {};
      utilLabels.forEach((name, idx) => { utilIndex[name] = idx; });
      // Sum scheduled minutes for each show
      shows.forEach(rec => {
        const audName = rec.audName || 'Unassigned';
        const idx = utilIndex[audName];
        if (idx == null) return;
        const start = rec.start instanceof Date ? rec.start : new Date(rec.start);
        const end = rec.end instanceof Date ? rec.end : new Date(rec.end);
        let duration = (end - start) / 60000; // minutes
        if (duration < 0) duration = 0;
        utilData[idx] += duration;
      });
      // Convert to percentage of available time
      utilData.forEach((mins, idx) => {
        utilData[idx] = available > 0 ? Math.min(100, (mins / available) * 100) : 0;
      });
    } catch (_) {
      // On error, leave utilisation arrays empty
    }
    // Prepare data for time histogram: 0-23 hours; but show only hours with data.
    // Also compute total seating capacity per hour based on auditorium seats.
    const hrLabels = [];
    const hrData = [];
    const seatData = [];
    // Precompute seat counts per hour: sum of seats for shows starting in each hour.
    const seatCounts = {};
    shows.forEach(rec => {
      const dt = rec.start instanceof Date ? rec.start : new Date(rec.start);
      const hr = dt.getHours();
      let seats = 0;
      try {
        // Lookup auditorium to obtain seat count.  If audId is undefined, use 0.
        const audId = rec.audId;
        if (ShowtimeState.audById && audId != null) {
          const audObj = ShowtimeState.audById(audId);
          seats = audObj && audObj.seats != null ? parseInt(audObj.seats, 10) || 0 : 0;
        }
      } catch (_) {
        seats = 0;
      }
      seatCounts[hr] = (seatCounts[hr] || 0) + seats;
    });
    // Build sorted labels and data arrays.  Use the same sorting of hourCounts keys.
    Object.keys(hourCounts).sort((a, b) => parseInt(a) - parseInt(b)).forEach(hr => {
      const hNum = parseInt(hr);
      hrLabels.push(formatHour(hNum));
      hrData.push(hourCounts[hr]);
      seatData.push(seatCounts[hNum] || 0);
    });

    // Compute end time distribution by hour.  For each show, take the end time hour and
    // increment the count.  Use the same normalisation logic as for start times.
    const endHourCounts = {};
    shows.forEach(rec => {
      // Determine end time; if end is missing, compute from film runtime/trailer/clean
      let endTime = rec.end;
      if (!endTime || !(endTime instanceof Date)) {
        // compute fallback end time
        let film = null;
        if (rec.filmId && ShowtimeState.filmById) {
          try { film = ShowtimeState.filmById(rec.filmId); } catch (_) { film = null; }
        }
        const start = rec.start instanceof Date ? rec.start : new Date(rec.start);
        if (film) {
          const total = (film.runtime || 0) + (film.trailer || 0) + (film.clean || 0);
          endTime = new Date(start.getTime() + total * 60000);
        } else {
          endTime = new Date(start);
        }
      }
      const h = endTime.getHours();
      endHourCounts[h] = (endHourCounts[h] || 0) + 1;
    });
    const endHrLabels = [];
    const endHrData = [];
    Object.keys(endHourCounts).sort((a, b) => parseInt(a) - parseInt(b)).forEach(hr => {
      const hNum = parseInt(hr);
      endHrLabels.push(formatHour(hNum));
      endHrData.push(endHourCounts[hr]);
    });
    // Determine primary colour from CSS custom property
    const rootStyle = getComputedStyle(document.documentElement);
    let primary = rootStyle.getPropertyValue('--brand-from').trim();
    if (!primary) primary = '#3b82f6';
    const colors = {
      film: primary,
      aud: lightenColor(primary, 20),
      time: darkenColor(primary, 10)
    };

    // Derive a secondary colour for utilisation by further darkening the primary colour
    const utilColor = darkenColor(primary, 20);
    // Create or update film chart
    const filmCtx = document.getElementById('filmChart').getContext('2d');
    if (filmChart) {
      filmChart.data.labels = filmLabels;
      filmChart.data.datasets[0].data = filmData;
      filmChart.update();
    } else {
      filmChart = new Chart(filmCtx, {
        // Use a bar chart oriented horizontally.  Setting indexAxis to 'y'
        // swaps the axes so that film titles appear on the vertical axis
        // and the number of shows extends horizontally.  This provides
        // better readability for long film titles.
        type: 'bar',
        data: {
          labels: filmLabels,
          datasets: [
            {
              label: 'Shows',
              data: filmData,
              backgroundColor: colors.film
            }
          ]
        },
        options: {
          responsive: false,
          maintainAspectRatio: false,
          indexAxis: 'y',
          scales: {
            x: {
              beginAtZero: true,
              title: {
                display: true,
                text: 'Number of Shows'
              }
            },
            y: {
              ticks: {
                autoSkip: false
              },
              title: {
                display: true,
                text: 'Film'
              }
            }
          }
        }
      });
    }
    // Create or update auditorium chart
    const audCtx = document.getElementById('audChart').getContext('2d');
    if (audChart) {
      audChart.data.labels = audLabels;
      audChart.data.datasets[0].data = audData;
      audChart.update();
    } else {
      audChart = new Chart(audCtx, {
        type: 'bar',
        data: {
          labels: audLabels,
          datasets: [{
            label: 'Shows',
            data: audData,
            backgroundColor: colors.aud
          }]
        },
        options: {
          responsive: false,
          maintainAspectRatio: false,
          scales: {
            x: { ticks: { autoSkip: false } },
            y: { beginAtZero: true }
          }
        }
      });
    }
    // Create or update the start time distribution chart as a line chart with two datasets:
    // one for the count of shows and one for total seats per hour.  We destroy any
    // existing chart to ensure the type change (from bar to line) takes effect.
    const timeCtx = document.getElementById('timeChart').getContext('2d');
    // Derive a distinct colour for the seats line by lightening the primary colour further.
    const seatColor = lightenColor(primary, 40);
    if (timeChart) {
      try {
        timeChart.destroy();
      } catch (_) {
        // Ignore if destroy fails
      }
      timeChart = null;
    }
    timeChart = new Chart(timeCtx, {
      type: 'line',
      data: {
        labels: hrLabels,
        datasets: [
          {
            label: 'Shows',
            data: hrData,
            borderColor: colors.time,
            backgroundColor: colors.time,
            tension: 0.2,
            fill: false,
            pointRadius: 3,
            pointHoverRadius: 4,
            yAxisID: 'y'
          },
          {
            label: 'Seats',
            data: seatData,
            borderColor: seatColor,
            backgroundColor: seatColor,
            tension: 0.2,
            fill: false,
            pointRadius: 3,
            pointHoverRadius: 4,
            yAxisID: 'y1'
          }
        ]
      },
        options: {
        // Make the start time chart responsive so it expands horizontally based on
        // the container width.  Maintain the aspect ratio setting so the height
        // remains controlled by the canvas attribute.
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            type: 'linear',
            position: 'left',
            beginAtZero: true,
            title: {
              display: true,
              text: 'Shows'
            }
          },
          y1: {
            type: 'linear',
            position: 'right',
            beginAtZero: true,
            title: {
              display: true,
              text: 'Seats'
            },
            grid: {
              drawOnChartArea: false
            }
          }
        },
        interaction: {
          intersect: false,
          mode: 'index'
        },
        plugins: {
          legend: {
            display: true
          }
        }
      }
    });

    // Create or update end time distribution chart.  Use a single dataset for
    // the number of shows ending in each hour.  Use a darker shade of the
    // primary colour to differentiate this chart from the start time chart.
    const endCtx = document.getElementById('endTimeChart');
    if (endCtx) {
      const endCtx2d = endCtx.getContext('2d');
      // Choose colour by further darkening the primary colour
      const endColor = darkenColor(primary, 30);
      if (endTimeChart) {
        try {
          endTimeChart.destroy();
        } catch (_) {}
        endTimeChart = null;
      }
      endTimeChart = new Chart(endCtx2d, {
        type: 'line',
        data: {
          labels: endHrLabels,
          datasets: [
            {
              label: 'End Times',
              data: endHrData,
              borderColor: endColor,
              backgroundColor: endColor,
              tension: 0.2,
              fill: false,
              pointRadius: 3,
              pointHoverRadius: 4
            }
          ]
        },
        options: {
          // Make the end time chart responsive so it expands horizontally with its parent
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: {
              beginAtZero: true,
              title: {
                display: true,
                text: 'End Times'
              }
            }
          },
          interaction: {
            intersect: false,
            mode: 'index'
          },
          plugins: {
            legend: {
              display: true
            }
          }
        }
      });
    }

    // Create or update utilisation chart
    const utilCtx = document.getElementById('utilChart').getContext('2d');
    if (utilChart) {
      utilChart.data.labels = utilLabels;
      utilChart.data.datasets[0].data = utilData;
      utilChart.update();
    } else {
      utilChart = new Chart(utilCtx, {
        type: 'bar',
        data: {
          labels: utilLabels,
          datasets: [{
            label: 'Utilisation (%)',
            data: utilData,
            backgroundColor: utilColor
          }]
        },
        options: {
          responsive: false,
          maintainAspectRatio: false,
          scales: {
            y: {
              beginAtZero: true,
              max: 100,
              ticks: {
                callback: function(value) { return value + '%'; }
              }
            }
          },
          plugins: {
            tooltip: {
              callbacks: {
                label: function(context) {
                  return context.parsed.y.toFixed(1) + '%';
                }
              }
            }
          }
        }
      });
    }

    // After all charts have been updated, compute flagged issues (gaps and late first shows)
    // and populate the flagged list.  This runs every time charts refresh so the
    // messages reflect the latest first/last show window and schedule data.
    try {
      const flaggedContainer = document.getElementById('flaggedList');
      if (flaggedContainer) {
        // Clear existing messages
        flaggedContainer.innerHTML = '';
        const issues = computeFlaggedIssues();
        issues.forEach(issue => {
          const li = document.createElement('li');
          // Determine colour based on issue type for the link itself.
          let colourClass = '';
          if (issue.type === 'late') {
            colourClass = 'text-blue-800';
          } else if (issue.type === 'gap') {
            colourClass = 'text-yellow-700';
          } else if (issue.type === 'huge') {
            colourClass = 'text-red-700';
          }
          // Create an anchor that links to the schedule grid with a jump parameter
          const a = document.createElement('a');
          a.href = `schedule-grid.html?jump=${encodeURIComponent(issue.audName)}`;
          a.textContent = issue.message;
          a.className = `${colourClass} underline`; 
          a.title = 'View in schedule';
          li.appendChild(a);
          flaggedContainer.appendChild(li);
        });
        // If no issues found, display a subtle message indicating all clear
        if (issues.length === 0) {
          const li = document.createElement('li');
          li.className = 'text-green-700';
          li.textContent = 'No downtime or late-first issues detected.';
          flaggedContainer.appendChild(li);
        }
      }
    } catch (err) {
      // Silently ignore errors during flagged issues computation
      console.error(err);
    }
  }

  /**
   * Format an hour integer into a 12-hour clock label (e.g. 0 -> 12a, 13 -> 1p)
   *
   * @param {number} h
   * @returns {string}
   */
  function formatHour(h) {
    const hour12 = ((h + 11) % 12) + 1;
    return hour12 + (h < 12 ? 'a' : 'p');
  }

  /**
   * Lighten a hex colour by the given percentage (0-100).  Returns a
   * new hex string.  If the input is not a 3- or 6-digit hex string,
   * returns the original colour.
   */
  function lightenColor(hex, percent) {
    const c = parseHex(hex);
    if (!c) return hex;
    const [r, g, b] = c;
    const newR = Math.min(255, Math.round(r + (255 - r) * percent / 100));
    const newG = Math.min(255, Math.round(g + (255 - g) * percent / 100));
    const newB = Math.min(255, Math.round(b + (255 - b) * percent / 100));
    return rgbToHex(newR, newG, newB);
  }

  /**
   * Darken a hex colour by the given percentage (0-100).  Returns a
   * new hex string.  If the input is not a 3- or 6-digit hex string,
   * returns the original colour.
   */
  function darkenColor(hex, percent) {
    const c = parseHex(hex);
    if (!c) return hex;
    const [r, g, b] = c;
    const newR = Math.max(0, Math.round(r - r * percent / 100));
    const newG = Math.max(0, Math.round(g - g * percent / 100));
    const newB = Math.max(0, Math.round(b - b * percent / 100));
    return rgbToHex(newR, newG, newB);
  }

  /**
   * Parse a hex colour string into RGB components.  Supports 3- or 6- digit
   * hex with optional leading '#'.  Returns [r,g,b] or null on failure.
   */
  function parseHex(hex) {
    let h = hex.replace('#', '').trim();
    if (h.length === 3) {
      h = h[0]+h[0] + h[1]+h[1] + h[2]+h[2];
    }
    if (h.length !== 6) return null;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    if ([r,g,b].some(isNaN)) return null;
    return [r, g, b];
  }
  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
  }
})();