# sms-contact-management — Agent Tools

This plugin provides 12 tools for managing SMS contacts in the shared database.

## Tools

### `contacts_get`
Look up a contact by phone number.
- `phone` (required) — 10-digit phone number

### `contacts_add`
Add a new contact. Fails if phone already exists.
- `phone` (required) — 10-digit phone number
- Plus any column fields from the contact table schema

### `contacts_update`
Update an existing contact's fields. Only provided fields are modified.
- `phone` (required) — phone number of the contact to update
- Plus any column fields to update

### `contacts_upsert`
Add or update a contact. If the phone exists, updates; otherwise inserts.
- `phone` (required) — 10-digit phone number
- Plus any column fields

### `contacts_delete`
Delete a contact by phone number.
- `phone` (required) — phone number to delete

### `contacts_search`
Search contacts by partial match on any text field.
- `query` (required) — search term
- `field` (optional) — specific column to search (defaults to all text columns)
- `limit` (optional) — max results (default 20, max 100)

### `contacts_list`
List all contacts with pagination.
- `limit` (optional) — max results per page (default 50, max 200)
- `offset` (optional) — records to skip (default 0)
- `orderBy` (optional) — column to sort by

### `contacts_count`
Count contacts, optionally filtered.
- `filter` (optional) — object with column names as keys and match strings as values

### `contacts_import`
Bulk import contacts from a JSON array.
- `contacts` (required) — array of contact objects (each must have a phone field)
- `mode` (optional) — "insert" or "upsert" (default: upsert)

### `contacts_export`
Export all contacts as JSON.
- `limit` (optional) — max contacts (default 500, max 1000)

### `contacts_schema`
Describe the contact table schema (column names, types, primary key).
- No parameters required

### `contacts_add_column`
Add a new column to the contact table. Also updates `selectColumns` in voipms-sms/twilio plugin config if present.
- `name` (required) — column name (alphanumeric + underscore)
- `type` (optional) — SQLite type: TEXT, INTEGER, REAL, or BLOB (default: TEXT)
