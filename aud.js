// Auditoriums page logic
// Access global ShowtimeState via window. Do not import as module because
// app.js attaches ShowtimeState to the window object.
const ShowtimeState = window.ShowtimeState;

// Global flag used to suppress full re-renders while the user is tabbing
// through inputs. When true, blur/change handlers should update state
// without calling render() so that focus is not lost mid-tab.
let isTabbing = false;

function initAudPage() {
  const addBtn = document.getElementById('addAudBtn');
  // Reference the clear button if present
  const clearBtn = document.getElementById('clearAudBtn');
  const body = document.getElementById('audBody');

  function render() {
    const state = ShowtimeState.state;
    body.innerHTML = '';
    state.auds.forEach((aud) => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-gray-50';
      // ID cell
      const tdId = document.createElement('td');
      // Constrain all columns to 10 characters wide and prevent them from growing
      // Expand ID column width to 20 characters. Doubling the width improves
      // legibility while still preventing responsive growth.
      tdId.style.width = '20ch';
      tdId.style.maxWidth = '20ch';
      tdId.className = 'px-3 py-2 truncate';
      tdId.textContent = aud.id;
      tr.appendChild(tdId);
      // Name cell
      const tdName = document.createElement('td');
      // Double the name column width to 20 characters to allow longer names.
      tdName.style.width = '20ch';
      tdName.style.maxWidth = '20ch';
      tdName.className = 'px-3 py-2 truncate navcell';
      const inputName = document.createElement('input');
      inputName.type = 'text';
      inputName.value = aud.name;
      // Let the input expand within the fixed-width cell
      inputName.className = 'border border-gray-300 rounded px-2 py-1 w-full';
      inputName.addEventListener('change', () => {
        aud.name = inputName.value;
        ShowtimeState.save();
        // Only re-render when not tabbing so that focus is preserved across fields
        if (!isTabbing) {
          render();
        }
      });
      tdName.appendChild(inputName);
      tr.appendChild(tdName);
      // Format cell
      const tdFmt = document.createElement('td');
      // Double the format column width to 20 characters.
      tdFmt.style.width = '20ch';
      tdFmt.style.maxWidth = '20ch';
      tdFmt.className = 'px-3 py-2 truncate navcell';
      const inputFmt = document.createElement('input');
      inputFmt.type = 'text';
      inputFmt.value = aud.format;
      // Make the input fill its cell
      inputFmt.className = 'border border-gray-300 rounded px-2 py-1 w-full';
      inputFmt.addEventListener('change', () => {
        aud.format = inputFmt.value;
        ShowtimeState.save();
        if (!isTabbing) {
          render();
        }
      });
      tdFmt.appendChild(inputFmt);
      tr.appendChild(tdFmt);
      // Seats cell
      const tdSeats = document.createElement('td');
      // Double the seats column width to 20 characters.
      tdSeats.style.width = '20ch';
      tdSeats.style.maxWidth = '20ch';
      tdSeats.className = 'px-3 py-2 truncate navcell';
      const inputSeats = document.createElement('input');
      inputSeats.type = 'number';
      inputSeats.min = '0';
      inputSeats.value = aud.seats;
      // Make the input fill its cell
      inputSeats.className = 'border border-gray-300 rounded px-2 py-1 w-full';
      inputSeats.addEventListener('change', () => {
        const val = parseInt(inputSeats.value, 10);
        aud.seats = isNaN(val) ? 0 : val;
        ShowtimeState.save();
        if (!isTabbing) {
          render();
        }
      });
      tdSeats.appendChild(inputSeats);
      tr.appendChild(tdSeats);
      // Create a Delete cell with a button to remove this auditorium.
      const tdDel = document.createElement('td');
      // Narrow width for delete column
      tdDel.style.width = '10ch';
      tdDel.style.maxWidth = '10ch';
      tdDel.className = 'px-3 py-2 truncate';
      const delBtn = document.createElement('button');
      delBtn.textContent = 'Delete';
      // Use a red colour to indicate a destructive action
      delBtn.className = 'text-red-700 hover:text-red-900';
      delBtn.addEventListener('click', () => {
        const state = ShowtimeState.state;
        const idx = state.auds.findIndex(a => a.id === aud.id);
        if (idx >= 0) {
          state.auds.splice(idx, 1);
          // Remove auditorium references from primeRows
          if (Array.isArray(state.primeRows)) {
            state.primeRows.forEach(row => {
              if (row.audId === aud.id) {
                row.audId = null;
              }
            });
          }
          // Remove overrides referencing this auditorium
          if (state.overrides && typeof state.overrides === 'object') {
            Object.keys(state.overrides).forEach(key => {
              const override = state.overrides[key];
              if (override && override.audId === aud.id) {
                delete override.audId;
                if (Object.keys(override).length === 0) {
                  delete state.overrides[key];
                }
              }
            });
          }
          ShowtimeState.save();
          // Dispatch storage event for other pages to update
          try {
            window.dispatchEvent(new Event('storage'));
          } catch {}
          render();
        }
      });
      tdDel.appendChild(delBtn);
      tr.appendChild(tdDel);
      body.appendChild(tr);
    });

    // After rendering rows, assign tab handlers to allow smooth tabbing
    assignTabHandlers();
  }

  addBtn.addEventListener('click', () => {
    const state = ShowtimeState.state;
    const maxId = state.auds.reduce((m, a) => Math.max(m, a.id), 0);
    state.auds.push({ id: maxId + 1, name: `Aud ${maxId + 1}`, format: 'Standard', seats: 100 });
    ShowtimeState.save();
    render();
  });

  // Handle clearing all auditoriums
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      const state = ShowtimeState.state;
      // Remove all auditoriums
      state.auds = [];
      // Reset auditorium assignments in primeRows
      if (Array.isArray(state.primeRows)) {
        state.primeRows.forEach(row => {
          row.audId = null;
        });
      }
      // Remove audId from overrides
      if (state.overrides && typeof state.overrides === 'object') {
        Object.keys(state.overrides).forEach(key => {
          const override = state.overrides[key];
          if (override && override.audId) {
            delete override.audId;
            if (Object.keys(override).length === 0) {
              delete state.overrides[key];
            }
          }
        });
      }
      ShowtimeState.save();
      // Notify other pages of the update
      try {
        window.dispatchEvent(new Event('storage'));
      } catch {}
      render();
    });
  }

  window.addEventListener('storage', () => render());
  window.addEventListener('showtimeViewActivated', (evt) => {
    const detail = evt && evt.detail;
    const view = detail && detail.view ? detail.view : evt && evt.view;
    if (view === 'auditoriums') {
      render();
    }
  });
  render();

  // Assign custom tab behaviour to inputs in the auditoriums table. This function
  // gathers all input elements in the current table order and intercepts
  // Tab/Shift+Tab key presses to manually advance focus horizontally then
  // down a row. The state is updated via dispatching change events, and
  // full re-renders are suppressed during tabbing to preserve focus.
  function assignTabHandlers() {
    const rows = body.querySelectorAll('tr');
    // Record how many editable fields exist per row
    const rowFieldCounts = Array.from(rows).map(rowEl =>
      rowEl.querySelectorAll('input, select').length
    );
    // Assign dataset row/col to each field
    rows.forEach((rowEl, rIndex) => {
      const fields = rowEl.querySelectorAll('input, select');
      fields.forEach((fieldEl, cIndex) => {
        fieldEl.dataset.row = rIndex;
        fieldEl.dataset.col = cIndex;
      });
    });
    const allFields = body.querySelectorAll('input, select');
    allFields.forEach((el, idx) => {
      el.addEventListener('keydown', (e) => {
        const key = e.key;
        const r = parseInt(el.dataset.row || '0', 10);
        const c = parseInt(el.dataset.col || '0', 10);
        const rowCount = rows.length;
        const getField = (rowIndex, colIndex) => {
          return body.querySelector(`[data-row='${rowIndex}'][data-col='${colIndex}']`);
        };
        function moveFocus(targetRow, targetCol) {
          let newRow = targetRow;
          let newCol = targetCol;
          // Wrap vertical indices
          if (newRow < 0) newRow = rowCount - 1;
          if (newRow >= rowCount) newRow = 0;
          // Clamp horizontally and wrap across rows
          const maxCols = rowFieldCounts[newRow] || 0;
          if (newCol < 0) {
            newRow = (newRow - 1 + rowCount) % rowCount;
            newCol = (rowFieldCounts[newRow] || 0) - 1;
          } else if (newCol >= maxCols) {
            newRow = (newRow + 1) % rowCount;
            newCol = 0;
          }
          const dest = getField(newRow, newCol);
          if (dest) {
            // Indicate we are navigating to suppress re-renders
            isTabbing = true;
            // Commit current field's value
            el.dispatchEvent(new Event('change'));
            el.dispatchEvent(new Event('blur'));
            dest.focus();
            if (dest.select) {
              try { dest.select(); } catch {}
            }
            setTimeout(() => { isTabbing = false; }, 0);
          }
        }
        if (key === 'ArrowLeft') {
          e.preventDefault();
          moveFocus(r, c - 1);
          return;
        }
        if (key === 'ArrowRight') {
          e.preventDefault();
          moveFocus(r, c + 1);
          return;
        }
        if (key === 'ArrowUp') {
          e.preventDefault();
          moveFocus(r - 1, c);
          return;
        }
        if (key === 'ArrowDown' || key === 'Enter') {
          e.preventDefault();
          moveFocus(r + 1, c);
          return;
        }
        if (key === 'Tab') {
          isTabbing = true;
          e.preventDefault();
          el.dispatchEvent(new Event('change'));
          el.dispatchEvent(new Event('blur'));
          // Determine next field index with wrap
          let nextIndex = e.shiftKey ? idx - 1 : idx + 1;
          if (nextIndex < 0) nextIndex = allFields.length - 1;
          if (nextIndex >= allFields.length) nextIndex = 0;
          const nextEl = allFields[nextIndex];
          if (nextEl && nextEl.focus) {
            nextEl.focus();
            if (nextEl.select) {
              try { nextEl.select(); } catch {}
            }
          }
          setTimeout(() => { isTabbing = false; }, 0);
        }
      });
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAudPage);
} else {
  initAudPage();
}
