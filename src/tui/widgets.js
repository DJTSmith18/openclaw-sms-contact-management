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
 * Returns { form, fields: { colName: textbox, ... }, buttons: { save, cancel } }
 */
function createContactForm(parent, columns, phoneColumn, opts = {}) {
  const form = blessed.box({
    parent,
    top: opts.top || 0,
    left: opts.left || 0,
    width: opts.width || '100%',
    height: opts.height || '100%',
    scrollable: true,
    keys: true,
    vi: true,
    border: { type: 'line' },
    style: {
      border: { fg: COLORS.border },
    },
    label: opts.label || ' Contact Form ',
  });

  const fields = {};
  let row = 1;

  for (const col of columns) {
    blessed.text({
      parent: form,
      top: row,
      left: 2,
      width: 20,
      height: 1,
      content: `${col.name}${col.pk ? ' (PK)' : ''}:`,
      style: { fg: col.pk ? COLORS.accent : COLORS.fg, bold: col.pk },
    });

    const textbox = blessed.textbox({
      parent: form,
      top: row,
      left: 23,
      width: '50%',
      height: 1,
      inputOnFocus: true,
      keys: true,
      mouse: true,
      style: {
        fg: COLORS.inputFg,
        bg: COLORS.inputBg,
        focus: { fg: COLORS.inputFg, bg: 'blue' },
      },
    });

    fields[col.name] = textbox;
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

  return { form, fields, saveBtn, cancelBtn };
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
