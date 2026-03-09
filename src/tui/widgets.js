'use strict';

const blessed = require('blessed');
const { COLORS, STYLES } = require('./theme');

/**
 * Create a styled data table for displaying contacts.
 */
function createTable(parent, opts = {}) {
  return blessed.listtable({
    parent,
    top: opts.top || 0,
    left: opts.left || 0,
    width: opts.width || '100%',
    height: opts.height || '100%-2',
    tags: true,
    keys: true,
    vi: true,
    mouse: true,
    border: { type: 'line' },
    align: 'left',
    noCellBorders: false,
    pad: 1,
    style: {
      border: { fg: COLORS.tableBorder },
      header: { fg: COLORS.tableHeader, bold: true },
      cell: { fg: COLORS.fg },
      selected: { fg: 'black', bg: COLORS.selected },
    },
    label: opts.label || '',
  });
}

/**
 * Create a text input box.
 */
function createInput(parent, opts = {}) {
  return blessed.textbox({
    parent,
    top: opts.top || 0,
    left: opts.left || 0,
    width: opts.width || '100%',
    height: opts.height || 3,
    inputOnFocus: true,
    keys: true,
    mouse: true,
    label: opts.label || '',
    ...STYLES.input,
  });
}

/**
 * Create a form with labeled input fields for contact editing.
 * Returns { form, fields: { colName: textbox, ... }, saveBtn, cancelBtn, focusField(name) }
 *
 * Navigation:
 *   Enter / Tab / Down  → move to next field (or Save button after last field)
 *   Shift+Tab / Up      → move to previous field
 *   Escape              → cancel (triggers cancelBtn press)
 */
function createContactForm(parent, columns, phoneColumn, opts = {}) {
  const form = blessed.box({
    parent,
    top: opts.top || 0,
    left: opts.left || 0,
    width: opts.width || '100%',
    height: opts.height || '100%',
    scrollable: true,
    border: { type: 'line' },
    style: {
      border: { fg: COLORS.border },
    },
    label: opts.label || ' Contact Form ',
  });

  // Help text at top
  blessed.text({
    parent: form,
    top: 0,
    left: 2,
    width: '100%-4',
    height: 1,
    content: 'Tab/Enter=next | Shift+Tab=prev | Esc=exit field | Enter on button=activate',
    style: { fg: COLORS.dim },
    tags: false,
  });

  // Focus indicator — shows which element is currently active
  const focusIndicator = blessed.text({
    parent: form,
    top: 1,
    left: 2,
    width: '100%-4',
    height: 1,
    style: { fg: COLORS.accent },
    tags: true,
    content: '',
  });

  const fields = {};
  const fieldLabels = {};  // label widgets for each field (for visual feedback)
  const fieldOrder = [];   // ordered list of focusable elements
  let row = 3;

  for (const col of columns) {
    // Label
    const label = blessed.text({
      parent: form,
      top: row,
      left: 2,
      width: 20,
      height: 1,
      content: `${col.name}${col.pk ? ' (PK)' : ''}:`,
      style: { fg: col.pk ? COLORS.accent : COLORS.fg, bold: col.pk },
    });

    // Input — NOT inputOnFocus (we manage focus manually to prevent capture)
    const textbox = blessed.textbox({
      parent: form,
      top: row,
      left: 23,
      width: '50%',
      height: 1,
      inputOnFocus: false,
      keys: true,
      mouse: true,
      style: {
        fg: COLORS.inputFg,
        bg: COLORS.inputBg,
        focus: { fg: COLORS.inputFg, bg: 'blue' },
      },
    });

    fields[col.name] = textbox;
    fieldLabels[col.name] = label;
    fieldOrder.push({ type: 'field', name: col.name, el: textbox, label });
    row += 2;
  }

  // Save / Cancel buttons — keys: false so Enter doesn't auto-fire press
  const saveBtn = blessed.button({
    parent: form,
    top: row + 1,
    left: 2,
    width: 14,
    height: 3,
    content: '   Save   ',
    align: 'center',
    border: { type: 'line' },
    style: {
      fg: 'white',
      bg: 'black',
      border: { fg: COLORS.dim },
      focus: { bg: 'green', fg: 'white', bold: true, border: { fg: COLORS.borderFocus } },
      hover: { bg: 'green' },
    },
    mouse: true,
    keys: false,
  });

  const cancelBtn = blessed.button({
    parent: form,
    top: row + 1,
    left: 18,
    width: 14,
    height: 3,
    content: '  Cancel  ',
    align: 'center',
    border: { type: 'line' },
    style: {
      fg: 'white',
      bg: 'black',
      border: { fg: COLORS.dim },
      focus: { bg: 'red', fg: 'white', bold: true, border: { fg: COLORS.error } },
      hover: { bg: 'red' },
    },
    mouse: true,
    keys: false,
  });

  fieldOrder.push({ type: 'button', name: 'save', el: saveBtn });
  fieldOrder.push({ type: 'button', name: 'cancel', el: cancelBtn });

  // ── Navigation logic ─────────────────────────────────────────────────
  let currentIndex = 0;
  let editing = false;  // true when a textbox is in input mode
  let justFocused = false;  // guard against Enter propagation from textbox submit

  function updateIndicator() {
    const item = fieldOrder[currentIndex];
    const pos = `${currentIndex + 1}/${fieldOrder.length}`;
    if (item.type === 'field') {
      focusIndicator.setContent(`{cyan-fg}►{/} Field: {bold}${item.name}{/}  (${pos})  {gray-fg}[editing]{/}`);
    } else {
      focusIndicator.setContent(`{cyan-fg}►{/} Button: {bold}${item.name.toUpperCase()}{/}  (${pos})  {gray-fg}[Enter=activate | Tab=next]{/}`);
    }

    // Update field labels — highlight current
    for (let i = 0; i < fieldOrder.length; i++) {
      const f = fieldOrder[i];
      if (f.type === 'field' && f.label) {
        const col = columns.find(c => c.name === f.name);
        const isPk = col?.pk;
        if (i === currentIndex) {
          f.label.setContent(`► ${f.name}${isPk ? ' (PK)' : ''}:`);
          f.label.style.fg = 'green';
          f.label.style.bold = true;
        } else {
          f.label.setContent(`  ${f.name}${isPk ? ' (PK)' : ''}:`);
          f.label.style.fg = isPk ? COLORS.accent : COLORS.fg;
          f.label.style.bold = isPk;
        }
      }
    }
  }

  function focusIndex(idx) {
    if (idx < 0) idx = 0;
    if (idx >= fieldOrder.length) idx = fieldOrder.length - 1;
    currentIndex = idx;
    const item = fieldOrder[idx];
    editing = false;
    // Guard: prevent Enter from propagating to a button on the same tick
    justFocused = true;
    process.nextTick(() => { justFocused = false; });
    item.el.focus();
    if (item.type === 'field') {
      // Enter input mode on the textbox
      editing = true;
      item.el.readInput();
    }
    updateIndicator();
    form.parent?.screen?.render();
  }

  function focusNext() {
    focusIndex(currentIndex + 1);
  }

  function focusPrev() {
    focusIndex(currentIndex - 1);
  }

  // Wire navigation on each textbox
  for (let i = 0; i < fieldOrder.length; i++) {
    const item = fieldOrder[i];

    if (item.type === 'field') {
      const textbox = item.el;

      // When Enter is pressed in a textbox, it fires 'submit' and exits input mode.
      // Move to next field.
      textbox.on('submit', () => {
        editing = false;
        focusNext();
      });

      // When Escape is pressed in a textbox, it fires 'cancel'.
      textbox.on('cancel', () => {
        editing = false;
        // Don't navigate — just exit input mode, stay on same field
        textbox.focus();
        updateIndicator();
        form.parent?.screen?.render();
      });

      // Tab → next (blessed textbox in input mode doesn't capture Tab, so
      // we also bind it on the element for when it has focus but isn't in input mode)
      textbox.key(['tab'], () => {
        if (!editing) focusNext();
      });
      textbox.key(['S-tab'], () => {
        if (!editing) focusPrev();
      });
    }

    if (item.type === 'button') {
      // Enter on a focused button triggers press (guarded against propagation)
      item.el.key(['enter', 'return'], () => {
        if (!justFocused) item.el.press();
      });
      item.el.key(['tab'], () => focusNext());
      item.el.key(['S-tab'], () => focusPrev());
      // Left/Right arrows to switch between buttons
      item.el.key(['left'], () => focusPrev());
      item.el.key(['right'], () => focusNext());
      // Up arrow goes back to last field
      item.el.key(['up'], () => focusPrev());
    }
  }

  // Clicking a field should focus it properly
  for (let i = 0; i < fieldOrder.length; i++) {
    const idx = i;
    fieldOrder[i].el.on('click', () => {
      focusIndex(idx);
    });
  }

  return {
    form,
    fields,
    saveBtn,
    cancelBtn,
    focusFirst: () => focusIndex(0),
    focusField: (name) => {
      const idx = fieldOrder.findIndex(f => f.name === name);
      if (idx >= 0) focusIndex(idx);
    },
  };
}

/**
 * Show a confirmation dialog. Returns a Promise<boolean>.
 */
function confirmDialog(screen, message) {
  return new Promise((resolve) => {
    const dialog = blessed.question({
      parent: screen,
      top: 'center',
      left: 'center',
      width: '50%',
      height: 7,
      border: { type: 'line' },
      style: {
        border: { fg: COLORS.warning },
        fg: COLORS.fg,
      },
      label: ' Confirm ',
      keys: true,
      mouse: true,
    });

    dialog.ask(message, (err, result) => {
      dialog.detach();
      screen.render();
      resolve(result);
    });

    screen.render();
  });
}

/**
 * Show a message box that auto-dismisses or waits for key press.
 */
function messageBox(screen, message, opts = {}) {
  const color = opts.type === 'error' ? COLORS.error
    : opts.type === 'success' ? COLORS.success
    : COLORS.fg;

  const box = blessed.message({
    parent: screen,
    top: 'center',
    left: 'center',
    width: '60%',
    height: 'shrink',
    border: { type: 'line' },
    style: {
      border: { fg: color },
      fg: color,
    },
    label: opts.label || ' Message ',
    keys: true,
    mouse: true,
  });

  return new Promise((resolve) => {
    box.display(message, opts.timeout || 0, () => {
      box.detach();
      screen.render();
      resolve();
    });
    screen.render();
  });
}

/**
 * Create a scrollable contact picker list.
 * Loads all contacts, displays them in a navigable list.
 * Returns a Promise that resolves with the selected row object, or null if cancelled.
 *
 * Navigation: arrows/pageup/pagedown to scroll, Enter to select, Esc to cancel,
 *             / to filter by typing.
 */
function createContactPicker(parent, db, tableConfig, columns, opts = {}) {
  const { dbAll } = require('../db');
  const { table, phoneColumn } = tableConfig;
  const displayCol = tableConfig.displayName || null;
  const colNames = columns.map(c => c.name);

  // Build display string for a row: "phone — name — email ..."
  function formatRow(row) {
    const parts = [row[phoneColumn] || '?'];
    for (const col of colNames) {
      if (col === phoneColumn) continue;
      if (row[col]) parts.push(row[col]);
    }
    return parts.join('  —  ');
  }

  return new Promise(async (resolve) => {
    let allRows;
    try {
      allRows = await dbAll(db, `SELECT * FROM ${table} ORDER BY ${phoneColumn}`);
    } catch (e) {
      resolve(null);
      return;
    }

    if (!allRows || allRows.length === 0) {
      const { messageBox: mb } = require('./widgets');
      // Can't require self easily, use inline
      const msg = blessed.message({
        parent: parent.screen || parent,
        top: 'center', left: 'center', width: '50%', height: 5,
        border: { type: 'line' },
        style: { border: { fg: COLORS.warning }, fg: COLORS.warning },
        label: ' No Contacts ',
        keys: true,
      });
      msg.display('No contacts found in the database.', 0, () => {
        msg.detach();
        (parent.screen || parent).render();
        resolve(null);
      });
      (parent.screen || parent).render();
      return;
    }

    let filteredRows = allRows;
    let filterText = '';

    const container = blessed.box({
      parent,
      top: opts.top || 0,
      left: opts.left || 0,
      width: opts.width || '100%',
      height: opts.height || '100%',
      border: { type: 'line' },
      style: { border: { fg: COLORS.border } },
      label: opts.label || ' Select Contact ',
    });

    const helpLine = blessed.text({
      parent: container,
      top: 0,
      left: 2,
      width: '100%-4',
      height: 1,
      style: { fg: COLORS.dim },
      content: 'Arrows/PgUp/PgDn=scroll | Enter=select | /=filter | Esc=cancel',
    });

    const filterLine = blessed.text({
      parent: container,
      top: 1,
      left: 2,
      width: '100%-4',
      height: 1,
      style: { fg: COLORS.accent },
      tags: true,
      content: '',
    });

    const list = blessed.list({
      parent: container,
      top: 2,
      left: 0,
      width: '100%-2',
      height: '100%-3',
      keys: true,
      vi: true,
      mouse: true,
      scrollbar: { ch: '│', style: { fg: COLORS.accent } },
      style: {
        selected: { fg: 'black', bg: COLORS.selected, bold: true },
        item: { fg: COLORS.fg },
      },
    });

    function refreshList() {
      const items = filteredRows.map(formatRow);
      list.setItems(items);
      if (items.length > 0) list.select(0);
      const countText = filterText
        ? `{cyan-fg}Filter:{/} "${filterText}" (${filteredRows.length}/${allRows.length})`
        : `{gray-fg}${allRows.length} contacts{/}`;
      filterLine.setContent(countText);
      (parent.screen || parent).render();
    }

    function applyFilter() {
      if (!filterText) {
        filteredRows = allRows;
      } else {
        const q = filterText.toLowerCase();
        filteredRows = allRows.filter(row =>
          colNames.some(col => String(row[col] || '').toLowerCase().includes(q))
        );
      }
      refreshList();
    }

    // Enter = select
    list.on('select', (item, index) => {
      const row = filteredRows[index];
      container.detach();
      (parent.screen || parent).render();
      resolve(row || null);
    });

    // Esc = cancel
    list.key(['escape'], () => {
      container.detach();
      (parent.screen || parent).render();
      resolve(null);
    });

    // / = start typing filter
    list.key(['/'], () => {
      const filterInput = blessed.textbox({
        parent: container,
        bottom: 0,
        left: 0,
        width: '100%',
        height: 1,
        inputOnFocus: true,
        style: { fg: COLORS.inputFg, bg: 'blue' },
      });
      filterInput.focus();
      (parent.screen || parent).render();

      filterInput.on('submit', (val) => {
        filterText = (val || '').trim();
        filterInput.detach();
        applyFilter();
        list.focus();
      });
      filterInput.on('cancel', () => {
        filterInput.detach();
        list.focus();
        (parent.screen || parent).render();
      });
    });

    // Backspace clears filter when not in input mode
    list.key(['backspace'], () => {
      if (filterText) {
        filterText = '';
        applyFilter();
      }
    });

    refreshList();
    list.focus();
  });
}

module.exports = { createTable, createInput, createContactForm, confirmDialog, messageBox, createContactPicker };
