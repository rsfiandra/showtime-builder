// Data export/import functionality for Showtime Builder
// Provides buttons to export the entire state to JSON or a CSV of all shows,
// and to import a previously exported JSON file to restore the schedule.

function initDataControls() {
  const ShowtimeState = window.ShowtimeState;
  // Ensure state is loaded before interacting
  try { ShowtimeState.load(); } catch (e) { /* ignore if not present */ }

  const btnJson = document.getElementById('exportJsonBtn');
  const btnCsv = document.getElementById('exportCsvBtn');
  const inputFile = document.getElementById('importFileInput');

  const importTextBtn = document.getElementById('importTextBtn');
  const importTextArea = document.getElementById('importText');

  if (btnJson) {
    btnJson.addEventListener('click', () => {
      // Retrieve the full persisted state
      const data = ShowtimeState.state;
      const jsonStr = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'showtime-data.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  if (btnCsv) {
    btnCsv.addEventListener('click', () => {
      // Build a CSV across all dates containing movie title, film format, auditorium name,
      // start time and date. Sort by date then auditorium then start time.
      const state = ShowtimeState.state || {};
      const scheds = state.scheduleByDate && typeof state.scheduleByDate === 'object' ? Object.keys(state.scheduleByDate) : [];
      // If no schedules exist, simply export an empty CSV with headers.
      let records = [];
      const origDate = state.currentDate;
      // Iterate through each date, load its schedule and gather shows
      const dates = scheds.slice().sort();
      dates.forEach(date => {
        try {
          // Load schedule for this date without persisting changes.  This sets
          // state.currentDate and populates prime/extra rows and manual shows.
          ShowtimeState.loadSchedule(date);
          const shows = ShowtimeState.getAllShows ? ShowtimeState.getAllShows() : [];
          shows.forEach(rec => {
            records.push({ date, rec });
          });
        } catch (_) { /* ignore errors to avoid breaking the export */ }
      });
      // Restore original date
      if (origDate) {
        try {
          ShowtimeState.loadSchedule(origDate);
        } catch (_) {}
      }
      // Sort by date, then auditorium name, then start time
      records.sort((a, b) => {
        if (a.date < b.date) return -1;
        if (a.date > b.date) return 1;
        const aAud = (a.rec.audName || '').toLowerCase();
        const bAud = (b.rec.audName || '').toLowerCase();
        if (aAud < bAud) return -1;
        if (aAud > bAud) return 1;
        return (a.rec.start || 0) - (b.rec.start || 0);
      });
      // Build CSV header
      let csv = 'Movie,Format,Auditorium,Start Time,Date\n';
      const esc = (v) => {
        if (v == null) return '';
        const s = String(v);
        return s.includes(',') ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      records.forEach(item => {
        const { date, rec } = item;
        // Lookup film details by ID.  Fall back to rec.filmTitle if id not found.
        let filmTitle = rec.filmTitle || '';
        let filmFormat = '';
        try {
          if (ShowtimeState.state && Array.isArray(ShowtimeState.state.films)) {
            const film = ShowtimeState.state.films.find(f => f.id === rec.filmId);
            if (film) {
              filmTitle = film.title || filmTitle;
              filmFormat = film.format || '';
            }
          }
        } catch (_) {}
        const auditorium = rec.audName || '';
        // Convert start to 12‑hour time (e.g. 10:00am) using existing helper if available
        let startStr = '';
        try {
          startStr = ShowtimeState.to12 ? ShowtimeState.to12(rec.start) : '';
        } catch (_) {}
        csv += `${esc(filmTitle)},${esc(filmFormat)},${esc(auditorium)},${esc(startStr)},${esc(date)}\n`;
      });
      // Create and download the CSV file
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'showtime-schedule.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  if (inputFile) {
    inputFile.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function() {
        try {
          const data = JSON.parse(reader.result);
          if (data && typeof data === 'object') {
            // Persist the imported state directly into localStorage.  We avoid
            // calling ShowtimeState.save() here because it writes the internal
            // state variable (which we cannot mutate from this context) back to
            // storage, effectively discarding the imported data.  Writing
            // directly ensures that subsequent loads hydrate from the new state.
            try {
              localStorage.setItem('showtime:persist', JSON.stringify(data));
            } catch (_) {
              /* ignore storage errors */
            }
            // Update the externally exposed state property for completeness,
            // but note that most pages rely on the internal state loaded via
            // ShowtimeState.load(), so this assignment alone is insufficient.
            ShowtimeState.state = data;
            // Inform the user and reload the application to apply the imported data.
            alert('Data imported successfully. The application will reload to apply your changes.');
            setTimeout(() => {
              location.href = 'index.html';
            }, 200);
          } else {
            alert('Invalid JSON file.');
          }
        } catch (err) {
          alert('Failed to parse JSON: ' + err.message);
        }
      };
      reader.readAsText(file);
    });
  }

  if (importTextBtn && importTextArea) {
    importTextBtn.addEventListener('click', () => {
      const text = importTextArea.value.trim();
      if (!text) {
        alert('Please paste JSON into the textbox first.');
        return;
      }
      let data;
      try {
        data = JSON.parse(text);
      } catch (err) {
        alert('Invalid JSON: ' + err.message);
        return;
      }
      if (data && typeof data === 'object') {
        // Persist the imported state to localStorage without calling
        // ShowtimeState.save(). See file import handler for details.
        try {
          localStorage.setItem('showtime:persist', JSON.stringify(data));
        } catch (_) {
          /* ignore storage errors */
        }
        ShowtimeState.state = data;
        alert('Pasted data imported successfully. The application will reload to apply your changes.');
        setTimeout(() => {
          location.href = 'index.html';
        }, 200);
      } else {
        alert('JSON must be an object representing the saved state.');
      }
    });
  }

  // Handle clearing all schedules when the button exists. This resets
  // schedules across all dates while preserving auditoriums and bookings.
  const clearAllBtn = document.getElementById('clearAllSchedulesBtn');
  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', () => {
      if (!confirm('Are you sure you want to clear all schedules? This will remove all showtimes for every date.')) {
        return;
      }
      if (typeof ShowtimeState.clearAllSchedules === 'function') {
        ShowtimeState.clearAllSchedules();
        alert('All schedules have been cleared.');
        // Optionally reload the page to reflect the cleared state on schedule pages
        // but not necessary on the home page.
      } else {
        alert('Clear schedules function not available.');
      }
    });
  }

  // Handle clearing all bookings and showtimes when the button exists.
  // This removes every booking and resets schedule data across every date.
  // It preserves auditorium and film definitions but resets the state to a blank schedule and bookings list.
  const clearBookingsTimesBtn = document.getElementById('clearBookingsTimesBtn');
  if (clearBookingsTimesBtn) {
    clearBookingsTimesBtn.addEventListener('click', () => {
      if (!confirm('Are you sure you want to clear all bookings and showtimes? This will remove all bookings and showtimes across every date.')) {
        return;
      }
      if (typeof ShowtimeState.clearBookingsAndTimes === 'function') {
        ShowtimeState.clearBookingsAndTimes();
        alert('All bookings and showtimes have been cleared.');
        // Optionally reload page to reflect changes; omitted for home page.
      } else {
        alert('Clear bookings and times function not available.');
      }
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDataControls);
} else {
  initDataControls();
}

