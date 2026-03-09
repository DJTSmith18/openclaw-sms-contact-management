'use strict';

const { isSafeSqlIdent } = require('../normalize');
const { dbAll, dbGet } = require('../db');

/**
 * Register search/list/count/schema tools.
 */
function registerSearchTools(api, db, tableConfig, columns) {
  const { table, phoneColumn } = tableConfig;
  const allColNames = columns.map(c => c.name);
  const textColNames = columns
    .filter(c => /text|varchar|char/i.test(c.type) || c.type === '')
    .map(c => c.name);

  // ── contacts_search ──────────────────────────────────────────────────────
  api.registerTool({
    id: 'contacts_search',
    name: 'contacts_search',
    description: 'Search contacts by partial match on any field. Searches all text columns by default, or a specific field if provided.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term (partial match)' },
        field: {
          type: 'string',
          description: `Optional: specific column to search. Available: ${textColNames.join(', ')}`,
        },
        limit: { type: 'number', description: 'Max results (default 20, max 100)' },
      },
      required: ['query'],
    },
    handler: async (params) => {
      try {
        const query = String(params.query || '').trim();
        if (!query) return { error: 'Search query is required' };

        const limit = Math.min(Math.max(Number(params.limit) || 20, 1), 100);
        const likeParam = `%${query}%`;

        let whereClauses;
        let sqlParams;

        if (params.field) {
          if (!isSafeSqlIdent(params.field) || !allColNames.includes(params.field)) {
            return { error: `Invalid field: ${params.field}. Available: ${textColNames.join(', ')}` };
          }
          whereClauses = [`${params.field} LIKE ?`];
          sqlParams = [likeParam];
        } else {
          // Search across all text columns
          const searchCols = textColNames.length > 0 ? textColNames : allColNames;
          whereClauses = searchCols.map(col => `${col} LIKE ?`);
          sqlParams = searchCols.map(() => likeParam);
        }

        const sql = `SELECT * FROM ${table} WHERE ${whereClauses.join(' OR ')} LIMIT ?`;
        sqlParams.push(limit);

        const rows = await dbAll(db, sql, sqlParams);
        return { results: rows, count: rows.length, query: params.query };
      } catch (e) {
        return { error: `Search failed: ${e.message}` };
      }
    },
  });

  // ── contacts_list ────────────────────────────────────────────────────────
  api.registerTool({
    id: 'contacts_list',
    name: 'contacts_list',
    description: 'List all contacts with pagination.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max results per page (default 50, max 200)' },
        offset: { type: 'number', description: 'Number of records to skip (default 0)' },
        orderBy: {
          type: 'string',
          description: `Column to sort by. Available: ${allColNames.join(', ')}`,
        },
      },
    },
    handler: async (params) => {
      try {
        const limit = Math.min(Math.max(Number(params.limit) || 50, 1), 200);
        const offset = Math.max(Number(params.offset) || 0, 0);

        let orderClause = `ORDER BY ${phoneColumn}`;
        if (params.orderBy && isSafeSqlIdent(params.orderBy) && allColNames.includes(params.orderBy)) {
          orderClause = `ORDER BY ${params.orderBy}`;
        }

        const countRow = await dbGet(db, `SELECT COUNT(*) as total FROM ${table}`);
        const total = countRow?.total || 0;

        const sql = `SELECT * FROM ${table} ${orderClause} LIMIT ? OFFSET ?`;
        const rows = await dbAll(db, sql, [limit, offset]);

        return { contacts: rows, total, limit, offset };
      } catch (e) {
        return { error: `Failed to list contacts: ${e.message}` };
      }
    },
  });

  // ── contacts_count ───────────────────────────────────────────────────────
  api.registerTool({
    id: 'contacts_count',
    name: 'contacts_count',
    description: 'Count contacts, optionally filtered by field values.',
    inputSchema: {
      type: 'object',
      properties: {
        filter: {
          type: 'object',
          description: 'Optional filter: keys are column names, values are match strings (LIKE match)',
        },
      },
    },
    handler: async (params) => {
      try {
        const whereParts = [];
        const sqlParams = [];

        if (params.filter && typeof params.filter === 'object') {
          for (const [key, val] of Object.entries(params.filter)) {
            if (!isSafeSqlIdent(key) || !allColNames.includes(key)) continue;
            whereParts.push(`${key} LIKE ?`);
            sqlParams.push(`%${val}%`);
          }
        }

        const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';
        const sql = `SELECT COUNT(*) as count FROM ${table} ${whereClause}`;
        const row = await dbGet(db, sql, sqlParams);
        return { count: row?.count || 0 };
      } catch (e) {
        return { error: `Failed to count contacts: ${e.message}` };
      }
    },
  });

  // ── contacts_schema ──────────────────────────────────────────────────────
  api.registerTool({
    id: 'contacts_schema',
    name: 'contacts_schema',
    description: 'Describe the contact table schema — column names, types, and primary key.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async () => {
      try {
        return {
          table,
          phoneColumn,
          columns: columns.map(c => ({
            name: c.name,
            type: c.type,
            primaryKey: c.pk,
          })),
        };
      } catch (e) {
        return { error: `Failed to get schema: ${e.message}` };
      }
    },
  });
}

module.exports = { registerSearchTools };
