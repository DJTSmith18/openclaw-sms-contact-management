'use strict';

const { discoverConfig } = require('./src/discovery');
const { openDb, discoverColumns, tableExists } = require('./src/db');
const { registerCrudTools } = require('./src/tools/contact-crud');
const { registerSearchTools } = require('./src/tools/contact-search');
const { registerIoTools } = require('./src/tools/contact-io');

module.exports = {
  id:          'sms-contact-management',
  name:        'SMS Contact Management',
  description: 'Full CRUD, search, import/export for SMS contacts with agent tools and blessed TUI.',

  async register(api) {

    // ── Config discovery ───────────────────────────────────────────────────
    const ownConfig = api.pluginConfig || {};
    const discovered = discoverConfig(api.config, ownConfig);

    if (!discovered.dbPath) {
      api.logger.error('[contacts] FATAL: ' + (discovered.error || 'No dbPath found — plugin disabled'));
      api.logger.error('[contacts] Ensure voipms-sms or openclaw-twilio is configured, or set dbPath manually in sms-contact-management config.');
      return;
    }

    if (discovered.discoveredFrom && discovered.discoveredFrom !== 'manual') {
      api.logger.info(`[contacts] Config discovered from ${discovered.discoveredFrom}`);
    }

    if (!discovered.contactTable || !discovered.contactTable.table) {
      api.logger.error('[contacts] FATAL: No contact table configured — plugin disabled');
      api.logger.error('[contacts] Configure contactLookup on a DID in voipms-sms, or set contactTable manually.');
      return;
    }

    const { dbPath, contactTable } = discovered;

    // ── Open database ──────────────────────────────────────────────────────
    let db;
    try {
      db = await openDb(dbPath);
    } catch (err) {
      api.logger.error(`[contacts] FATAL: Cannot open database at ${dbPath}: ${err.message}`);
      return;
    }
    api.logger.info(`[contacts] DB ready: ${dbPath}`);

    // ── Validate table exists ──────────────────────────────────────────────
    const exists = await tableExists(db, contactTable.table);
    if (!exists) {
      api.logger.error(`[contacts] FATAL: Table '${contactTable.table}' does not exist in ${dbPath}`);
      api.logger.error('[contacts] Create the table first (e.g. via the voipms-sms installer), then restart.');
      return;
    }

    // ── Discover columns ───────────────────────────────────────────────────
    let columns;
    if (contactTable.columns && contactTable.columns.length > 0) {
      // Use explicitly configured columns — still validate via PRAGMA
      const pragmaCols = await discoverColumns(db, contactTable.table);
      const pragmaNames = pragmaCols ? pragmaCols.map(c => c.name) : [];
      columns = contactTable.columns
        .filter(name => pragmaNames.includes(name))
        .map(name => {
          const p = pragmaCols.find(c => c.name === name);
          return { name, type: p?.type || 'TEXT', pk: p?.pk || false };
        });
    } else {
      // Auto-discover all columns
      columns = await discoverColumns(db, contactTable.table);
    }

    if (!columns || columns.length === 0) {
      api.logger.error(`[contacts] FATAL: No columns found in table '${contactTable.table}'`);
      return;
    }

    api.logger.info(`[contacts] Table '${contactTable.table}': ${columns.map(c => c.name).join(', ')}`);

    // ── Register agent tools ───────────────────────────────────────────────
    registerCrudTools(api, db, contactTable, columns);
    registerSearchTools(api, db, contactTable, columns);
    registerIoTools(api, db, contactTable, columns);

    api.logger.info('[contacts] 11 agent tools registered');

    // ── Register CLI ───────────────────────────────────────────────────────
    api.registerCli(({ program }) => {
      const cmd = program
        .command('contacts')
        .description('Manage SMS contacts — interactive TUI and subcommands');

      // Default: launch interactive TUI
      cmd.action(async () => {
        const { launchTui } = require('./src/tui/index');
        await launchTui(db, contactTable, columns, dbPath, discovered.discoveredFrom);
      });

      // Non-interactive subcommands
      cmd.command('list')
        .description('List all contacts')
        .option('-l, --limit <n>', 'Max results', '50')
        .option('-o, --offset <n>', 'Skip records', '0')
        .action(async (opts) => {
          const { dbAll, dbGet } = require('./src/db');
          const limit = Math.min(Number(opts.limit) || 50, 200);
          const offset = Math.max(Number(opts.offset) || 0, 0);
          const countRow = await dbGet(db, `SELECT COUNT(*) as total FROM ${contactTable.table}`);
          const rows = await dbAll(db, `SELECT * FROM ${contactTable.table} ORDER BY ${contactTable.phoneColumn} LIMIT ? OFFSET ?`, [limit, offset]);
          console.log(JSON.stringify({ contacts: rows, total: countRow?.total || 0, limit, offset }, null, 2));
        });

      cmd.command('search <query>')
        .description('Search contacts')
        .option('-f, --field <name>', 'Field to search')
        .option('-l, --limit <n>', 'Max results', '20')
        .action(async (query, opts) => {
          const { dbAll } = require('./src/db');
          const limit = Math.min(Number(opts.limit) || 20, 100);
          const textCols = columns.filter(c => /text|varchar|char/i.test(c.type) || c.type === '').map(c => c.name);
          const searchCols = opts.field && textCols.includes(opts.field) ? [opts.field] : textCols;
          const whereParts = searchCols.map(col => `${col} LIKE ?`);
          const sqlParams = searchCols.map(() => `%${query}%`);
          sqlParams.push(limit);
          const rows = await dbAll(db, `SELECT * FROM ${contactTable.table} WHERE ${whereParts.join(' OR ')} LIMIT ?`, sqlParams);
          console.log(JSON.stringify({ results: rows, count: rows.length }, null, 2));
        });

      cmd.command('count')
        .description('Count contacts')
        .action(async () => {
          const { dbGet } = require('./src/db');
          const row = await dbGet(db, `SELECT COUNT(*) as count FROM ${contactTable.table}`);
          console.log(JSON.stringify({ count: row?.count || 0 }));
        });

      cmd.command('schema')
        .description('Show contact table schema')
        .action(async () => {
          console.log(JSON.stringify({
            table: contactTable.table,
            phoneColumn: contactTable.phoneColumn,
            columns: columns.map(c => ({ name: c.name, type: c.type, primaryKey: c.pk })),
          }, null, 2));
        });

      cmd.command('export')
        .description('Export contacts as JSON')
        .option('-l, --limit <n>', 'Max contacts', '1000')
        .action(async (opts) => {
          const { dbAll } = require('./src/db');
          const limit = Math.min(Number(opts.limit) || 1000, 5000);
          const rows = await dbAll(db, `SELECT * FROM ${contactTable.table} ORDER BY ${contactTable.phoneColumn} LIMIT ?`, [limit]);
          console.log(JSON.stringify(rows, null, 2));
        });

    }, { commands: ['contacts'] });

    api.logger.info('[contacts] CLI registered: openclaw contacts');
  },
};
