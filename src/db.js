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

module.exports = { openDb, dbRun, dbGet, dbAll, discoverColumns, tableExists };
