'use strict';

const sqlite3 = require('sqlite3').verbose();
const { isSafeSqlIdent } = require('./normalize');

function openDb(dbPath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) return reject(err);
      db.run('PRAGMA journal_mode=WAL;');
      db.run('PRAGMA busy_timeout=10000;');
      db.run('PRAGMA foreign_keys=ON;');
      resolve(db);
    });
  });
}

function dbRun(db, sql, params = []) {
  return new Promise((res, rej) =>
    db.run(sql, params, function (err) { err ? rej(err) : res(this); })
  );
}

function dbGet(db, sql, params = []) {
  return new Promise((res, rej) =>
    db.get(sql, params, (err, row) => err ? rej(err) : res(row))
  );
}

function dbAll(db, sql, params = []) {
  return new Promise((res, rej) =>
    db.all(sql, params, (err, rows) => err ? rej(err) : res(rows))
  );
}

/**
 * Introspect table columns via PRAGMA table_info.
 * Returns array of { name, type, pk } objects.
 */
async function discoverColumns(db, tableName) {
  if (!isSafeSqlIdent(tableName)) return null;
  const rows = await dbAll(db, `PRAGMA table_info(${tableName})`);
  if (!rows || rows.length === 0) return null;
  return rows.map(r => ({
    name: r.name,
    type: r.type || 'TEXT',
    pk: r.pk === 1,
  }));
}

/**
 * Check if a table exists in the database.
 */
async function tableExists(db, tableName) {
  if (!isSafeSqlIdent(tableName)) return false;
  const row = await dbGet(
    db,
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    [tableName]
  );
  return !!row;
}

/**
 * Add a column to a table via ALTER TABLE.
 * Returns { success: true } or throws on error.
 */
async function addColumn(db, tableName, colName, colType) {
  if (!isSafeSqlIdent(tableName)) throw new Error(`Invalid table name: ${tableName}`);
  if (!isSafeSqlIdent(colName)) throw new Error(`Invalid column name: ${colName}`);
  // Whitelist common SQLite types
  const safeType = String(colType || 'TEXT').toUpperCase().replace(/[^A-Z() ,0-9]/g, '');
  await dbRun(db, `ALTER TABLE ${tableName} ADD COLUMN ${colName} ${safeType}`);
  return { success: true };
}

/**
 * Update selectColumns in sibling plugin configs (voipms-sms, openclaw-twilio)
 * to include a newly added column.
 *
 * @param {object} runtime - api.runtime (must have runtime.config.loadConfig/writeConfigFile)
 * @param {string} colName - The new column name to add
 * @returns {{ updated: string[], skipped: string[], errors: string[] }}
 */
async function updateSiblingSelectColumns(runtime, colName) {
  const result = { updated: [], skipped: [], errors: [] };
  if (!runtime?.config?.loadConfig || !runtime?.config?.writeConfigFile) {
    result.errors.push('runtime.config not available — cannot update openclaw.json');
    return result;
  }

  try {
    const config = runtime.config.loadConfig();
    const entries = config?.plugins?.entries;
    if (!entries) {
      result.skipped.push('No plugins.entries in config');
      return result;
    }

    let changed = false;

    // voipms-sms: selectColumns is per-DID inside dids.<did>.contactLookup
    const voipms = entries['voipms-sms'];
    if (voipms?.config?.dids) {
      for (const [did, didCfg] of Object.entries(voipms.config.dids)) {
        if (didCfg.contactLookup) {
          if (!didCfg.contactLookup.selectColumns) {
            result.skipped.push(`voipms-sms DID ${did}: no selectColumns array (uses all columns)`);
          } else if (didCfg.contactLookup.selectColumns.includes(colName)) {
            result.skipped.push(`voipms-sms DID ${did}: column already in selectColumns`);
          } else {
            didCfg.contactLookup.selectColumns.push(colName);
            result.updated.push(`voipms-sms DID ${did}`);
            changed = true;
          }
        }
      }
    } else {
      result.skipped.push('voipms-sms: not configured or no DIDs');
    }

    // openclaw-twilio: selectColumns is directly in contactLookup
    const twilio = entries['openclaw-twilio'];
    if (twilio?.config?.contactLookup) {
      if (!twilio.config.contactLookup.selectColumns) {
        result.skipped.push('openclaw-twilio: no selectColumns array');
      } else if (twilio.config.contactLookup.selectColumns.includes(colName)) {
        result.skipped.push('openclaw-twilio: column already in selectColumns');
      } else {
        twilio.config.contactLookup.selectColumns.push(colName);
        result.updated.push('openclaw-twilio');
        changed = true;
      }
    } else {
      result.skipped.push('openclaw-twilio: not configured');
    }

    if (changed) {
      await runtime.config.writeConfigFile(config);
    }
  } catch (e) {
    result.errors.push(`Config update failed: ${e.message}`);
  }

  return result;
}

module.exports = { openDb, dbRun, dbGet, dbAll, discoverColumns, tableExists, addColumn, updateSiblingSelectColumns };
