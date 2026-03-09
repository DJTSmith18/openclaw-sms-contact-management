'use strict';

const { discoverConfig } = require('./src/discovery');
const { openDb, discoverColumns, tableExists } = require('./src/db');
const { registerCrudTools } = require('./src/tools/contact-crud');
const { registerSearchTools } = require('./src/tools/contact-search');
const { registerIoTools } = require('./src/tools/contact-io');

// Shared state — initialized lazily by initDb()
let _db = null;
let _columns = null;
let _initPromise = null;
let _initError = null;

module.exports = {
  id:          'sms-contact-management',
  name:        'SMS Contact Management',
  description: 'Full CRUD, search, import/export for SMS contacts with agent tools and blessed TUI.',

  register(api) {

    // ── Config discovery (synchronous — just reads api.config) ─────────────
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

    // ── Lazy DB initialization ─────────────────────────────────────────────
    // DB is opened on first use (tool call or CLI command) to avoid blocking
    // the synchronous register() call.

    function initDb() {
      if (_initPromise) return _initPromise;
      _initPromise = (async () => {
        try {
          _db = await openDb(dbPath);
          api.logger.info(`[contacts] DB ready: ${dbPath}`);

          const exists = await tableExists(_db, contactTable.table);
          if (!exists) {
            _initError = `Table '${contactTable.table}' does not exist in ${dbPath}`;
            api.logger.error(`[contacts] FATAL: ${_initError}`);
            return;
          }

          if (contactTable.columns && contactTable.columns.length > 0) {
            const pragmaCols = await discoverColumns(_db, contactTable.table);
            const pragmaNames = pragmaCols ? pragmaCols.map(c => c.name) : [];
            _columns = contactTable.columns
              .filter(name => pragmaNames.includes(name))
              .map(name => {
                const p = pragmaCols.find(c => c.name === name);
                return { name, type: p?.type || 'TEXT', pk: p?.pk || false };
              });
          } else {
            _columns = await discoverColumns(_db, contactTable.table);
          }

          if (!_columns || _columns.length === 0) {
            _initError = `No columns found in table '${contactTable.table}'`;
            api.logger.error(`[contacts] FATAL: ${_initError}`);
            return;
          }

          api.logger.info(`[contacts] Table '${contactTable.table}': ${_columns.map(c => c.name).join(', ')}`);
        } catch (err) {
          _initError = err.message;
          api.logger.error(`[contacts] FATAL: Cannot open database at ${dbPath}: ${err.message}`);
        }
      })();
      return _initPromise;
    }

    async function getDb() {
      await initDb();
      if (_initError) throw new Error(_initError);
      return { db: _db, columns: _columns };
    }

    // ── Register agent tools (use tool factory for lazy init) ──────────────
    api.registerTool((ctx) => {
      // Return a factory — tools are instantiated per-session, DB init happens
      // on first handler call via getDb().
      // We need to return tools synchronously but handler runs async, so we
      // return tools with a wrapper handler that inits DB lazily.

      // Since we don't know columns yet, use a generic schema for dynamic tools.
      // The handler validates at runtime.
      const phoneProp = {
        type: 'string',
        description: 'Phone number (10 digits)',
      };

      return [
        // ── contacts_get
        {
          id: 'contacts_get',
          name: 'contacts_get',
          description: 'Look up a contact by phone number.',
          inputSchema: {
            type: 'object',
            properties: { phone: phoneProp },
            required: ['phone'],
          },
          handler: async (params) => {
            try {
              const { db, columns } = await getDb();
              const { normalizePhone } = require('./src/normalize');
              const { dbGet } = require('./src/db');
              const phone = normalizePhone(params.phone);
              if (!phone) return { error: 'Invalid phone number' };
              const pm = contactTable.phoneMatch === 'like';
              const sql = `SELECT * FROM ${contactTable.table} WHERE ${contactTable.phoneColumn} ${pm ? 'LIKE' : '='} ? LIMIT 1`;
              const sqlP = pm ? [`%${phone}%`] : [phone];
              const row = await dbGet(db, sql, sqlP);
              return row ? { found: true, contact: row } : { found: false, phone };
            } catch (e) { return { error: e.message }; }
          },
        },
        // ── contacts_add
        {
          id: 'contacts_add',
          name: 'contacts_add',
          description: 'Add a new contact to the database. Fails if the phone already exists. Use contacts_schema to see available columns.',
          inputSchema: {
            type: 'object',
            properties: {
              phone: phoneProp,
              fields: { type: 'object', description: 'Column values as key-value pairs (use contacts_schema to see available columns)' },
            },
            required: ['phone'],
          },
          handler: async (params) => {
            try {
              const { db, columns } = await getDb();
              const { normalizePhone, isSafeSqlIdent } = require('./src/normalize');
              const { dbRun } = require('./src/db');
              const phone = normalizePhone(params.phone);
              if (!phone) return { error: 'Invalid phone number' };
              const allColNames = columns.map(c => c.name);
              const cols = [contactTable.phoneColumn];
              const vals = [phone];
              const extra = params.fields || params;
              for (const [k, v] of Object.entries(extra)) {
                if (k === 'phone' || k === 'fields') continue;
                if (!allColNames.includes(k) || !isSafeSqlIdent(k)) continue;
                if (k === contactTable.phoneColumn) continue;
                cols.push(k); vals.push(v);
              }
              const sql = `INSERT INTO ${contactTable.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
              await dbRun(db, sql, vals);
              return { success: true, phone, action: 'added' };
            } catch (e) {
              if (e.message.includes('UNIQUE constraint')) return { error: `Phone ${params.phone} already exists. Use contacts_upsert instead.` };
              return { error: e.message };
            }
          },
        },
        // ── contacts_update
        {
          id: 'contacts_update',
          name: 'contacts_update',
          description: 'Update an existing contact. Only provided fields are changed. Use contacts_schema to see available columns.',
          inputSchema: {
            type: 'object',
            properties: {
              phone: phoneProp,
              fields: { type: 'object', description: 'Column values to update as key-value pairs' },
            },
            required: ['phone'],
          },
          handler: async (params) => {
            try {
              const { db, columns } = await getDb();
              const { normalizePhone, isSafeSqlIdent } = require('./src/normalize');
              const { dbRun } = require('./src/db');
              const phone = normalizePhone(params.phone);
              if (!phone) return { error: 'Invalid phone number' };
              const allColNames = columns.map(c => c.name);
              const setParts = []; const vals = [];
              const extra = params.fields || params;
              for (const [k, v] of Object.entries(extra)) {
                if (k === 'phone' || k === 'fields') continue;
                if (!allColNames.includes(k) || !isSafeSqlIdent(k)) continue;
                if (k === contactTable.phoneColumn) continue;
                setParts.push(`${k} = ?`); vals.push(v);
              }
              if (!setParts.length) return { error: 'No valid fields to update' };
              const pm = contactTable.phoneMatch === 'like';
              vals.push(pm ? `%${phone}%` : phone);
              const sql = `UPDATE ${contactTable.table} SET ${setParts.join(', ')} WHERE ${contactTable.phoneColumn} ${pm ? 'LIKE' : '='} ?`;
              const r = await dbRun(db, sql, vals);
              return r.changes ? { success: true, phone, action: 'updated', changes: r.changes } : { error: 'Contact not found' };
            } catch (e) { return { error: e.message }; }
          },
        },
        // ── contacts_upsert
        {
          id: 'contacts_upsert',
          name: 'contacts_upsert',
          description: 'Add or update a contact. Inserts if new, updates if phone exists. Use contacts_schema to see available columns.',
          inputSchema: {
            type: 'object',
            properties: {
              phone: phoneProp,
              fields: { type: 'object', description: 'Column values as key-value pairs' },
            },
            required: ['phone'],
          },
          handler: async (params) => {
            try {
              const { db, columns } = await getDb();
              const { normalizePhone, isSafeSqlIdent } = require('./src/normalize');
              const { dbRun } = require('./src/db');
              const phone = normalizePhone(params.phone);
              if (!phone) return { error: 'Invalid phone number' };
              const allColNames = columns.map(c => c.name);
              const cols = [contactTable.phoneColumn]; const vals = [phone]; const upd = [];
              const extra = params.fields || params;
              for (const [k, v] of Object.entries(extra)) {
                if (k === 'phone' || k === 'fields') continue;
                if (!allColNames.includes(k) || !isSafeSqlIdent(k)) continue;
                if (k === contactTable.phoneColumn) continue;
                cols.push(k); vals.push(v); upd.push(`${k} = excluded.${k}`);
              }
              const ph = cols.map(() => '?').join(', ');
              const sql = upd.length
                ? `INSERT INTO ${contactTable.table} (${cols.join(', ')}) VALUES (${ph}) ON CONFLICT(${contactTable.phoneColumn}) DO UPDATE SET ${upd.join(', ')}`
                : `INSERT OR IGNORE INTO ${contactTable.table} (${cols.join(', ')}) VALUES (${ph})`;
              await dbRun(db, sql, vals);
              return { success: true, phone, action: 'upserted' };
            } catch (e) { return { error: e.message }; }
          },
        },
        // ── contacts_delete
        {
          id: 'contacts_delete',
          name: 'contacts_delete',
          description: 'Delete a contact by phone number.',
          inputSchema: {
            type: 'object',
            properties: { phone: phoneProp },
            required: ['phone'],
          },
          handler: async (params) => {
            try {
              const { db } = await getDb();
              const { normalizePhone } = require('./src/normalize');
              const { dbRun } = require('./src/db');
              const phone = normalizePhone(params.phone);
              if (!phone) return { error: 'Invalid phone number' };
              const pm = contactTable.phoneMatch === 'like';
              const sql = `DELETE FROM ${contactTable.table} WHERE ${contactTable.phoneColumn} ${pm ? 'LIKE' : '='} ?`;
              const r = await dbRun(db, sql, [pm ? `%${phone}%` : phone]);
              return r.changes ? { success: true, phone, action: 'deleted' } : { error: 'Contact not found' };
            } catch (e) { return { error: e.message }; }
          },
        },
        // ── contacts_search
        {
          id: 'contacts_search',
          name: 'contacts_search',
          description: 'Search contacts by partial match. Searches all text columns by default, or a specific field if provided.',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search term (partial match)' },
              field: { type: 'string', description: 'Specific column to search (optional)' },
              limit: { type: 'number', description: 'Max results (default 20, max 100)' },
            },
            required: ['query'],
          },
          handler: async (params) => {
            try {
              const { db, columns } = await getDb();
              const { isSafeSqlIdent } = require('./src/normalize');
              const { dbAll } = require('./src/db');
              const query = String(params.query || '').trim();
              if (!query) return { error: 'Search query is required' };
              const limit = Math.min(Math.max(Number(params.limit) || 20, 1), 100);
              const allColNames = columns.map(c => c.name);
              const textCols = columns.filter(c => /text|varchar|char/i.test(c.type) || c.type === '').map(c => c.name);
              let searchCols;
              if (params.field && isSafeSqlIdent(params.field) && allColNames.includes(params.field)) {
                searchCols = [params.field];
              } else {
                searchCols = textCols.length ? textCols : allColNames;
              }
              const where = searchCols.map(c => `${c} LIKE ?`);
              const sqlP = searchCols.map(() => `%${query}%`);
              sqlP.push(limit);
              const rows = await dbAll(db, `SELECT * FROM ${contactTable.table} WHERE ${where.join(' OR ')} LIMIT ?`, sqlP);
              return { results: rows, count: rows.length, query };
            } catch (e) { return { error: e.message }; }
          },
        },
        // ── contacts_list
        {
          id: 'contacts_list',
          name: 'contacts_list',
          description: 'List all contacts with pagination.',
          inputSchema: {
            type: 'object',
            properties: {
              limit: { type: 'number', description: 'Max results (default 50, max 200)' },
              offset: { type: 'number', description: 'Records to skip (default 0)' },
              orderBy: { type: 'string', description: 'Column to sort by' },
            },
          },
          handler: async (params) => {
            try {
              const { db, columns } = await getDb();
              const { isSafeSqlIdent } = require('./src/normalize');
              const { dbAll, dbGet } = require('./src/db');
              const limit = Math.min(Math.max(Number(params.limit) || 50, 1), 200);
              const offset = Math.max(Number(params.offset) || 0, 0);
              const allColNames = columns.map(c => c.name);
              let order = contactTable.phoneColumn;
              if (params.orderBy && isSafeSqlIdent(params.orderBy) && allColNames.includes(params.orderBy)) order = params.orderBy;
              const total = (await dbGet(db, `SELECT COUNT(*) as total FROM ${contactTable.table}`))?.total || 0;
              const rows = await dbAll(db, `SELECT * FROM ${contactTable.table} ORDER BY ${order} LIMIT ? OFFSET ?`, [limit, offset]);
              return { contacts: rows, total, limit, offset };
            } catch (e) { return { error: e.message }; }
          },
        },
        // ── contacts_count
        {
          id: 'contacts_count',
          name: 'contacts_count',
          description: 'Count contacts, optionally filtered by field values.',
          inputSchema: {
            type: 'object',
            properties: {
              filter: { type: 'object', description: 'Filter: keys are column names, values are match strings (LIKE)' },
            },
          },
          handler: async (params) => {
            try {
              const { db, columns } = await getDb();
              const { isSafeSqlIdent } = require('./src/normalize');
              const { dbGet } = require('./src/db');
              const allColNames = columns.map(c => c.name);
              const where = []; const sqlP = [];
              if (params.filter && typeof params.filter === 'object') {
                for (const [k, v] of Object.entries(params.filter)) {
                  if (!isSafeSqlIdent(k) || !allColNames.includes(k)) continue;
                  where.push(`${k} LIKE ?`); sqlP.push(`%${v}%`);
                }
              }
              const wc = where.length ? `WHERE ${where.join(' AND ')}` : '';
              const row = await dbGet(db, `SELECT COUNT(*) as count FROM ${contactTable.table} ${wc}`, sqlP);
              return { count: row?.count || 0 };
            } catch (e) { return { error: e.message }; }
          },
        },
        // ── contacts_import
        {
          id: 'contacts_import',
          name: 'contacts_import',
          description: 'Bulk import contacts from a JSON array. Each object must have a phone field.',
          inputSchema: {
            type: 'object',
            properties: {
              contacts: { type: 'array', description: 'Array of contact objects', items: { type: 'object' } },
              mode: { type: 'string', enum: ['insert', 'upsert'], description: 'Import mode (default: upsert)' },
            },
            required: ['contacts'],
          },
          handler: async (params) => {
            try {
              const { db, columns } = await getDb();
              const { normalizePhone, isSafeSqlIdent } = require('./src/normalize');
              const { dbRun } = require('./src/db');
              if (!Array.isArray(params.contacts) || !params.contacts.length) return { error: 'contacts must be a non-empty array' };
              const mode = params.mode || 'upsert';
              const allColNames = columns.map(c => c.name);
              let imported = 0, skipped = 0; const errors = [];
              await dbRun(db, 'BEGIN TRANSACTION');
              try {
                for (let i = 0; i < params.contacts.length; i++) {
                  const c = params.contacts[i];
                  const phone = normalizePhone(c.phone || c[contactTable.phoneColumn]);
                  if (!phone) { errors.push({ index: i, error: 'Missing phone' }); skipped++; continue; }
                  const cols = [contactTable.phoneColumn]; const vals = [phone]; const upd = [];
                  for (const [k, v] of Object.entries(c)) {
                    if (k === 'phone') continue;
                    if (!allColNames.includes(k) || !isSafeSqlIdent(k) || k === contactTable.phoneColumn) continue;
                    cols.push(k); vals.push(String(v)); upd.push(`${k} = excluded.${k}`);
                  }
                  const ph = cols.map(() => '?').join(', ');
                  const sql = mode === 'upsert' && upd.length
                    ? `INSERT INTO ${contactTable.table} (${cols.join(', ')}) VALUES (${ph}) ON CONFLICT(${contactTable.phoneColumn}) DO UPDATE SET ${upd.join(', ')}`
                    : `INSERT OR IGNORE INTO ${contactTable.table} (${cols.join(', ')}) VALUES (${ph})`;
                  try { const r = await dbRun(db, sql, vals); r.changes ? imported++ : skipped++; }
                  catch (e) { errors.push({ index: i, phone, error: e.message }); skipped++; }
                }
                await dbRun(db, 'COMMIT');
              } catch (e) { await dbRun(db, 'ROLLBACK').catch(() => {}); return { error: `Transaction failed: ${e.message}` }; }
              return { success: true, imported, skipped, total: params.contacts.length, errors: errors.length ? errors : undefined };
            } catch (e) { return { error: e.message }; }
          },
        },
        // ── contacts_export
        {
          id: 'contacts_export',
          name: 'contacts_export',
          description: 'Export all contacts as a JSON array.',
          inputSchema: {
            type: 'object',
            properties: {
              limit: { type: 'number', description: 'Max contacts (default 500, max 1000)' },
            },
          },
          handler: async (params) => {
            try {
              const { db } = await getDb();
              const { dbAll, dbGet } = require('./src/db');
              const limit = Math.min(Math.max(Number(params.limit) || 500, 1), 1000);
              const total = (await dbGet(db, `SELECT COUNT(*) as total FROM ${contactTable.table}`))?.total || 0;
              const rows = await dbAll(db, `SELECT * FROM ${contactTable.table} ORDER BY ${contactTable.phoneColumn} LIMIT ?`, [limit]);
              return { contacts: rows, exported: rows.length, total };
            } catch (e) { return { error: e.message }; }
          },
        },
        // ── contacts_schema
        {
          id: 'contacts_schema',
          name: 'contacts_schema',
          description: 'Describe the contact table schema — column names, types, and primary key.',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => {
            try {
              const { columns } = await getDb();
              return {
                table: contactTable.table,
                phoneColumn: contactTable.phoneColumn,
                columns: columns.map(c => ({ name: c.name, type: c.type, primaryKey: c.pk })),
              };
            } catch (e) { return { error: e.message }; }
          },
        },
      ];
    });

    api.logger.info('[contacts] 11 agent tools registered');

    // ── Register CLI (synchronous — handlers init DB lazily) ───────────────
    api.registerCli(({ program }) => {
      const cmd = program
        .command('contacts')
        .description('Manage SMS contacts — interactive TUI and subcommands');

      // Default: launch interactive TUI
      cmd.action(async () => {
        const { db, columns } = await getDb();
        const { launchTui } = require('./src/tui/index');
        await launchTui(db, contactTable, columns, dbPath, discovered.discoveredFrom);
      });

      // Non-interactive subcommands
      cmd.command('list')
        .description('List all contacts')
        .option('-l, --limit <n>', 'Max results', '50')
        .option('-o, --offset <n>', 'Skip records', '0')
        .action(async (opts) => {
          const { db } = await getDb();
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
          const { db, columns } = await getDb();
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
          const { db } = await getDb();
          const { dbGet } = require('./src/db');
          const row = await dbGet(db, `SELECT COUNT(*) as count FROM ${contactTable.table}`);
          console.log(JSON.stringify({ count: row?.count || 0 }));
        });

      cmd.command('schema')
        .description('Show contact table schema')
        .action(async () => {
          const { columns } = await getDb();
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
          const { db } = await getDb();
          const { dbAll } = require('./src/db');
          const limit = Math.min(Number(opts.limit) || 1000, 5000);
          const rows = await dbAll(db, `SELECT * FROM ${contactTable.table} ORDER BY ${contactTable.phoneColumn} LIMIT ?`, [limit]);
          console.log(JSON.stringify(rows, null, 2));
        });

    }, { commands: ['contacts'] });

    api.logger.info('[contacts] CLI registered: openclaw contacts');
  },
};
