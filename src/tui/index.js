'use strict';

const blessed = require('blessed');
const { COLORS, STYLES } = require('./theme');
const {
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
} = require('./views');

const MENU_ITEMS = [
  '  List Contacts',
  '  Search Contacts',
  '  Add Contact',
  '  Edit Contact',
  '  Delete Contact',
  '  Import Contacts',
  '  Export Contacts',
  '  Add Column',
  '  Schema Info',
  '  Database Info',
  '  Quit',
];

/**
 * Launch the full-screen blessed TUI for contact management.
 */
async function launchTui(db, tableConfig, columns, dbPath, discoveredFrom, pluginCtx = {}) {
  const screen = blessed.screen({
    smartCSR: true,
    title: 'SMS Contact Management',
    fullUnicode: true,
  });

  // ── Title Bar ──────────────────────────────────────────────────────────
  const titleBar = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: '100%',
    height: 1,
    style: { fg: 'white', bg: 'blue', bold: true },
    content: ' SMS Contact Management — ' + tableConfig.table,
    tags: true,
  });

  // ── Left Panel: Navigation Menu ────────────────────────────────────────
  const menuBox = blessed.list({
    parent: screen,
    top: 1,
    left: 0,
    width: '25%',
    height: '100%-2',
    items: MENU_ITEMS,
    keys: true,
    vi: true,
    mouse: true,
    ...STYLES.list,
    label: ' Menu ',
  });

  // ── Right Panel: Content Area ──────────────────────────────────────────
  const contentBox = blessed.box({
    parent: screen,
    top: 1,
    left: '25%',
    width: '75%',
    height: '100%-2',
    border: { type: 'line' },
    style: {
      border: { fg: COLORS.border },
      fg: COLORS.fg,
    },
    label: ' Content ',
  });

  // ── Bottom Status Bar ──────────────────────────────────────────────────
  const statusBar = blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    width: '100%',
    height: 1,
    style: { fg: COLORS.dim, bg: 'blue' },
    tags: true,
    content: ` {bold}DB:{/} ${dbPath} | {bold}Tab{/}=switch panels | {bold}q{/}=quit | {bold}Esc{/}=back`,
  });

  // ── View State ─────────────────────────────────────────────────────────
  let currentView = null;

  // Called by views after save/cancel to safely return focus to menu
  function returnToMenu() {
    contentBox.children.forEach(c => c.detach());
    contentBox.setLabel(' Content ');
    currentView = null;
    menuBox.focus();
    screen.render();
  }

  async function switchView(index) {
    contentBox.children.forEach(c => c.detach());

    switch (index) {
      case 0: // List
        contentBox.setLabel(' Contacts ');
        currentView = await showListView(screen, contentBox, db, tableConfig, columns);
        break;
      case 1: // Search
        contentBox.setLabel(' Search ');
        currentView = await showSearchView(screen, contentBox, db, tableConfig, columns);
        break;
      case 2: // Add
        contentBox.setLabel(' Add Contact ');
        currentView = await showAddView(screen, contentBox, db, tableConfig, columns, returnToMenu);
        break;
      case 3: // Edit
        contentBox.setLabel(' Edit Contact ');
        currentView = await showEditView(screen, contentBox, db, tableConfig, columns, returnToMenu);
        break;
      case 4: // Delete
        contentBox.setLabel(' Delete Contact ');
        currentView = await showDeleteView(screen, contentBox, db, tableConfig, columns);
        break;
      case 5: // Import
        contentBox.setLabel(' Import ');
        currentView = await showImportView(screen, contentBox, db, tableConfig, columns);
        break;
      case 6: // Export
        contentBox.setLabel(' Export ');
        currentView = await showExportView(screen, contentBox, db, tableConfig, columns);
        break;
      case 7: // Add Column
        contentBox.setLabel(' Add Column ');
        currentView = await showAddColumnView(screen, contentBox, db, tableConfig, columns, returnToMenu, pluginCtx);
        break;
      case 8: // Schema
        contentBox.setLabel(' Schema ');
        currentView = await showSchemaView(screen, contentBox, db, tableConfig, columns);
        break;
      case 9: // DB Info
        contentBox.setLabel(' Database Info ');
        currentView = await showDbInfoView(screen, contentBox, db, tableConfig, columns, dbPath, discoveredFrom);
        break;
      case 10: // Quit
        screen.destroy();
        return;
    }

    screen.render();
  }

  // ── Menu Selection ─────────────────────────────────────────────────────
  menuBox.on('select', async (item, index) => {
    await switchView(index);
  });

  // ── Keyboard shortcuts ─────────────────────────────────────────────────

  // Tab to switch between menu and content
  screen.key(['tab'], () => {
    if (menuBox === screen.focused || menuBox.children.some(c => c === screen.focused)) {
      if (currentView && currentView.parent) currentView.focus();
    } else {
      menuBox.focus();
    }
    screen.render();
  });

  // Global shortcuts
  screen.key(['q', 'C-c'], () => {
    screen.destroy();
  });

  // Escape returns to menu
  screen.key(['escape'], () => {
    menuBox.focus();
    screen.render();
  });

  // Quick-access keys
  screen.key(['/', 'S-/'], async () => await switchView(1)); // search
  screen.key(['a'], async () => {
    if (menuBox === screen.focused) await switchView(2); // add — only from menu to avoid capturing in inputs
  });

  // ── Initial State ──────────────────────────────────────────────────────
  menuBox.focus();
  menuBox.select(0);
  screen.render();

  // Wait for screen to be destroyed
  return new Promise((resolve) => {
    screen.on('destroy', resolve);
  });
}

module.exports = { launchTui };
