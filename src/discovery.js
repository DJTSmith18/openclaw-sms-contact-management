'use strict';

/**
 * Discover dbPath and contactTable config from sibling plugins (voipms-sms or openclaw-twilio).
 *
 * @param {object} apiConfig - Full OpenClaw config (api.config)
 * @param {object} ownConfig - This plugin's config (api.pluginConfig)
 * @returns {{ dbPath: string|null, contactTable: object|null, discoveredFrom: string|null, error: string|null }}
 */
function discoverConfig(apiConfig, ownConfig) {
  const cfg = ownConfig || {};

  // If fully specified manually, use as-is
  if (cfg.dbPath && cfg.contactTable && cfg.contactTable.table && cfg.contactTable.phoneColumn) {
    return {
      dbPath: cfg.dbPath,
      contactTable: cfg.contactTable,
      discoveredFrom: 'manual',
      error: null,
    };
  }

  // Determine which plugins to probe
  const discoverFrom = cfg.discoverFrom || 'auto';
  let sources;
  if (discoverFrom === 'auto') {
    sources = ['voipms-sms', 'openclaw-twilio'];
  } else {
    sources = [discoverFrom];
  }

  const entries = apiConfig?.plugins?.entries || {};

  for (const sourceId of sources) {
    const srcEntry = entries[sourceId];
    if (!srcEntry || !srcEntry.config) continue;
    const srcCfg = srcEntry.config;

    // Extract dbPath
    const dbPath = cfg.dbPath || srcCfg.dbPath;
    if (!dbPath) continue;

    // Extract contactTable from own config or from source plugin's contactLookup
    let contactTable = cfg.contactTable || null;

    if (!contactTable && srcCfg.dids) {
      // voipms-sms stores contactLookup per-DID — take the first one configured
      for (const [, didCfg] of Object.entries(srcCfg.dids)) {
        if (didCfg.contactLookup) {
          contactTable = {
            table: didCfg.contactLookup.table,
            phoneColumn: didCfg.contactLookup.phoneColumn,
            columns: didCfg.contactLookup.selectColumns || null,
            displayName: didCfg.contactLookup.displayName || null,
            phoneMatch: didCfg.contactLookup.phoneMatch || 'exact',
          };
          break;
        }
      }
    }

    // For twilio plugin — may use a different config shape
    if (!contactTable && srcCfg.contactLookup) {
      contactTable = {
        table: srcCfg.contactLookup.table,
        phoneColumn: srcCfg.contactLookup.phoneColumn,
        columns: srcCfg.contactLookup.selectColumns || null,
        displayName: srcCfg.contactLookup.displayName || null,
        phoneMatch: srcCfg.contactLookup.phoneMatch || 'exact',
      };
    }

    if (dbPath && contactTable) {
      return { dbPath, contactTable, discoveredFrom: sourceId, error: null };
    }

    // Have dbPath but no contactTable — still partially useful
    if (dbPath) {
      return {
        dbPath,
        contactTable: contactTable || null,
        discoveredFrom: sourceId,
        error: contactTable ? null : `Found dbPath from ${sourceId} but no contactLookup configured on any DID`,
      };
    }
  }

  return {
    dbPath: null,
    contactTable: null,
    discoveredFrom: null,
    error: 'Could not discover config — ensure voipms-sms or openclaw-twilio is configured with a dbPath and contactLookup',
  };
}

module.exports = { discoverConfig };
