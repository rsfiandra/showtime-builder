// Bookings page logic
// Access global ShowtimeState via window
const ShowtimeState = window.ShowtimeState;

// Global flag used to suppress full re-renders during tab navigation. When
// isTabbing is true, blur/change handlers update state without calling
// render() so that focus is preserved when the user presses Tab.
let isTabbing = false;

// Timer handle used to detect the end of a tabbing sequence. When the
// user repeatedly presses Tab to move through inputs, we keep
// isTabbing true and only allow a re-render once no Tab key has
// been pressed for a short delay.  This prevents intermediate blur
// events from triggering a re-render and stealing focus.
let tabResetTimer = null;

document.addEventListener('DOMContentLoaded', () => {
  const addBtn = document.getElementById('addBookingBtn');
  // Button to clear all bookings and reset to a single blank row
  const clearBtn = document.getElementById('clearBookingsBtn');
  const body = document.getElementById('bookingBody');

  // Hide the Add Booking button: we always keep a blank row at the bottom
  if (addBtn) {
    addBtn.style.display = 'none';
  }

  // Attach clear bookings handler
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      // Remove all bookings and associated prime/extra rows.  We also
      // remove any overrides and manual shows tied to prime rows.  The
      // caller wants a fresh start with a single blank booking row.
      const state = ShowtimeState.state;
      state.bookings = [];
      // Clear primeRows and extraRows so no leftover films remain on the
      // prime schedule when starting over.  Without clearing extraRows
      // you could see old entries (e.g. Moon Harbor) linger after
      // clearing bookings.
      state.primeRows = [];
      state.extraRows = [];
      // It’s also safe to clear overrides that reference prime show ids
      // since those ids will be regenerated from bookings.  Manual
      // shows remain untouched to preserve any independent edits.
      if (state.overrides && typeof state.overrides === 'object') {
        Object.keys(state.overrides).forEach(key => {
          // If the override key references a prime row id (starts with
          // "PRB-" or "EX-") remove it.  Overrides for manual shows
          // (ids with colon) are preserved.
          if (/^(PRB-|EX-)/.test(key.split(':')[0])) {
            delete state.overrides[key];
          }
        });
      }
      ShowtimeState.save();
      ensurePrimeRows();
      // Re-render will detect no bookings and append a blank row
      render();
      // Refresh the film highlight dropdown after clearing bookings so that
      // old film names are removed immediately.  Without this call the
      // highlight dropdown may still include films whose bookings were just cleared.
      try {
        if (typeof window.refreshFilmHighlightOptions === 'function') {
          window.refreshFilmHighlightOptions();
        }
        if (typeof window.applyFilmHighlight === 'function') {
          window.applyFilmHighlight();
        }
      } catch (e) {
        /* ignore */
      }
    });
  }

  // Ensure prime rows mirror bookings with films assigned. Keep existing
  // auditorium and prime time assignments where possible.
  function ensurePrimeRows() {
    const state = ShowtimeState.state;
    const currentMap = new Map((state.primeRows || []).map(r => [r.bookingId, r]));
    const newPrimeRows = [];
    state.bookings.forEach(b => {
      // Only include bookings whose film exists and has a non-empty title.  This
      // prevents blank rows from appearing on the prime schedule until a
      // film title is provided.
      if (!b.filmId) return;
      const film = ShowtimeState.filmById(b.filmId);
      if (!film || !film.title) return;
      const existing = currentMap.get(b.id);
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
    // Dispatch a storage event so other pages (prime/schedule) update immediately.  The
    // storage event normally only fires across windows, so we trigger it manually
    // here after saving state.  This keeps the prime schedule in sync when a
    // booking's film or slot changes.
    try {
      const evt = new Event('storage');
      window.dispatchEvent(evt);
    } catch {}
  }

  function render() {
    const state = ShowtimeState.state;
    // Always sort bookings by numeric slot ascending before rendering
    state.bookings.sort((a, b) => {
      const sa = parseInt(a.slot, 10);
      const sb = parseInt(b.slot, 10);
      // Fallback to string comparison if parse fails
      if (!isNaN(sa) && !isNaN(sb)) return sa - sb;
      return String(a.slot).localeCompare(String(b.slot));
    });

    // Maintain exactly one blank row: check for bookings whose film title is empty.
    // Blank rows are those whose associated film has an empty title (or film record missing).
    let blankIndices = [];
    state.bookings.forEach((b, idx) => {
      const film = ShowtimeState.filmById(b.filmId);
      if (!film || !film.title) {
        blankIndices.push(idx);
      }
    });
    // Remove extra blank rows, keeping only the first found blank row
    if (blankIndices.length > 1) {
      // Remove from the end to avoid index shift
      for (let i = blankIndices.length - 1; i >= 1; i--) {
        const removeIndex = blankIndices[i];
        state.bookings.splice(removeIndex, 1);
      }
      ShowtimeState.save();
      ensurePrimeRows();
      // Recalculate blankIndices after removal
      blankIndices = [blankIndices[0]];
    }
    // If no blank rows exist, append one
    if (blankIndices.length === 0) {
      const filmId = `F${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      // Do not prefill priority; leave blank
      state.films.push({ id: filmId, title: '', runtime: 0, trailer: 20, priority: '', rating: '', clean: 20, format: '' });
      // Determine the next slot number as one greater than the maximum existing slot number
      let maxSlot = 0;
      state.bookings.forEach(b => {
        const n = parseInt(b.slot, 10);
        if (!isNaN(n) && n > maxSlot) maxSlot = n;
      });
      const nextSlot = String(maxSlot + 1 || 1);
      const bookingId = `B${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      // Do not prefill week or weeksOut; leave blank values
      state.bookings.push({ id: bookingId, week: '', slot: nextSlot, filmId: filmId, notes: '', weeksOut: '' });
      ShowtimeState.save();
      ensurePrimeRows();
    }
    body.innerHTML = '';
    // Maintain a running tabindex across all rows.  Assigning explicit tab
    // indices ensures that pressing Tab will move left‑to‑right through
    // inputs on a row and then down to the next row.  Without explicit
    // indices, the DOM insertion order can lead to unexpected jumps.
    let tabCounter = 1;
    state.bookings.forEach(b => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-gray-50';
      // Delete action cell with trash icon button
      const tdDelete = document.createElement('td');
      tdDelete.className = 'px-2 py-2 text-center navcell';
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'delete-booking-btn text-red-600 hover:text-red-800';
      delBtn.setAttribute('aria-label', 'Delete booking');
      delBtn.title = 'Delete booking';
      delBtn.innerText = '🗑️';
      delBtn.tabIndex = tabCounter++;
      delBtn.addEventListener('click', () => {
        const state = ShowtimeState.state;
        const idx = state.bookings.findIndex(item => item.id === b.id);
        if (idx === -1) {
          return;
        }
        const [removed] = state.bookings.splice(idx, 1);
        const primeRow = Array.isArray(state.primeRows) ? state.primeRows.find(row => row.bookingId === b.id) : null;
        const rowId = primeRow && primeRow.rowId ? String(primeRow.rowId) : `PRB-${b.id}`;
        if (Array.isArray(state.manualShows)) {
          state.manualShows = state.manualShows.filter(ms => ms && ms.rowId !== rowId);
        }
        if (state.overrides && typeof state.overrides === 'object') {
          Object.keys(state.overrides).forEach(key => {
            if (key && key.startsWith(`${rowId}:`)) {
              delete state.overrides[key];
            }
          });
        }
        if (removed && removed.filmId) {
          const filmId = removed.filmId;
          const stillUsedInBookings = state.bookings.some(item => item && item.filmId === filmId);
          const usedInExtraRows = Array.isArray(state.extraRows) && state.extraRows.some(row => row && row.filmId === filmId);
          const usedInManualShows = Array.isArray(state.manualShows) && state.manualShows.some(ms => ms && ms.filmId === filmId);
          if (!stillUsedInBookings && !usedInExtraRows && !usedInManualShows && Array.isArray(state.films)) {
            const filmIdx = state.films.findIndex(f => f && f.id === filmId);
            if (filmIdx >= 0) {
              state.films.splice(filmIdx, 1);
            }
          }
        }
        ShowtimeState.save();
        ensurePrimeRows();
        render();
      });
      tdDelete.appendChild(delBtn);
      tr.appendChild(tdDelete);
      // Look up film record; if missing, create a placeholder
      let film = ShowtimeState.filmById(b.filmId);
      if (!film && b.filmId) {
        // if film id is unknown, create placeholder record in memory (will not persist until changed)
        // Leave priority blank so the Priority column is not auto‑populated for unknown films
        film = { id: b.filmId, title: '', runtime: 0, trailer: 20, priority: '', rating: '', clean: 20, format: '' };
      }
      // Slot input (move to the beginning of the row so the Slot column appears first)
      const tdSlot = document.createElement('td');
      // Add navcell class for keyboard navigation highlight
      tdSlot.className = 'px-3 py-2 navcell';
      const inputSlot = document.createElement('input');
      inputSlot.type = 'text';
      inputSlot.value = b.slot;
      inputSlot.className = 'border border-gray-300 rounded px-2 py-1 w-12';
      inputSlot.tabIndex = tabCounter++;
      inputSlot.addEventListener('change', () => {
        b.slot = inputSlot.value;
        ShowtimeState.save();
        ensurePrimeRows();
        if (!isTabbing) {
          render();
        }
      });
      tdSlot.appendChild(inputSlot);
      tr.appendChild(tdSlot);

      // Title input
      const tdTitle = document.createElement('td');
      tdTitle.className = 'px-3 py-2 navcell';
      const inputTitle = document.createElement('input');
      inputTitle.type = 'text';
      inputTitle.value = film ? film.title : '';
      inputTitle.className = 'border border-gray-300 rounded px-2 py-1 w-40';
      // assign a tabindex so that this field appears in sequence
      inputTitle.tabIndex = tabCounter++;
      // Rely on native Tab behaviour for the title field.  Explicitly assigning
      // sequential tabIndex values across all inputs ensures that the focus
      // order moves left‑to‑right across a row and down to the next row when
      // the Tab key is pressed.  We avoid intercepting Tab on the title
      // field to allow the browser to manage focus naturally.
      inputTitle.addEventListener('blur', () => {
        // When the title field loses focus, update the film record.  If the
        // booking previously had no filmId (legacy blank row), create a new
        // film record and assign it.  This allows the user to fill in a
        // blank title and have it persist rather than disappear on blur.
        const titleVal = inputTitle.value.trim();
        if (!b.filmId) {
          if (titleVal) {
            // Create a new film record with reasonable defaults and assign it
            const newFilmId = `F${Date.now()}-${Math.floor(Math.random() * 1000)}`;
            const newFilm = {
              id: newFilmId,
              title: titleVal,
              runtime: film ? film.runtime || 0 : 0,
              trailer: film ? film.trailer || 20 : 20,
              // Do not prefill priority; carry over from placeholder if defined, otherwise leave blank
              priority: (film && film.priority !== undefined && film.priority !== '' && film.priority !== null) ? film.priority : '',
              rating: film ? film.rating || '' : '',
              clean: film ? film.clean || 20 : 20,
              // carry over format from placeholder film if present
              format: film && film.format ? film.format : ''
            };
            ShowtimeState.state.films.push(newFilm);
            b.filmId = newFilmId;
            ShowtimeState.save();
            ensurePrimeRows();
            // Only re-render if not tabbing; otherwise focus will be lost
            if (!isTabbing) {
              render();
            }
          }
          return;
        }
        // Otherwise update the existing film record.  If the title is blank,
        // clear it out so that ensurePrimeRows() will remove the corresponding
        // prime row.
        const f = ShowtimeState.state.films.find(x => x.id === b.filmId);
        if (f) {
          f.title = titleVal;
          ShowtimeState.save();
          ensurePrimeRows();
          // Only re-render if not tabbing
          if (!isTabbing) {
            render();
          }
        }
      });
      tdTitle.appendChild(inputTitle);
      tr.appendChild(tdTitle);

      // Format input (e.g., 2D, 3D)
      const tdFormat = document.createElement('td');
      tdFormat.className = 'px-3 py-2 navcell';
      const inputFormat = document.createElement('input');
      inputFormat.type = 'text';
      // Use film.format if present; otherwise empty string
      inputFormat.value = film && film.format ? film.format : '';
      inputFormat.className = 'border border-gray-300 rounded px-2 py-1 w-20';
      inputFormat.tabIndex = tabCounter++;
      inputFormat.addEventListener('blur', () => {
        const val = inputFormat.value.trim();
        // If a film record exists, update its format
        if (b.filmId) {
          const f = ShowtimeState.state.films.find(x => x.id === b.filmId);
          if (f) {
            f.format = val;
            ShowtimeState.save();
            // Only re-render if not tabbing
            if (!isTabbing) {
              render();
            }
          }
        } else {
          // No film record yet (blank row). Update placeholder film object so
          // that when a title is entered later, the new film picks up this format.
          if (film) {
            film.format = val;
          }
        }
      });
      tdFormat.appendChild(inputFormat);
      tr.appendChild(tdFormat);
      // Runtime input (minutes)
      const tdRuntime = document.createElement('td');
      tdRuntime.className = 'px-3 py-2 navcell';
      const inputRt = document.createElement('input');
      inputRt.type = 'number';
      inputRt.value = film ? film.runtime : 0;
      inputRt.className = 'border border-gray-300 rounded px-2 py-1 w-20';
      inputRt.tabIndex = tabCounter++;
      inputRt.addEventListener('blur', () => {
        if (!b.filmId) return;
        const f = ShowtimeState.state.films.find(x => x.id === b.filmId);
        if (f) {
          const num = parseInt(inputRt.value || '0', 10);
          f.runtime = isNaN(num) ? 0 : num;
          ShowtimeState.save();
          if (!isTabbing) {
            render();
          }
        }
      });
      tdRuntime.appendChild(inputRt);
      tr.appendChild(tdRuntime);
      // Trailer input (minutes)
      const tdTrailer = document.createElement('td');
      tdTrailer.className = 'px-3 py-2 navcell';
      const inputTrailer = document.createElement('input');
      inputTrailer.type = 'number';
      inputTrailer.value = film ? (film.trailer || 0) : 0;
      inputTrailer.className = 'border border-gray-300 rounded px-2 py-1 w-20';
      inputTrailer.tabIndex = tabCounter++;
      inputTrailer.addEventListener('blur', () => {
        if (!b.filmId) return;
        const f = ShowtimeState.state.films.find(x => x.id === b.filmId);
        if (f) {
          const num = parseInt(inputTrailer.value || '0', 10);
          f.trailer = isNaN(num) ? 0 : num;
          ShowtimeState.save();
          if (!isTabbing) {
            render();
          }
        }
      });
      tdTrailer.appendChild(inputTrailer);
      tr.appendChild(tdTrailer);
      // Priority input
      const tdPriority = document.createElement('td');
      tdPriority.className = 'px-3 py-2 navcell';
      const inputPriority = document.createElement('input');
      inputPriority.type = 'number';
      // Do not default priority to 1.  Use an empty string when undefined or blank
      if (film && film.priority !== undefined && film.priority !== '' && film.priority !== null) {
        inputPriority.value = film.priority;
      } else {
        inputPriority.value = '';
      }
      inputPriority.className = 'border border-gray-300 rounded px-2 py-1 w-16';
      inputPriority.tabIndex = tabCounter++;
      inputPriority.addEventListener('blur', () => {
        if (!b.filmId) return;
        const f = ShowtimeState.state.films.find(x => x.id === b.filmId);
        if (f) {
          // If the input is blank or not a number, clear the priority so that
          // the Priority column is not auto-filled.  Otherwise set the numeric value.
          const val = (inputPriority.value || '').trim();
          const num = parseInt(val, 10);
          if (val === '' || isNaN(num)) {
            f.priority = '';
          } else {
            f.priority = num;
          }
          ShowtimeState.save();
          if (!isTabbing) {
            render();
          }
        }
      });
      tdPriority.appendChild(inputPriority);
      tr.appendChild(tdPriority);
      // Rating input
      const tdRating = document.createElement('td');
      tdRating.className = 'px-3 py-2 navcell';
      const inputRating = document.createElement('input');
      inputRating.type = 'text';
      inputRating.value = film ? (film.rating || '') : '';
      inputRating.className = 'border border-gray-300 rounded px-2 py-1 w-16';
      inputRating.tabIndex = tabCounter++;
      inputRating.addEventListener('blur', () => {
        if (!b.filmId) return;
        const f = ShowtimeState.state.films.find(x => x.id === b.filmId);
        if (f) {
          f.rating = inputRating.value;
          ShowtimeState.save();
          if (!isTabbing) {
            render();
          }
        }
      });
      tdRating.appendChild(inputRating);
      tr.appendChild(tdRating);
      // Notes input
      const tdNotes = document.createElement('td');
      tdNotes.className = 'px-3 py-2 navcell';
      const inputNotes = document.createElement('input');
      inputNotes.type = 'text';
      inputNotes.value = b.notes || '';
      inputNotes.className = 'border border-gray-300 rounded px-2 py-1 w-40';
      inputNotes.tabIndex = tabCounter++;
      inputNotes.addEventListener('change', () => {
        b.notes = inputNotes.value;
        ShowtimeState.save();
        if (!isTabbing) {
          render();
        }
      });
      tdNotes.appendChild(inputNotes);
      tr.appendChild(tdNotes);
      // Weeks Out input
      const tdWeeks = document.createElement('td');
      tdWeeks.className = 'px-3 py-2 navcell';
      const inputWeeks = document.createElement('input');
      inputWeeks.type = 'number';
      // Do not default weeksOut to 1; leave empty if undefined or blank.
      if (b.weeksOut !== undefined && b.weeksOut !== '' && b.weeksOut !== null) {
        inputWeeks.value = b.weeksOut;
      } else {
        inputWeeks.value = '';
      }
      inputWeeks.className = 'border border-gray-300 rounded px-2 py-1 w-16';
      inputWeeks.tabIndex = tabCounter++;
      inputWeeks.addEventListener('change', () => {
        // When weeksOut is changed, if the input is blank or invalid, clear it.
        const val = (inputWeeks.value || '').trim();
        const num = parseInt(val, 10);
        if (val === '' || isNaN(num)) {
          b.weeksOut = '';
        } else {
          b.weeksOut = num;
        }
        ShowtimeState.save();
        if (!isTabbing) {
          render();
        }
      });
      tdWeeks.appendChild(inputWeeks);
      tr.appendChild(tdWeeks);
      // Clean input
      const tdClean = document.createElement('td');
      tdClean.className = 'px-3 py-2 navcell';
      const inputClean = document.createElement('input');
      inputClean.type = 'number';
      inputClean.value = film ? (film.clean || 0) : 0;
      inputClean.className = 'border border-gray-300 rounded px-2 py-1 w-20';
      inputClean.tabIndex = tabCounter++;
      inputClean.addEventListener('blur', () => {
        if (!b.filmId) return;
        const f = ShowtimeState.state.films.find(x => x.id === b.filmId);
        if (f) {
          const num = parseInt(inputClean.value || '0', 10);
          f.clean = isNaN(num) ? 0 : num;
          ShowtimeState.save();
          if (!isTabbing) {
            render();
          }
        }
      });
      tdClean.appendChild(inputClean);
      tr.appendChild(tdClean);
      // Tag this row with a filmId if the film exists and has a title.  This
      // allows applyFilmHighlight() to highlight rows matching the selected film.
      if (film && film.id && film.title) {
        tr.dataset.filmid = String(film.id);
      }
      body.appendChild(tr);
    });

    // After rendering all rows, attach custom Tab handlers.  Using
    // assignTabHandlers() allows us to intercept Tab presses on each
    // input and update state before shifting focus.  Without this,
    // default browser Tab behaviour can be disrupted by our blur
    // handlers which trigger re‑renders.  assignTabHandlers uses the
    // document order of inputs to move focus horizontally across the
    // row and then down to the next row.
    assignTabHandlers();

    // Update the film highlight dropdown options in case films were added or
    // removed during this render.  This function is defined in app.js
    // and safe to call if undefined.
    if (typeof window.refreshFilmHighlightOptions === 'function') {
      window.refreshFilmHighlightOptions();
    }

    // Apply film highlighting after the rows have been constructed.  This
    // ensures that newly added or modified rows are highlighted (or
    // unhighlighted) according to the current selection.  The function
    // is defined in app.js and safely no-ops if undefined.
    if (typeof window.applyFilmHighlight === 'function') {
      window.applyFilmHighlight();
    }
  }

  addBtn.addEventListener('click', () => {
    const state = ShowtimeState.state;
    // Create a new film with default values
    const filmId = `F${Date.now()}-${Math.floor(Math.random()*1000)}`;
    // Do not prefill priority when adding a new row via the Add button
    state.films.push({ id: filmId, title: '', runtime: 0, trailer: 20, priority: '', rating: '', clean: 20, format: '' });
    const nextSlot = String(state.bookings.length + 1);
    const bookingId = `B${Date.now()}-${Math.floor(Math.random()*1000)}`;
    // Do not prefill week or weeksOut when adding a new booking; leave blank
    state.bookings.push({ id: bookingId, week: '', slot: nextSlot, filmId: filmId, notes: '', weeksOut: '' });
    ShowtimeState.save();
    ensurePrimeRows();
    render();
  });

  // When the underlying state changes (e.g. from another tab), we
  // refresh prime rows and re-render.  However, if a tabbing
  // operation is underway on this page, skip the re-render to
  // preserve focus order.  The assignTabHandlers logic will
  // eventually call render() at a safe time after tabbing completes.
  window.addEventListener('storage', () => {
    ensurePrimeRows();
    if (!isTabbing) {
      render();
    }
  });
  render();

  // The body keydown listener used in earlier versions to toggle the
  // isTabbing flag on Tab presses is removed.  assignTabHandlers
  // manages tabbing sessions explicitly and schedules re-renders once
  // the user has paused tab navigation.

  // Define helper to assign custom Tab behaviour to inputs. This
  // function collects all input and select elements within the
  // bookings table body and intercepts Tab key presses to update
  // state and manually move focus. When isTabbing is true, input
  // change/blur handlers will skip the full re-render, preserving
  // focus across fields.
  function assignTabHandlers() {
    const fields = body.querySelectorAll('input, select, button.delete-booking-btn');
    // Build an array of row objects to map inputs/selects to their row
    // and column positions.  rowsArr keeps the order of rows as they
    // appear in the DOM and records all editable fields per row.  This
    // structure is used by the ArrowDown handlers to navigate to the
    // same column on the next row.
    const rowsArr = [];
    fields.forEach((el, idx) => {
      const tr = el.closest('tr');
      let row = rowsArr.find(r => r.rowEl === tr);
      if (!row) {
        row = { rowEl: tr, fields: [] };
        rowsArr.push(row);
      }
      row.fields.push(el);
    });
    // Determine the maximum number of fields among rows.  This value is
    // used to detect when Tab moves past the last editable field in
    // a row (to trigger a re-render that inserts a blank row).
    let fieldsPerRow = 0;
    rowsArr.forEach(row => {
      if (row.fields.length > fieldsPerRow) {
        fieldsPerRow = row.fields.length;
      }
    });
    // Convert NodeList to an array for index operations
    const fieldArray = Array.from(fields);
    fields.forEach((el, idx) => {
      el.addEventListener('keydown', (e) => {
        // Handle ArrowDown: move to the field in the same column on the
        // next row if possible.  Use the rowsArr mapping to determine
        // current row/column and locate the corresponding element.
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          // Determine the current row and column of this element
          let curRow = -1;
          let curCol = -1;
          for (let rIdx = 0; rIdx < rowsArr.length; rIdx++) {
            const colIdx = rowsArr[rIdx].fields.indexOf(el);
            if (colIdx !== -1) {
              curRow = rIdx;
              curCol = colIdx;
              break;
            }
          }
          if (curRow !== -1) {
            const nextRow = rowsArr[curRow + 1];
            if (nextRow) {
              // Clamp column to the number of fields in the next row
              const targetCol = Math.min(curCol, nextRow.fields.length - 1);
              const nextEl = nextRow.fields[targetCol];
              if (nextEl && nextEl.focus) {
                nextEl.focus();
                if (nextEl.select) {
                  try { nextEl.select(); } catch {}
                }
              }
            }
          }
          return;
        }
        if (e.key === 'Tab') {
          // Signal that a tabbing operation is underway so blur
          // handlers skip triggering a full re‑render.  Clear any
          // existing reset timer to extend the tabbing session.
          clearTimeout(tabResetTimer);
          isTabbing = true;
          e.preventDefault();
          // Trigger change and blur on the current element so its
          // handlers persist changes to state without re‑rendering.
          el.dispatchEvent(new Event('change'));
          el.dispatchEvent(new Event('blur'));
          // Compute the index of the next field.  If Shift+Tab was
          // pressed, move backwards; otherwise forwards.  Wrap around
          // the list boundaries to cycle through all fields.
          let nextIndex = e.shiftKey ? idx - 1 : idx + 1;
          if (nextIndex < 0) nextIndex = fields.length - 1;
          if (nextIndex >= fields.length) nextIndex = 0;
          const nextEl = fields[nextIndex];
          // Move focus to the next element and select its contents if
          // possible.  Using focus() ensures the element is ready for
          // immediate input.
          if (nextEl && nextEl.focus) {
            nextEl.focus();
            if (nextEl.select) {
              try { nextEl.select(); } catch {}
            }
          }
          // Schedule a reset of the tabbing flag after a delay.  If
          // the user continues pressing Tab, this timer will be
          // cleared and restarted on each key press.  Once the user
          // pauses for the specified delay, we end the tabbing
          // session, reset the flag, and allow subsequent re-renders.
          tabResetTimer = setTimeout(() => {
            isTabbing = false;
          }, 200);

          // If we've just tabbed out of the last field in a row, schedule a
          // re-render to insert a new blank row.  Use the computed
          // fieldsPerRow to detect row boundaries rather than a hard
          // coded constant so this logic remains correct if columns
          // change.
          if (!e.shiftKey && fieldsPerRow > 0 && (idx % fieldsPerRow === fieldsPerRow - 1)) {
            setTimeout(() => {
              render();
            }, 0);
          }
        }
      });
    });

    // Global handler for ArrowDown on the bookings table body.  This
    // delegates to the rowsArr mapping to determine the element
    // immediately below the currently focused field in the same column.
    body.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        const active = document.activeElement;
        const idx = fieldArray.indexOf(active);
        if (idx !== -1) {
          e.preventDefault();
          // Determine current row and column of the active element
          let curRow = -1;
          let curCol = -1;
          for (let rIdx = 0; rIdx < rowsArr.length; rIdx++) {
            const colIdx = rowsArr[rIdx].fields.indexOf(active);
            if (colIdx !== -1) {
              curRow = rIdx;
              curCol = colIdx;
              break;
            }
          }
          if (curRow !== -1) {
            const nextRow = rowsArr[curRow + 1];
            if (nextRow) {
              const targetCol = Math.min(curCol, nextRow.fields.length - 1);
              const nextEl = nextRow.fields[targetCol];
              if (nextEl && nextEl.focus) {
                nextEl.focus();
                if (nextEl.select) {
                  try { nextEl.select(); } catch {}
                }
              }
            }
          }
        }
      }
    });
  }
  /* Override assignTabHandlers with enhanced arrow-key navigation. The new
     implementation mirrors spreadsheet behaviour: ArrowLeft/Right move
     horizontally with wrap, ArrowUp/Down move vertically (Enter acts as
     down), and Tab/Shift+Tab move linearly while committing edits and
     scheduling re-renders when leaving the last cell of a row. */
  function assignTabHandlers() {
    const fields = body.querySelectorAll('input, select, button.delete-booking-btn');
    const rowsArr = [];
    fields.forEach((el) => {
      const tr = el.closest('tr');
      let row = rowsArr.find(r => r.rowEl === tr);
      if (!row) {
        row = { rowEl: tr, fields: [] };
        rowsArr.push(row);
      }
      row.fields.push(el);
    });
    let fieldsPerRow = 0;
    rowsArr.forEach(row => {
      if (row.fields.length > fieldsPerRow) {
        fieldsPerRow = row.fields.length;
      }
    });
    fields.forEach((el, idx) => {
      el.addEventListener('keydown', (e) => {
        const key = e.key;
        const isButton = el.tagName === 'BUTTON';
        let curRow = -1;
        let curCol = -1;
        for (let rIdx = 0; rIdx < rowsArr.length; rIdx++) {
          const colIdx = rowsArr[rIdx].fields.indexOf(el);
          if (colIdx !== -1) {
            curRow = rIdx;
            curCol = colIdx;
            break;
          }
        }
        function moveCell(rowIndex, colIndex) {
          const rowCount = rowsArr.length;
          let r = rowIndex;
          let c = colIndex;
          if (r < 0) r = rowCount - 1;
          if (r >= rowCount) r = 0;
          if (c < 0) {
            r = (r - 1 + rowCount) % rowCount;
            c = rowsArr[r].fields.length - 1;
          } else if (c >= rowsArr[r].fields.length) {
            r = (r + 1) % rowCount;
            c = 0;
          }
          const dest = rowsArr[r].fields[c];
          if (dest) {
            isTabbing = true;
            if (!isButton) {
              el.dispatchEvent(new Event('change'));
              el.dispatchEvent(new Event('blur'));
            }
            dest.focus();
            if (dest.select) {
              try { dest.select(); } catch {}
            }
            setTimeout(() => { isTabbing = false; }, 0);
          }
        }
        if (key === 'ArrowLeft') {
          if (curRow !== -1 && !isButton) {
            e.preventDefault();
            moveCell(curRow, curCol - 1);
          }
          return;
        }
        if (key === 'ArrowRight') {
          if (curRow !== -1 && !isButton) {
            e.preventDefault();
            moveCell(curRow, curCol + 1);
          }
          return;
        }
        if (key === 'ArrowUp') {
          if (curRow !== -1 && !isButton) {
            e.preventDefault();
            moveCell(curRow - 1, curCol);
          }
          return;
        }
        if (key === 'ArrowDown' || key === 'Enter') {
          if (curRow !== -1 && !isButton) {
            e.preventDefault();
            moveCell(curRow + 1, curCol);
          }
          return;
        }
        if (key === 'Tab') {
          clearTimeout(tabResetTimer);
          isTabbing = true;
          e.preventDefault();
          if (!isButton) {
            el.dispatchEvent(new Event('change'));
            el.dispatchEvent(new Event('blur'));
          }
          let nextIndex = e.shiftKey ? idx - 1 : idx + 1;
          if (nextIndex < 0) nextIndex = fields.length - 1;
          if (nextIndex >= fields.length) nextIndex = 0;
          const nextEl = fields[nextIndex];
          if (nextEl && nextEl.focus) {
            nextEl.focus();
            if (nextEl.select) {
              try { nextEl.select(); } catch {}
            }
          }
          tabResetTimer = setTimeout(() => {
            isTabbing = false;
          }, 200);
          if (!e.shiftKey && fieldsPerRow > 0 && (idx % fieldsPerRow === fieldsPerRow - 1)) {
            setTimeout(() => {
              render();
            }, 0);
          }
        }
      });
    });
    body.onkeydown = null;
  }
});