# sms-contact-management — OpenClaw Plugin

Full-featured contact management for the shared SMS database used by [voipms-sms](https://github.com/DJTSmith18/openclaw-voipms-sms) and openclaw-twilio plugins.

Provides **11 agent tools** for AI-driven contact management and an **interactive blessed TUI** for human operators.

## Requirements

- **OpenClaw** with at least one of:
  - `voipms-sms` plugin (configured with `dbPath` and `contactLookup`)
  - `openclaw-twilio` plugin (configured with `dbPath` and `contactLookup`)
- **Node.js** >= 18
- **npm**
- The contact table must already exist in the database (created by the SMS plugin installer or manually)

---

## Installation

### Quick Install (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/DJTSmith18/openclaw-sms-contact-management/main/install.sh | bash
```

The installer will:
1. Check prerequisites (Node.js, npm, git, jq)
2. Clone the repository to `~/.openclaw/extensions/sms-contact-management/`
3. Install npm dependencies
4. Auto-discover database path and contact table from your voipms-sms or twilio config
5. Validate the database and table exist
6. Write plugin config to `openclaw.json`

#### Environment overrides

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENCLAW_CONFIG` | `~/.openclaw/openclaw.json` | Path to your OpenClaw config |
| `INSTALL_DIR` | `~/.openclaw/extensions/sms-contact-management` | Install location |

Example with custom paths:

```bash
OPENCLAW_CONFIG=/opt/openclaw/openclaw.json INSTALL_DIR=/opt/openclaw/extensions/sms-contact-management \
  curl -fsSL https://raw.githubusercontent.com/DJTSmith18/openclaw-sms-contact-management/main/install.sh | bash
```

### Manual Install

1. Clone the repository:
   ```bash
   cd ~/.openclaw/extensions
   git clone https://github.com/DJTSmith18/openclaw-sms-contact-management.git sms-contact-management
   cd sms-contact-management
   npm install --production
   ```

2. Add to your `openclaw.json`:
   ```json
   {
     "plugins": {
       "allow": ["sms-contact-management"],
       "load": {
         "paths": ["~/.openclaw/extensions/sms-contact-management"]
       },
       "entries": {
         "sms-contact-management": {
           "enabled": true,
           "config": {}
         }
       }
     }
   }
   ```

3. Restart OpenClaw.

---

## Upgrading

### Automatic upgrade

Run the same install command — it detects the existing installation and upgrades:

```bash
curl -fsSL https://raw.githubusercontent.com/DJTSmith18/openclaw-sms-contact-management/main/install.sh | bash
```

The upgrader will:
- Detect the previous version
- Pull the latest code (or re-clone if pull fails)
- Run `npm install`
- Preserve your existing config in `openclaw.json`

### Manual upgrade

```bash
cd ~/.openclaw/extensions/sms-contact-management
git pull
npm install --production
```

Restart OpenClaw.

---

## Uninstall

1. Remove the plugin directory:
   ```bash
   rm -rf ~/.openclaw/extensions/sms-contact-management
   ```

2. Remove from `openclaw.json`:
   - Remove `"sms-contact-management"` from `plugins.allow`
   - Remove the path from `plugins.load.paths`
   - Remove `plugins.entries["sms-contact-management"]`

3. Restart OpenClaw.

---

## Configuration

The plugin auto-discovers its config from the voipms-sms or twilio plugin. All fields are optional.

```json
{
  "plugins": {
    "entries": {
      "sms-contact-management": {
        "enabled": true,
        "config": {
          "discoverFrom": "auto",
          "dbPath": "/path/to/sms.db",
          "contactTable": {
            "table": "contacts",
            "phoneColumn": "phone",
            "columns": ["phone", "name", "email", "preferred_language"],
            "displayName": "name",
            "phoneMatch": "exact"
          }
        }
      }
    }
  }
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `discoverFrom` | `"auto"` | Which plugin to discover config from: `"voipms-sms"`, `"openclaw-twilio"`, or `"auto"` (tries both) |
| `dbPath` | auto-discovered | Path to SQLite database |
| `contactTable.table` | auto-discovered | Contact table name |
| `contactTable.phoneColumn` | auto-discovered | Phone number column |
| `contactTable.columns` | auto-discovered via PRAGMA | Allowed columns for read/write |
| `contactTable.displayName` | auto-discovered | Column for display name |
| `contactTable.phoneMatch` | `"exact"` | `"exact"` or `"like"` for phone lookups |

---

## Agent Tools

11 tools are registered for AI agents:

| Tool | Description |
|------|-------------|
| `contacts_get` | Look up a contact by phone number |
| `contacts_add` | Add a new contact |
| `contacts_update` | Update existing contact fields |
| `contacts_upsert` | Add or update a contact |
| `contacts_delete` | Delete a contact |
| `contacts_search` | Search contacts by partial match |
| `contacts_list` | List contacts with pagination |
| `contacts_count` | Count contacts with optional filter |
| `contacts_import` | Bulk import from JSON array |
| `contacts_export` | Export contacts as JSON |
| `contacts_schema` | Describe table schema |

See [TOOLS.md](TOOLS.md) for full parameter documentation.

---

## Interactive TUI

Launch the full-screen terminal dashboard:

```bash
openclaw contacts
```

### Layout

```
┌──────────────────────────────────────────────────────────────┐
│ SMS Contact Management — contacts                            │
├──────────────┬───────────────────────────────────────────────┤
│  Menu        │  Content                                      │
│              │                                               │
│  List        │  ┌─ Contacts ──────────────────────────────┐  │
│  Search      │  │ phone       name        email           │  │
│  Add         │  │ 5551234567  Jane Doe    jane@ex.com     │  │
│  Edit        │  │ 5559876543  John Smith  john@ex.com     │  │
│  Delete      │  │ ...                                     │  │
│  Import      │  └─────────────────────────────────────────┘  │
│  Export      │                                               │
│  Schema      │  Page 1/3 | 75 contacts | n=next p=prev      │
│  DB Info     │                                               │
│  Quit        │                                               │
├──────────────┴───────────────────────────────────────────────┤
│ DB: /path/to/sms.db | Tab=switch | q=quit | Esc=back        │
└──────────────────────────────────────────────────────────────┘
```

### Keybindings

| Key | Action |
|-----|--------|
| `Tab` | Switch between menu and content panels |
| `Enter` | Select menu item / confirm |
| `Escape` | Go back to menu |
| `q` / `Ctrl+C` | Quit |
| `n` / `p` | Next / previous page (in list view) |
| `/` | Jump to search view |
| Arrow keys | Navigate |

### Views

- **List** — Paginated scrollable contact table (25 per page)
- **Search** — Type query, results update on Enter. Press `/` from results to search again
- **Add** — Form with fields for each column. Tab between fields, save or cancel
- **Edit** — Enter phone number, edit fields inline
- **Delete** — Enter phone number, confirm before deleting
- **Import** — Provide file path (JSON or CSV), preview first 5 records, confirm import
- **Export** — Choose format (JSON/CSV) and output file path
- **Schema** — Table of column names, types, and primary key status
- **DB Info** — Database path, source plugin, row count, all tables in DB

---

## CLI Subcommands

Non-interactive commands for scripting:

```bash
openclaw contacts list [--limit 50] [--offset 0]
openclaw contacts search <query> [--field name] [--limit 20]
openclaw contacts count
openclaw contacts schema
openclaw contacts export [--limit 1000]
```

Output is JSON for easy piping:

```bash
openclaw contacts list --limit 10 | jq '.'
openclaw contacts search "Jane" --field name | jq '.results[].phone'
```

---

## Database

This plugin shares the SQLite database with voipms-sms and/or openclaw-twilio. It does **not** create the contacts table — it expects the table to already exist.

Example contact table (typically created by the voipms-sms installer):

```sql
CREATE TABLE contacts (
  phone TEXT PRIMARY KEY,
  name  TEXT,
  email TEXT,
  preferred_language TEXT
);
```

The plugin dynamically discovers the table schema at startup via `PRAGMA table_info()`, so it works with any column layout.

---

## Troubleshooting

### Plugin not loading
- Verify `plugins.allow` includes `"sms-contact-management"`
- Verify `plugins.load.paths` includes the plugin directory
- Check OpenClaw logs for `[contacts]` messages

### "No dbPath found"
- Ensure voipms-sms or openclaw-twilio is configured with a `dbPath`
- Or set `dbPath` manually in the contact management plugin config

### "Table does not exist"
- Create the contacts table first via the voipms-sms installer or manually
- The plugin requires the table to already exist — it does not auto-create

### "No contactLookup configured"
- Configure `contactLookup` on at least one DID in voipms-sms
- Or set `contactTable` manually in this plugin's config
