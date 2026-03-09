#!/usr/bin/env bash
set -euo pipefail

# ── SMS Contact Management — Remote Installer / Upgrader ────────────────────
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/DJTSmith18/openclaw-sms-contact-management/main/install.sh | bash
#
# Environment overrides:
#   OPENCLAW_CONFIG   — path to openclaw.json (default: ~/.openclaw/openclaw.json)
#   INSTALL_DIR       — where to install the plugin (default: ~/.openclaw/extensions/sms-contact-management)

REPO_URL="https://github.com/DJTSmith18/openclaw-sms-contact-management.git"
PLUGIN_ID="sms-contact-management"
DEFAULT_INSTALL_DIR="${HOME}/.openclaw/extensions/${PLUGIN_ID}"
INSTALL_DIR="${INSTALL_DIR:-$DEFAULT_INSTALL_DIR}"
OPENCLAW_JSON="${OPENCLAW_CONFIG:-$HOME/.openclaw/openclaw.json}"

BOLD='\033[1m'
DIM='\033[2m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}!${NC} $*"; }
err()   { echo -e "${RED}✗${NC} $*"; }
ask()   { echo -en "${CYAN}?${NC} $* "; }
header(){ echo -e "\n${BOLD}── $* ──${NC}\n"; }

# ── Detect upgrade vs fresh install ─────────────────────────────────────────

IS_UPGRADE=false
PREV_VERSION=""

if [ -d "$INSTALL_DIR" ] && [ -f "$INSTALL_DIR/package.json" ]; then
  IS_UPGRADE=true
  PREV_VERSION="$(grep '"version"' "$INSTALL_DIR/package.json" | head -1 | sed 's/.*"version".*"\(.*\)".*/\1/' || echo 'unknown')"
fi

header "SMS Contact Management Plugin — Installer"

if [ "$IS_UPGRADE" = true ]; then
  echo -e "  Detected existing installation (v${PREV_VERSION}) at:"
  echo -e "  ${DIM}${INSTALL_DIR}${NC}"
  echo ""
  ask "Upgrade to latest version? [Y/n]"
  read -r ans
  if [[ "${ans,,}" == "n" ]]; then
    echo "Aborted."
    exit 0
  fi
else
  echo "  This will install the SMS Contact Management plugin for OpenClaw."
  echo ""
fi

# ── Prerequisites ───────────────────────────────────────────────────────────

header "Step 1: Check Prerequisites"

# Node.js
if command -v node &>/dev/null; then
  NODE_VER="$(node --version)"
  NODE_MAJOR="$(echo "$NODE_VER" | sed 's/v//' | cut -d. -f1)"
  if [ "$NODE_MAJOR" -ge 18 ]; then
    info "Node.js $NODE_VER detected"
  else
    err "Node.js >= 18 required (found $NODE_VER)"
    exit 1
  fi
else
  err "Node.js not found. Please install Node.js >= 18."
  exit 1
fi

# npm
if command -v npm &>/dev/null; then
  info "npm $(npm --version) detected"
else
  err "npm not found."
  exit 1
fi

# git
if command -v git &>/dev/null; then
  info "git detected"
else
  err "git is required for installation. Please install git."
  exit 1
fi

# jq
if command -v jq &>/dev/null; then
  info "jq detected"
else
  warn "jq not found."
  ask "Install jq? [Y/n]"
  read -r ans
  if [[ "${ans,,}" != "n" ]]; then
    if command -v apt-get &>/dev/null; then
      sudo apt-get install -y jq
    elif command -v brew &>/dev/null; then
      brew install jq
    elif command -v yum &>/dev/null; then
      sudo yum install -y jq
    else
      err "Cannot auto-install jq. Please install manually."
      exit 1
    fi
    info "jq installed"
  else
    err "jq is required. Exiting."
    exit 1
  fi
fi

# ── Download / Update ───────────────────────────────────────────────────────

header "Step 2: ${IS_UPGRADE:+Update}${IS_UPGRADE:-Download} Plugin"

if [ "$IS_UPGRADE" = true ]; then
  echo "Updating existing installation..."
  (cd "$INSTALL_DIR" && git pull --ff-only 2>/dev/null) || {
    warn "git pull failed — re-cloning..."
    BACKUP_DIR="${INSTALL_DIR}.bak.$(date +%Y%m%d%H%M%S)"
    mv "$INSTALL_DIR" "$BACKUP_DIR"
    info "Previous install backed up to $BACKUP_DIR"
    git clone "$REPO_URL" "$INSTALL_DIR"
  }
else
  mkdir -p "$(dirname "$INSTALL_DIR")"
  if [ -d "$INSTALL_DIR" ]; then
    err "Directory already exists: $INSTALL_DIR"
    err "Remove it first or set INSTALL_DIR to a different path."
    exit 1
  fi
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

NEW_VERSION="$(grep '"version"' "$INSTALL_DIR/package.json" | head -1 | sed 's/.*"version".*"\(.*\)".*/\1/' || echo 'unknown')"

if [ "$IS_UPGRADE" = true ]; then
  info "Updated: v${PREV_VERSION} → v${NEW_VERSION}"
else
  info "Cloned v${NEW_VERSION} to $INSTALL_DIR"
fi

# ── npm install ─────────────────────────────────────────────────────────────

header "Step 3: Install Dependencies"
(cd "$INSTALL_DIR" && npm install --production)
info "npm dependencies installed"

# ── Check for dependency plugin ─────────────────────────────────────────────

header "Step 4: Verify SMS Plugin Dependency"

if [ ! -f "$OPENCLAW_JSON" ]; then
  warn "openclaw.json not found at $OPENCLAW_JSON"
  ask "Path to openclaw.json:"
  read -r oc_path
  OPENCLAW_JSON="${oc_path:-$OPENCLAW_JSON}"
  OPENCLAW_JSON="${OPENCLAW_JSON/#\~/$HOME}"
fi

if [ ! -f "$OPENCLAW_JSON" ]; then
  err "openclaw.json not found. Cannot configure plugin."
  echo ""
  echo "  Manual setup required. Add to your openclaw.json:"
  echo "    plugins.allow: [\"${PLUGIN_ID}\"]"
  echo "    plugins.load.paths: [\"${INSTALL_DIR}\"]"
  echo "    plugins.entries.\"${PLUGIN_ID}\": { \"enabled\": true }"
  echo ""
  exit 1
fi

# Check if voipms-sms or openclaw-twilio is configured
HAS_VOIPMS="$(jq -r '.plugins.entries["voipms-sms"].config.dbPath // empty' "$OPENCLAW_JSON" 2>/dev/null || true)"
HAS_TWILIO="$(jq -r '.plugins.entries["openclaw-twilio"].config.dbPath // empty' "$OPENCLAW_JSON" 2>/dev/null || true)"

DISCOVERED_DB=""
DISCOVERED_FROM=""

if [ -n "$HAS_VOIPMS" ]; then
  info "Found voipms-sms plugin with DB: $HAS_VOIPMS"
  DISCOVERED_DB="$HAS_VOIPMS"
  DISCOVERED_FROM="voipms-sms"
elif [ -n "$HAS_TWILIO" ]; then
  info "Found openclaw-twilio plugin with DB: $HAS_TWILIO"
  DISCOVERED_DB="$HAS_TWILIO"
  DISCOVERED_FROM="openclaw-twilio"
else
  warn "Neither voipms-sms nor openclaw-twilio is configured in openclaw.json."
  warn "The plugin requires at least one of these for database access."
  echo ""
  ask "Do you want to proceed anyway and configure manually? [y/N]"
  read -r ans
  if [[ "${ans,,}" != "y" ]]; then
    err "Install one of the SMS plugins first, then re-run this installer."
    exit 1
  fi
fi

# ── Validate database and table ─────────────────────────────────────────────

if [ -n "$DISCOVERED_DB" ]; then
  if [ -f "$DISCOVERED_DB" ]; then
    info "Database file exists: $DISCOVERED_DB"

    # Check for contact table
    CONTACT_TABLE="$(jq -r '
      [.plugins.entries["voipms-sms"].config.dids // {} | to_entries[].value.contactLookup.table // empty] |
      first // empty
    ' "$OPENCLAW_JSON" 2>/dev/null || true)"

    if [ -z "$CONTACT_TABLE" ]; then
      CONTACT_TABLE="$(jq -r '.plugins.entries["openclaw-twilio"].config.contactLookup.table // empty' "$OPENCLAW_JSON" 2>/dev/null || true)"
    fi

    if [ -n "$CONTACT_TABLE" ] && command -v sqlite3 &>/dev/null; then
      TABLE_EXISTS="$(sqlite3 "$DISCOVERED_DB" "SELECT name FROM sqlite_master WHERE type='table' AND name='$CONTACT_TABLE';" 2>/dev/null || true)"
      if [ -n "$TABLE_EXISTS" ]; then
        ROW_COUNT="$(sqlite3 "$DISCOVERED_DB" "SELECT COUNT(*) FROM $CONTACT_TABLE;" 2>/dev/null || echo '?')"
        info "Contact table '$CONTACT_TABLE' found ($ROW_COUNT rows)"
      else
        warn "Contact table '$CONTACT_TABLE' does not exist yet in the database."
        warn "Create it via the voipms-sms installer or manually before using this plugin."
      fi
    elif [ -n "$CONTACT_TABLE" ]; then
      info "Contact table configured: $CONTACT_TABLE (sqlite3 CLI not available to verify)"
    else
      warn "No contactLookup table configured on any DID."
      warn "Configure contactLookup on a DID in voipms-sms, or set contactTable manually in this plugin's config."
    fi
  else
    warn "Database file not found at $DISCOVERED_DB"
    warn "It may be created when the SMS plugin starts. This is OK."
  fi
fi

# ── Write openclaw.json ────────────────────────────────────────────────────

header "Step 5: Update openclaw.json"

# Check if already configured (upgrade scenario)
ALREADY_CONFIGURED="$(jq -r ".plugins.entries[\"${PLUGIN_ID}\"].enabled // false" "$OPENCLAW_JSON" 2>/dev/null || echo 'false')"

if [ "$IS_UPGRADE" = true ] && [ "$ALREADY_CONFIGURED" = "true" ]; then
  info "Plugin already configured in openclaw.json — preserving existing config"
else
  # Backup
  cp "$OPENCLAW_JSON" "${OPENCLAW_JSON}.bak"
  info "Backed up to ${OPENCLAW_JSON}.bak"

  # Build plugin config
  PLUGIN_CONFIG='{}'
  if [ -n "$DISCOVERED_FROM" ]; then
    PLUGIN_CONFIG="$(jq -n --arg from "$DISCOVERED_FROM" '{ discoverFrom: $from }')"
  fi

  # Update openclaw.json
  TMPFILE="$(mktemp)"
  jq --arg pluginPath "$INSTALL_DIR" \
     --arg pluginId "$PLUGIN_ID" \
     --argjson pluginConfig "$PLUGIN_CONFIG" \
     '
    .plugins //= {} |
    .plugins.allow //= [] |
    .plugins.load //= {} |
    .plugins.load.paths //= [] |
    .plugins.entries //= {} |

    # Add to allow list if not present
    (if (.plugins.allow | index($pluginId)) then . else .plugins.allow += [$pluginId] end) |

    # Add plugin path if not present
    (if (.plugins.load.paths | index($pluginPath)) then . else .plugins.load.paths += [$pluginPath] end) |

    # Set plugin config
    .plugins.entries[$pluginId] = {
      enabled: true,
      config: $pluginConfig
    }
  ' "$OPENCLAW_JSON" > "$TMPFILE" && mv "$TMPFILE" "$OPENCLAW_JSON"

  info "Plugin config written to openclaw.json"
fi

# ── Summary ─────────────────────────────────────────────────────────────────

header "Installation Complete"
echo ""
if [ "$IS_UPGRADE" = true ]; then
  info "Upgraded: v${PREV_VERSION} → v${NEW_VERSION}"
else
  info "Installed: v${NEW_VERSION}"
fi
info "Plugin path: $INSTALL_DIR"
if [ -n "$DISCOVERED_DB" ]; then
  info "Database: $DISCOVERED_DB (from $DISCOVERED_FROM)"
fi
echo ""
echo -e "  ${BOLD}Agent tools registered:${NC}"
echo "    contacts_get, contacts_add, contacts_update, contacts_upsert,"
echo "    contacts_delete, contacts_search, contacts_list, contacts_count,"
echo "    contacts_import, contacts_export, contacts_schema"
echo ""
echo -e "  ${BOLD}Interactive TUI:${NC}"
echo "    openclaw contacts"
echo ""
echo -e "  ${BOLD}CLI subcommands:${NC}"
echo "    openclaw contacts list|search|count|schema|export"
echo ""
echo "  Restart OpenClaw to activate the plugin."
echo ""
