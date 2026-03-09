'use strict';

const { normalizePhone, isSafeSqlIdent } = require('../normalize');
const { dbRun, dbGet } = require('../db');

/**
 * Build dynamic column properties for tool inputSchema from discovered columns.
 */
function buildColumnProperties(columns, phoneColumn) {
  const props = {};
  for (const col of columns) {
    if (col.name === phoneColumn) continue;
    props[col.name] = {
      type: 'string',
      description: `Value for column '${col.name}' (${col.type})`,
    };
  }
  return props;
}

/**
 * Register CRUD tools: contacts_get, contacts_add, contacts_update, contacts_upsert, contacts_delete
 */
function registerCrudTools(api, db, tableConfig, columns) {
  const { table, phoneColumn, phoneMatch } = tableConfig;
  const colProps = buildColumnProperties(columns, phoneColumn);
  const allColNames = columns.map(c => c.name);

  // ── contacts_get ─────────────────────────────────────────────────────────
  api.registerTool({
    id: 'contacts_get',
    name: 'contacts_get',
    description: 'Look up a contact by phone number.',
    inputSchema: {
      type: 'object',
      properties: {
        phone: { type: 'string', description: 'Phone number to look up (10 digits)' },
      },
      required: ['phone'],
    },
    handler: async (params) => {
      try {
        const phone = normalizePhone(params.phone);
        if (!phone) return { error: 'Invalid phone number' };

        let sql, sqlParams;
        if (phoneMatch === 'like') {
          sql = `SELECT * FROM ${table} WHERE ${phoneColumn} LIKE ? LIMIT 1`;
          sqlParams = [`%${phone}%`];
        } else {
          sql = `SELECT * FROM ${table} WHERE ${phoneColumn} = ? LIMIT 1`;
          sqlParams = [phone];
        }

        const row = await dbGet(db, sql, sqlParams);
        if (!row) return { found: false, phone };
        return { found: true, contact: row };
      } catch (e) {
        return { error: `Failed to get contact: ${e.message}` };
      }
    },
  });

  // ── contacts_add ─────────────────────────────────────────────────────────
  api.registerTool({
    id: 'contacts_add',
    name: 'contacts_add',
    description: 'Add a new contact to the database. Fails if the phone number already exists.',
    inputSchema: {
      type: 'object',
      properties: {
        phone: { type: 'string', description: 'Phone number (10 digits)' },
        ...colProps,
      },
      required: ['phone'],
    },
    handler: async (params) => {
      try {
        const phone = normalizePhone(params.phone);
        if (!phone) return { error: 'Invalid phone number' };

        const cols = [phoneColumn];
        const vals = [phone];

        for (const [key, val] of Object.entries(params)) {
          if (key === 'phone') continue;
          if (!allColNames.includes(key)) continue;
          if (!isSafeSqlIdent(key)) continue;
          if (key === phoneColumn) continue;
          cols.push(key);
          vals.push(val);
        }

        const placeholders = cols.map(() => '?').join(', ');
        const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`;
        await dbRun(db, sql, vals);
        return { success: true, phone, action: 'added' };
      } catch (e) {
        if (e.message.includes('UNIQUE constraint')) {
          return { error: `Contact with phone ${normalizePhone(params.phone)} already exists. Use contacts_update or contacts_upsert instead.` };
        }
        return { error: `Failed to add contact: ${e.message}` };
      }
    },
  });

  // ── contacts_update ──────────────────────────────────────────────────────
  api.registerTool({
    id: 'contacts_update',
    name: 'contacts_update',
    description: 'Update an existing contact\'s fields. Only provided fields are modified.',
    inputSchema: {
      type: 'object',
      properties: {
        phone: { type: 'string', description: 'Phone number of the contact to update' },
        ...colProps,
      },
      required: ['phone'],
    },
    handler: async (params) => {
      try {
        const phone = normalizePhone(params.phone);
        if (!phone) return { error: 'Invalid phone number' };

        const setParts = [];
        const vals = [];

        for (const [key, val] of Object.entries(params)) {
          if (key === 'phone') continue;
          if (!allColNames.includes(key)) continue;
          if (!isSafeSqlIdent(key)) continue;
          if (key === phoneColumn) continue;
          setParts.push(`${key} = ?`);
          vals.push(val);
        }

        if (setParts.length === 0) {
          return { error: 'No valid fields provided to update' };
        }

        let whereClause;
        if (phoneMatch === 'like') {
          whereClause = `${phoneColumn} LIKE ?`;
          vals.push(`%${phone}%`);
        } else {
          whereClause = `${phoneColumn} = ?`;
          vals.push(phone);
        }

        const sql = `UPDATE ${table} SET ${setParts.join(', ')} WHERE ${whereClause}`;
        const result = await dbRun(db, sql, vals);
        if (result.changes === 0) {
          return { error: 'Contact not found', phone };
        }
        return { success: true, phone, action: 'updated', changes: result.changes };
      } catch (e) {
        return { error: `Failed to update contact: ${e.message}` };
      }
    },
  });

  // ── contacts_upsert ──────────────────────────────────────────────────────
  api.registerTool({
    id: 'contacts_upsert',
    name: 'contacts_upsert',
    description: 'Add or update a contact. If the phone number exists, updates the provided fields; otherwise inserts a new contact.',
    inputSchema: {
      type: 'object',
      properties: {
        phone: { type: 'string', description: 'Phone number (10 digits)' },
        ...colProps,
      },
      required: ['phone'],
    },
    handler: async (params) => {
      try {
        const phone = normalizePhone(params.phone);
        if (!phone) return { error: 'Invalid phone number' };

        const cols = [phoneColumn];
        const vals = [phone];
        const updateParts = [];

        for (const [key, val] of Object.entries(params)) {
          if (key === 'phone') continue;
          if (!allColNames.includes(key)) continue;
          if (!isSafeSqlIdent(key)) continue;
          if (key === phoneColumn) continue;
          cols.push(key);
          vals.push(val);
          updateParts.push(`${key} = excluded.${key}`);
        }

        const placeholders = cols.map(() => '?').join(', ');
        const colList = cols.join(', ');

        let sql;
        if (updateParts.length > 0) {
          sql = `INSERT INTO ${table} (${colList}) VALUES (${placeholders}) ON CONFLICT(${phoneColumn}) DO UPDATE SET ${updateParts.join(', ')}`;
        } else {
          sql = `INSERT OR IGNORE INTO ${table} (${colList}) VALUES (${placeholders})`;
        }

        await dbRun(db, sql, vals);
        return { success: true, phone, action: 'upserted' };
      } catch (e) {
        return { error: `Failed to upsert contact: ${e.message}` };
      }
    },
  });

  // ── contacts_delete ──────────────────────────────────────────────────────
  api.registerTool({
    id: 'contacts_delete',
    name: 'contacts_delete',
    description: 'Delete a contact by phone number.',
    inputSchema: {
      type: 'object',
      properties: {
        phone: { type: 'string', description: 'Phone number of the contact to delete' },
      },
      required: ['phone'],
    },
    handler: async (params) => {
      try {
        const phone = normalizePhone(params.phone);
        if (!phone) return { error: 'Invalid phone number' };

        let sql, sqlParams;
        if (phoneMatch === 'like') {
          sql = `DELETE FROM ${table} WHERE ${phoneColumn} LIKE ?`;
          sqlParams = [`%${phone}%`];
        } else {
          sql = `DELETE FROM ${table} WHERE ${phoneColumn} = ?`;
          sqlParams = [phone];
        }

        const result = await dbRun(db, sql, sqlParams);
        if (result.changes === 0) {
          return { error: 'Contact not found', phone };
        }
        return { success: true, phone, action: 'deleted', changes: result.changes };
      } catch (e) {
        return { error: `Failed to delete contact: ${e.message}` };
      }
    },
  });
}

module.exports = { registerCrudTools };
