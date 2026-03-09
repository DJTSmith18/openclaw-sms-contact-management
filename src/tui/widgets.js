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
    content: 'Tab/Enter=next field | Shift+Tab=prev field | Esc=cancel',
    style: { fg: COLORS.dim },
    tags: false,
  });

  const fields = {};
  const fieldOrder = [];  // ordered list of focusable elements
  let row = 2;

  for (const col of columns) {
    // Label
    blessed.text({
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
    fieldOrder.push({ type: 'field', name: col.name, el: textbox });
    row += 2;
  }

  // Save / Cancel buttons
  const saveBtn = blessed.button({
    parent: form,
    top: row + 1,
    left: 2,
    width: 12,
    height: 3,
    content: '  Save  ',
    align: 'center',
    border: { type: 'line' },
    style: {
      fg: 'white',
      bg: 'green',
      border: { fg: COLORS.borderFocus },
      focus: { bg: 'green', fg: 'white', bold: true },
      hover: { bg: 'green' },
    },
    mouse: true,
    keys: true,
  });

  const cancelBtn = blessed.button({
    parent: form,
    top: row + 1,
    left: 16,
    width: 12,
    height: 3,
    content: ' Cancel ',
    align: 'center',
    border: { type: 'line' },
    style: {
      fg: 'white',
      bg: 'red',
      border: { fg: COLORS.error },
      focus: { bg: 'red', fg: 'white', bold: true },
      hover: { bg: 'red' },
    },
    mouse: true,
    keys: true,
  });

  fieldOrder.push({ type: 'button', name: 'save', el: saveBtn });
  fieldOrder.push({ type: 'button', name: 'cancel', el: cancelBtn });

  // ── Navigation logic ─────────────────────────────────────────────────
  let currentIndex = 0;
  let editing = false;  // true when a textbox is in input mode

  function focusIndex(idx) {
    if (idx < 0) idx = 0;
    if (idx >= fieldOrder.length) idx = fieldOrder.length - 1;
    currentIndex = idx;
    const item = fieldOrder[idx];
    editing = false;
    item.el.focus();
    if (item.type === 'field') {
      // Enter input mode on the textbox
      editing = true;
      item.el.readInput();
    }
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
      item.el.key(['tab'], () => focusNext());
      item.el.key(['S-tab'], () => focusPrev());
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

module.exports = { createTable, createInput, createContactForm, confirmDialog, messageBox };
