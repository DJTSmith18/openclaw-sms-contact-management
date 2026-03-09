'use strict';

const blessed = require('blessed');
const { COLORS } = require('./theme');
const { createTable, createInput, createContactForm, confirmDialog, messageBox, createContactPicker } = require('./widgets');
const { normalizePhone } = require('../normalize');
const { dbAll, dbGet, dbRun } = require('../db');

const PAGE_SIZE = 25;

// ── List View ───────────────────────────────────────────────────────────────

async function showListView(screen, contentBox, db, tableConfig, columns) {
  contentBox.children.forEach(c => c.detach());

  const { table, phoneColumn } = tableConfig;
  const colNames = columns.map(c => c.name);
  let offset = 0;

  const statusLine = blessed.text({
    parent: contentBox,
    bottom: 0,
    left: 0,
    width: '100%',
    height: 1,
    style: { fg: COLORS.dim },
    tags: true,
  });

  const dataTable = createTable(contentBox, {
    label: ' Contacts ',
    height: '100%-1',
  });

  async function loadPage() {
    const countRow = await dbGet(db, `SELECT COUNT(*) as total FROM ${table}`);
    const total = countRow?.total || 0;
    const rows = await dbAll(
      db,
      `SELECT * FROM ${table} ORDER BY ${phoneColumn} LIMIT ? OFFSET ?`,
      [PAGE_SIZE, offset]
    );

    const header = colNames;
    const data = rows.map(row => colNames.map(col => String(row[col] ?? '')));

    dataTable.setData([header, ...data]);

    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    statusLine.setContent(
      `{cyan-fg}Page ${page}/${totalPages}{/} | ${total} contacts | {gray-fg}n{/}=next {gray-fg}p{/}=prev {gray-fg}Esc{/}=back`
    );
    screen.render();
  }

  dataTable.key(['n'], async () => {
    const countRow = await dbGet(db, `SELECT COUNT(*) as total FROM ${table}`);
    const total = countRow?.total || 0;
    if (offset + PAGE_SIZE < total) {
      offset += PAGE_SIZE;
      await loadPage();
    }
  });

  dataTable.key(['p'], async () => {
    if (offset >= PAGE_SIZE) {
      offset -= PAGE_SIZE;
      await loadPage();
    }
  });

  dataTable.focus();
  await loadPage();
  return dataTable;
}

// ── Search View ─────────────────────────────────────────────────────────────

async function showSearchView(screen, contentBox, db, tableConfig, columns) {
  contentBox.children.forEach(c => c.detach());

  const { table } = tableConfig;
  const colNames = columns.map(c => c.name);
  const textCols = columns
    .filter(c => /text|varchar|char/i.test(c.type) || c.type === '')
    .map(c => c.name);

  const searchInput = createInput(contentBox, {
    label: ' Search (Enter to search, Esc to go back) ',
    top: 0,
    height: 3,
  });

  const resultsTable = createTable(contentBox, {
    label: ' Results ',
    top: 3,
    height: '100%-4',
  });

  const statusLine = blessed.text({
    parent: contentBox,
    bottom: 0,
    left: 0,
    width: '100%',
    height: 1,
    style: { fg: COLORS.dim },
    tags: true,
    content: '{gray-fg}Type query and press Enter{/}',
  });

  searchInput.on('submit', async (value) => {
    const query = (value || '').trim();
    if (!query) {
      statusLine.setContent('{red-fg}Enter a search term{/}');
      screen.render();
      searchInput.focus();
      return;
    }

    const searchCols = textCols.length > 0 ? textCols : colNames;
    const whereParts = searchCols.map(col => `${col} LIKE ?`);
    const sqlParams = searchCols.map(() => `%${query}%`);
    sqlParams.push(100);

    try {
      const rows = await dbAll(
        db,
        `SELECT * FROM ${table} WHERE ${whereParts.join(' OR ')} LIMIT ?`,
        sqlParams
      );

      const header = colNames;
      const data = rows.map(row => colNames.map(col => String(row[col] ?? '')));
      resultsTable.setData([header, ...data]);

      statusLine.setContent(`{cyan-fg}${rows.length} result(s){/} for "${query}" | {gray-fg}/ {/}=new search`);
    } catch (e) {
      statusLine.setContent(`{red-fg}Error: ${e.message}{/}`);
    }

    screen.render();
    resultsTable.focus();
  });

  resultsTable.key(['/'], () => {
    searchInput.clearValue();
    searchInput.focus();
    screen.render();
  });

  searchInput.focus();
  screen.render();
  return searchInput;
}

// ── Add Contact View ────────────────────────────────────────────────────────

async function showAddView(screen, contentBox, db, tableConfig, columns, returnToMenu) {
  contentBox.children.forEach(c => c.detach());

  const { table, phoneColumn } = tableConfig;
  const { form, fields, saveBtn, cancelBtn, focusFirst, focusField } = createContactForm(
    contentBox, columns, phoneColumn,
    { label: ' Add New Contact ' }
  );

  cancelBtn.on('press', () => {
    if (returnToMenu) returnToMenu();
  });

  saveBtn.on('press', async () => {
    const vals = {};
    for (const [name, textbox] of Object.entries(fields)) {
      vals[name] = textbox.getValue().trim();
    }

    const phone = normalizePhone(vals[phoneColumn]);
    if (!phone) {
      await messageBox(screen, 'Phone number is required.', { type: 'error', label: ' Error ' });
      focusField(phoneColumn);
      return;
    }

    const colsList = [phoneColumn];
    const paramVals = [phone];

    for (const col of columns) {
      if (col.name === phoneColumn) continue;
      if (vals[col.name]) {
        colsList.push(col.name);
        paramVals.push(vals[col.name]);
      }
    }

    try {
      const placeholders = colsList.map(() => '?').join(', ');
      await dbRun(db, `INSERT INTO ${table} (${colsList.join(', ')}) VALUES (${placeholders})`, paramVals);
      await messageBox(screen, `Contact ${phone} added successfully!`, { type: 'success', label: ' Success ' });
      if (returnToMenu) returnToMenu();
    } catch (e) {
      if (e.message.includes('UNIQUE constraint')) {
        await messageBox(screen, `Phone ${phone} already exists. Use Edit instead.`, { type: 'error', label: ' Error ' });
      } else {
        await messageBox(screen, `Error: ${e.message}`, { type: 'error', label: ' Error ' });
      }
    }
  });

  focusFirst();
  screen.render();
  return form;
}

// ── Edit Contact View ───────────────────────────────────────────────────────

async function showEditView(screen, contentBox, db, tableConfig, columns, returnToMenu) {
  contentBox.children.forEach(c => c.detach());

  const { table, phoneColumn } = tableConfig;

  // Show scrollable contact picker
  const row = await createContactPicker(contentBox, db, tableConfig, columns, {
    label: ' Select Contact to Edit ',
  });

  if (!row) {
    // Cancelled or no contacts — return to menu
    if (returnToMenu) returnToMenu();
    return contentBox;
  }

  const phone = row[phoneColumn];

  // Show edit form with existing values
  const { form, fields, saveBtn, cancelBtn, focusFirst, focusField } = createContactForm(
    contentBox, columns, phoneColumn,
    { label: ` Edit Contact: ${phone} ` }
  );

  // Pre-fill fields
  for (const col of columns) {
    if (fields[col.name] && row[col.name] !== undefined && row[col.name] !== null) {
      fields[col.name].setValue(String(row[col.name]));
    }
  }

  cancelBtn.on('press', () => {
    if (returnToMenu) returnToMenu();
  });

  saveBtn.on('press', async () => {
    const setParts = [];
    const updateVals = [];

    for (const col of columns) {
      if (col.name === phoneColumn) continue;
      const newVal = fields[col.name].getValue().trim();
      setParts.push(`${col.name} = ?`);
      updateVals.push(newVal || null);
    }

    if (setParts.length === 0) {
      await messageBox(screen, 'No fields to update.', { type: 'warning', label: ' Warning ' });
      return;
    }

    updateVals.push(row[phoneColumn]);

    try {
      await dbRun(
        db,
        `UPDATE ${table} SET ${setParts.join(', ')} WHERE ${phoneColumn} = ?`,
        updateVals
      );
      await messageBox(screen, `Contact ${phone} updated!`, { type: 'success', label: ' Success ' });
      if (returnToMenu) returnToMenu();
    } catch (e) {
      await messageBox(screen, `Error: ${e.message}`, { type: 'error', label: ' Error ' });
    }
  });

  // Focus first editable (non-PK) field, or first field if all are PK
  const firstEditable = columns.find(c => c.name !== phoneColumn)?.name || columns[0].name;
  focusField(firstEditable);
  screen.render();
  return form;
}

// ── Delete Contact View ─────────────────────────────────────────────────────

async function showDeleteView(screen, contentBox, db, tableConfig, columns) {
  contentBox.children.forEach(c => c.detach());

  const { table, phoneColumn } = tableConfig;

  // Show scrollable contact picker
  const row = await createContactPicker(contentBox, db, tableConfig, columns, {
    label: ' Select Contact to Delete ',
  });

  if (!row) {
    // Cancelled or no contacts
    screen.render();
    return contentBox;
  }

  const phone = row[phoneColumn];

  // Show contact details before confirming
  const details = columns.map(c => `  ${c.name}: ${row[c.name] ?? '(empty)'}`).join('\n');
  const confirmed = await confirmDialog(
    screen,
    `Delete this contact?\n\n${details}\n\n(y/n)`
  );

  if (confirmed) {
    try {
      await dbRun(db, `DELETE FROM ${table} WHERE ${phoneColumn} = ?`, [row[phoneColumn]]);
      await messageBox(screen, `Contact ${phone} deleted.`, { type: 'success', label: ' Deleted ' });
    } catch (e) {
      await messageBox(screen, `Error: ${e.message}`, { type: 'error', label: ' Error ' });
    }
  }

  screen.render();
  return contentBox;
}

// ── Import View ─────────────────────────────────────────────────────────────

async function showImportView(screen, contentBox, db, tableConfig, columns) {
  contentBox.children.forEach(c => c.detach());

  const { table, phoneColumn } = tableConfig;
  const colNames = columns.map(c => c.name);
  const fs = require('fs');
  const path = require('path');

  const fileInput = createInput(contentBox, {
    label: ' File path to import (JSON or CSV, Esc to go back) ',
    top: 0,
    height: 3,
  });

  const statusBox = blessed.box({
    parent: contentBox,
    top: 3,
    left: 0,
    width: '100%',
    height: '100%-3',
    border: { type: 'line' },
    style: { border: { fg: COLORS.border }, fg: COLORS.fg },
    label: ' Import Status ',
    scrollable: true,
    keys: true,
    vi: true,
    tags: true,
  });

  fileInput.on('submit', async (filePath) => {
    filePath = (filePath || '').trim();
    if (!filePath) {
      statusBox.setContent('{red-fg}File path is required.{/}');
      screen.render();
      fileInput.focus();
      return;
    }

    // Expand ~
    if (filePath.startsWith('~')) {
      filePath = filePath.replace('~', process.env.HOME || process.env.USERPROFILE || '');
    }

    if (!fs.existsSync(filePath)) {
      statusBox.setContent(`{red-fg}File not found: ${filePath}{/}`);
      screen.render();
      fileInput.focus();
      return;
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      let contacts;

      if (filePath.endsWith('.json')) {
        contacts = JSON.parse(raw);
        if (!Array.isArray(contacts)) {
          statusBox.setContent('{red-fg}JSON file must contain an array of objects.{/}');
          screen.render();
          fileInput.focus();
          return;
        }
      } else if (filePath.endsWith('.csv')) {
        const lines = raw.trim().split('\n');
        if (lines.length < 2) {
          statusBox.setContent('{red-fg}CSV file must have a header row and at least one data row.{/}');
          screen.render();
          fileInput.focus();
          return;
        }
        const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
        contacts = lines.slice(1).map(line => {
          const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
          const obj = {};
          headers.forEach((h, i) => { obj[h] = vals[i] || ''; });
          return obj;
        });
      } else {
        statusBox.setContent('{red-fg}Unsupported file format. Use .json or .csv{/}');
        screen.render();
        fileInput.focus();
        return;
      }

      // Preview
      const preview = contacts.slice(0, 5);
      let previewText = `Found ${contacts.length} contacts.\n\nPreview (first ${Math.min(5, contacts.length)}):\n\n`;
      for (const c of preview) {
        previewText += colNames.map(col => `${col}: ${c[col] || c.phone || ''}`).join(' | ') + '\n';
      }

      statusBox.setContent(previewText + '\n{cyan-fg}Press Enter to import, Esc to cancel{/}');
      screen.render();

      // Wait for confirmation
      const confirmed = await confirmDialog(screen, `Import ${contacts.length} contacts? (upsert mode)`);
      if (!confirmed) {
        statusBox.setContent('{yellow-fg}Import cancelled.{/}');
        screen.render();
        fileInput.focus();
        return;
      }

      // Import
      let imported = 0, skipped = 0, errors = 0;
      await dbRun(db, 'BEGIN TRANSACTION');

      try {
        for (const contact of contacts) {
          const phone = normalizePhone(contact.phone || contact[phoneColumn]);
          if (!phone) { skipped++; continue; }

          const cols = [phoneColumn];
          const vals = [phone];
          const updateParts = [];

          for (const [key, val] of Object.entries(contact)) {
            if (key === 'phone') continue;
            if (!colNames.includes(key)) continue;
            if (key === phoneColumn) continue;
            cols.push(key);
            vals.push(String(val));
            updateParts.push(`${key} = excluded.${key}`);
          }

          const placeholders = cols.map(() => '?').join(', ');
          let sql;
          if (updateParts.length > 0) {
            sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT(${phoneColumn}) DO UPDATE SET ${updateParts.join(', ')}`;
          } else {
            sql = `INSERT OR IGNORE INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`;
          }

          try {
            const result = await dbRun(db, sql, vals);
            if (result.changes > 0) imported++;
            else skipped++;
          } catch (e) {
            errors++;
          }
        }

        await dbRun(db, 'COMMIT');
      } catch (e) {
        await dbRun(db, 'ROLLBACK').catch(() => {});
        statusBox.setContent(`{red-fg}Import failed: ${e.message}{/}`);
        screen.render();
        fileInput.focus();
        return;
      }

      statusBox.setContent(
        `{green-fg}Import complete!{/}\n\n` +
        `  Imported: {green-fg}${imported}{/}\n` +
        `  Skipped:  {yellow-fg}${skipped}{/}\n` +
        `  Errors:   {red-fg}${errors}{/}\n\n` +
        `{gray-fg}Press Esc to go back{/}`
      );
      screen.render();
    } catch (e) {
      statusBox.setContent(`{red-fg}Error reading file: ${e.message}{/}`);
      screen.render();
      fileInput.focus();
    }
  });

  fileInput.focus();
  screen.render();
  return fileInput;
}

// ── Export View ──────────────────────────────────────────────────────────────

async function showExportView(screen, contentBox, db, tableConfig, columns) {
  contentBox.children.forEach(c => c.detach());

  const { table, phoneColumn } = tableConfig;
  const colNames = columns.map(c => c.name);
  const fs = require('fs');

  // Format selection
  const formatList = blessed.list({
    parent: contentBox,
    top: 0,
    left: 0,
    width: '100%',
    height: 5,
    items: ['JSON (.json)', 'CSV (.csv)'],
    keys: true,
    mouse: true,
    border: { type: 'line' },
    style: {
      border: { fg: COLORS.border },
      selected: { fg: 'black', bg: COLORS.selected },
    },
    label: ' Select Export Format ',
  });

  const fileInput = createInput(contentBox, {
    label: ' Output file path ',
    top: 5,
    height: 3,
  });

  const statusBox = blessed.text({
    parent: contentBox,
    top: 8,
    left: 0,
    width: '100%',
    height: '100%-8',
    style: { fg: COLORS.fg },
    tags: true,
  });

  let selectedFormat = 'json';
  formatList.on('select', (item, index) => {
    selectedFormat = index === 0 ? 'json' : 'csv';
    fileInput.focus();
    screen.render();
  });

  fileInput.on('submit', async (filePath) => {
    filePath = (filePath || '').trim();
    if (!filePath) {
      statusBox.setContent('{red-fg}File path is required.{/}');
      screen.render();
      fileInput.focus();
      return;
    }

    if (filePath.startsWith('~')) {
      filePath = filePath.replace('~', process.env.HOME || process.env.USERPROFILE || '');
    }

    try {
      const rows = await dbAll(db, `SELECT * FROM ${table} ORDER BY ${phoneColumn}`);

      let content;
      if (selectedFormat === 'json') {
        content = JSON.stringify(rows, null, 2);
      } else {
        const header = colNames.join(',');
        const dataLines = rows.map(row =>
          colNames.map(col => {
            const val = String(row[col] ?? '');
            return val.includes(',') || val.includes('"') ? `"${val.replace(/"/g, '""')}"` : val;
          }).join(',')
        );
        content = [header, ...dataLines].join('\n');
      }

      fs.writeFileSync(filePath, content, 'utf-8');
      statusBox.setContent(
        `{green-fg}Exported ${rows.length} contacts to ${filePath}{/}\n\n` +
        `{gray-fg}Press Esc to go back{/}`
      );
    } catch (e) {
      statusBox.setContent(`{red-fg}Export failed: ${e.message}{/}`);
    }

    screen.render();
  });

  formatList.focus();
  screen.render();
  return formatList;
}

// ── Schema Info View ────────────────────────────────────────────────────────

async function showSchemaView(screen, contentBox, db, tableConfig, columns) {
  contentBox.children.forEach(c => c.detach());

  const header = ['Column', 'Type', 'Primary Key'];
  const data = columns.map(c => [c.name, c.type, c.pk ? 'YES' : '']);

  const schemaTable = createTable(contentBox, {
    label: ` Schema: ${tableConfig.table} `,
  });

  schemaTable.setData([header, ...data]);
  schemaTable.focus();
  screen.render();
  return schemaTable;
}

// ── Database Info View ──────────────────────────────────────────────────────

async function showDbInfoView(screen, contentBox, db, tableConfig, columns, dbPath, discoveredFrom) {
  contentBox.children.forEach(c => c.detach());

  const { table, phoneColumn, phoneMatch } = tableConfig;

  let count = 0;
  try {
    const row = await dbGet(db, `SELECT COUNT(*) as count FROM ${table}`);
    count = row?.count || 0;
  } catch (e) { /* ignore */ }

  let tableList = [];
  try {
    const rows = await dbAll(db, `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`);
    tableList = rows.map(r => r.name);
  } catch (e) { /* ignore */ }

  const info = [
    `{bold}Database Path:{/}      ${dbPath}`,
    `{bold}Discovered From:{/}    ${discoveredFrom || 'manual'}`,
    `{bold}Contact Table:{/}      ${table}`,
    `{bold}Phone Column:{/}       ${phoneColumn}`,
    `{bold}Phone Match:{/}        ${phoneMatch || 'exact'}`,
    `{bold}Column Count:{/}       ${columns.length}`,
    `{bold}Contact Count:{/}      ${count}`,
    '',
    `{bold}All Tables in DB:{/}`,
    ...tableList.map(t => `  ${t === table ? '{green-fg}' + t + ' (contacts){/}' : t}`),
  ];

  const infoBox = blessed.box({
    parent: contentBox,
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    border: { type: 'line' },
    style: { border: { fg: COLORS.border }, fg: COLORS.fg },
    label: ' Database Info ',
    content: info.join('\n'),
    tags: true,
    scrollable: true,
    keys: true,
    vi: true,
    mouse: true,
  });

  infoBox.focus();
  screen.render();
  return infoBox;
}

// ── Add Column View ──────────────────────────────────────────────────────

async function showAddColumnView(screen, contentBox, db, tableConfig, columns, returnToMenu, pluginCtx) {
  contentBox.children.forEach(c => c.detach());

  const { addColumn, updateSiblingSelectColumns } = require('../db');
  const { isSafeSqlIdent } = require('../normalize');
  const { table } = tableConfig;

  // Step 1: Ask for column name
  const colName = await new Promise((resolve) => {
    blessed.text({
      parent: contentBox,
      top: 0,
      left: 2,
      width: '100%-4',
      height: 2,
      style: { fg: COLORS.dim },
      tags: true,
      content: `{bold}Existing columns:{/} ${columns.map(c => c.name).join(', ')}`,
    });

    const helpText = blessed.text({
      parent: contentBox,
      top: 2,
      left: 2,
      width: '100%-4',
      height: 1,
      style: { fg: COLORS.dim },
      content: 'Enter column name, then select type. Esc to cancel.',
    });

    const errorText = blessed.text({
      parent: contentBox,
      top: 3,
      left: 2,
      width: '100%-4',
      height: 1,
      style: { fg: COLORS.error },
      tags: true,
      content: '',
    });

    const nameInput = createInput(contentBox, {
      label: ' Column Name (letters, numbers, underscore) ',
      top: 5,
      height: 3,
    });

    nameInput.on('submit', (value) => {
      const name = (value || '').trim();
      if (!name) {
        errorText.setContent('{red-fg}Column name is required.{/}');
        screen.render();
        nameInput.clearValue();
        nameInput.focus();
        return;
      }
      if (!isSafeSqlIdent(name)) {
        errorText.setContent('{red-fg}Invalid name. Use only letters, numbers, underscore. Must start with letter or underscore.{/}');
        screen.render();
        nameInput.clearValue();
        nameInput.focus();
        return;
      }
      if (columns.some(c => c.name === name)) {
        errorText.setContent(`{red-fg}Column "${name}" already exists.{/}`);
        screen.render();
        nameInput.clearValue();
        nameInput.focus();
        return;
      }
      resolve(name);
    });

    nameInput.on('cancel', () => {
      resolve(null);
    });

    nameInput.focus();
    screen.render();
  });

  if (!colName) {
    if (returnToMenu) returnToMenu();
    return contentBox;
  }

  // Step 2: Pick column type
  contentBox.children.forEach(c => c.detach());

  const selectedType = await new Promise((resolve) => {
    blessed.text({
      parent: contentBox,
      top: 0,
      left: 2,
      width: '100%-4',
      height: 1,
      style: { fg: COLORS.accent },
      tags: true,
      content: `Adding column: {bold}${colName}{/}`,
    });

    blessed.text({
      parent: contentBox,
      top: 2,
      left: 2,
      width: '100%-4',
      height: 1,
      style: { fg: COLORS.dim },
      content: 'Select column type with arrows, press Enter to confirm. Esc to cancel.',
    });

    const typeList = blessed.list({
      parent: contentBox,
      top: 4,
      left: 2,
      width: 30,
      height: 8,
      items: ['  TEXT', '  INTEGER', '  REAL', '  BLOB'],
      keys: true,
      vi: true,
      mouse: true,
      border: { type: 'line' },
      style: {
        border: { fg: COLORS.border },
        focus: { border: { fg: COLORS.borderFocus } },
        selected: { fg: 'black', bg: COLORS.selected, bold: true },
        item: { fg: COLORS.fg },
      },
      label: ' Column Type ',
    });

    typeList.on('select', (item) => {
      resolve(item.getText().trim());
    });

    typeList.key(['escape'], () => {
      resolve(null);
    });

    typeList.focus();
    screen.render();
  });

  if (!selectedType) {
    if (returnToMenu) returnToMenu();
    return contentBox;
  }

  // Step 3: Confirm
  const confirmed = await confirmDialog(
    screen,
    `Add column "${colName}" (${selectedType}) to table "${table}"?\n\nThis will also update voipms-sms/twilio\nselectColumns in openclaw.json if configured.\n\n(y/n)`
  );

  if (!confirmed) {
    if (returnToMenu) returnToMenu();
    return contentBox;
  }

  // Step 4: Execute
  try {
    await addColumn(db, table, colName, selectedType);
    let resultText = `Column "${colName}" (${selectedType}) added to ${table}!\n\n`;

    if (pluginCtx.runtime) {
      const configResult = await updateSiblingSelectColumns(pluginCtx.runtime, colName);
      if (configResult.updated.length > 0) {
        resultText += `Config updated: ${configResult.updated.join(', ')}\n`;
      }
      if (configResult.skipped.length > 0) {
        resultText += `Skipped: ${configResult.skipped.join(', ')}\n`;
      }
      if (configResult.errors.length > 0) {
        resultText += `Errors: ${configResult.errors.join(', ')}\n`;
      }
    } else {
      resultText += 'Note: manually add column to selectColumns in openclaw.json\n';
    }

    if (pluginCtx.refreshColumns) {
      const newCols = await pluginCtx.refreshColumns();
      columns.length = 0;
      columns.push(...newCols);
      resultText += `\nColumns refreshed: ${newCols.map(c => c.name).join(', ')}`;
    }

    await messageBox(screen, resultText, { type: 'success', label: ' Column Added ' });
  } catch (e) {
    await messageBox(screen, `Error: ${e.message}`, { type: 'error', label: ' Error ' });
  }

  if (returnToMenu) returnToMenu();
  return contentBox;
}

module.exports = {
  showListView,
  showSearchView,
  showAddView,
  showEditView,
  showDeleteView,
  showImportView,
  showExportView,
  showSchemaView,
  showDbInfoView,
  showAddColumnView,
};
