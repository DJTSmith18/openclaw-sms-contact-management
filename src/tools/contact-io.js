'use strict';

const { normalizePhone, isSafeSqlIdent } = require('../normalize');
const { dbRun, dbAll, dbGet } = require('../db');

/**
 * Register import/export tools.
 */
function registerIoTools(api, db, tableConfig, columns) {
  const { table, phoneColumn } = tableConfig;
  const allColNames = columns.map(c => c.name);

  // ── contacts_import ──────────────────────────────────────────────────────
  api.registerTool({
    id: 'contacts_import',
    name: 'contacts_import',
    description: 'Bulk import contacts from a JSON array. Each object must include a phone number. Wraps in a transaction for atomicity.',
    inputSchema: {
      type: 'object',
      properties: {
        contacts: {
          type: 'array',
          description: 'Array of contact objects. Each must have a phone field.',
          items: { type: 'object' },
        },
        mode: {
          type: 'string',
          enum: ['insert', 'upsert'],
          description: 'Import mode: "insert" (skip duplicates) or "upsert" (update existing). Default: upsert.',
        },
      },
      required: ['contacts'],
    },
    handler: async (params) => {
      try {
        const contacts = params.contacts;
        if (!Array.isArray(contacts) || contacts.length === 0) {
          return { error: 'contacts must be a non-empty array' };
        }

        const mode = params.mode || 'upsert';
        let imported = 0;
        let skipped = 0;
        const errors = [];

        await dbRun(db, 'BEGIN TRANSACTION');

        try {
          for (let i = 0; i < contacts.length; i++) {
            const contact = contacts[i];
            const phone = normalizePhone(contact.phone || contact[phoneColumn]);
            if (!phone) {
              errors.push({ index: i, error: 'Missing or invalid phone number' });
              skipped++;
              continue;
            }

            const cols = [phoneColumn];
            const vals = [phone];
            const updateParts = [];

            for (const [key, val] of Object.entries(contact)) {
              if (key === 'phone') continue;
              if (!allColNames.includes(key)) continue;
              if (!isSafeSqlIdent(key)) continue;
              if (key === phoneColumn) continue;
              cols.push(key);
              vals.push(String(val));
              updateParts.push(`${key} = excluded.${key}`);
            }

            const placeholders = cols.map(() => '?').join(', ');
            const colList = cols.join(', ');

            let sql;
            if (mode === 'upsert' && updateParts.length > 0) {
              sql = `INSERT INTO ${table} (${colList}) VALUES (${placeholders}) ON CONFLICT(${phoneColumn}) DO UPDATE SET ${updateParts.join(', ')}`;
            } else {
              sql = `INSERT OR IGNORE INTO ${table} (${colList}) VALUES (${placeholders})`;
            }

            try {
              const result = await dbRun(db, sql, vals);
              if (result.changes > 0) {
                imported++;
              } else {
                skipped++;
              }
            } catch (rowErr) {
              errors.push({ index: i, phone, error: rowErr.message });
              skipped++;
            }
          }

          await dbRun(db, 'COMMIT');
        } catch (txErr) {
          await dbRun(db, 'ROLLBACK').catch(() => {});
          return { error: `Import transaction failed: ${txErr.message}` };
        }

        return {
          success: true,
          imported,
          skipped,
          total: contacts.length,
          errors: errors.length > 0 ? errors : undefined,
        };
      } catch (e) {
        return { error: `Import failed: ${e.message}` };
      }
    },
  });

  // ── contacts_export ──────────────────────────────────────────────────────
  api.registerTool({
    id: 'contacts_export',
    name: 'contacts_export',
    description: 'Export all contacts as a JSON array.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max contacts to export (default 500, max 1000)' },
      },
    },
    handler: async (params) => {
      try {
        const limit = Math.min(Math.max(Number(params.limit) || 500, 1), 1000);

        const countRow = await dbGet(db, `SELECT COUNT(*) as total FROM ${table}`);
        const total = countRow?.total || 0;

        const sql = `SELECT * FROM ${table} ORDER BY ${phoneColumn} LIMIT ?`;
        const rows = await dbAll(db, sql, [limit]);

        return { contacts: rows, exported: rows.length, total };
      } catch (e) {
        return { error: `Export failed: ${e.message}` };
      }
    },
  });
}

module.exports = { registerIoTools };
