//! Local persistence (SQLite via rusqlite): saved requests + request history.
//!
//! The database lives in the app data directory. Requests are stored as JSON
//! blobs so the schema stays stable as the request model evolves.

use crate::model::{Collection, HistoryEntry, SavedEnvironment, SavedRequest};
use rusqlite::{params, Connection};
use std::path::Path;
use std::sync::Mutex;

/// Managed Tauri state wrapping the SQLite connection.
pub struct Db(pub Mutex<Connection>);

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS saved_requests (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    request     TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS history (
    id          TEXT PRIMARY KEY,
    request     TEXT NOT NULL,
    status      INTEGER,
    total_ms    REAL NOT NULL,
    ok          INTEGER NOT NULL,
    created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_history_created ON history(created_at DESC);
CREATE TABLE IF NOT EXISTS environments (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    variables   TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS collections (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    items       TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);
"#;

/// Open (creating if needed) the database and ensure the schema exists.
pub fn open(path: &Path) -> anyhow::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(SCHEMA)?;
    Ok(conn)
}

pub fn save_request(conn: &Connection, item: &SavedRequest) -> anyhow::Result<()> {
    let request_json = serde_json::to_string(&item.request)?;
    conn.execute(
        "INSERT INTO saved_requests (id, name, request, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            request = excluded.request,
            updated_at = excluded.updated_at",
        params![
            item.id,
            item.name,
            request_json,
            item.created_at,
            item.updated_at
        ],
    )?;
    Ok(())
}

pub fn list_saved(conn: &Connection) -> anyhow::Result<Vec<SavedRequest>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, request, created_at, updated_at
         FROM saved_requests ORDER BY updated_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        let request_json: String = row.get(2)?;
        let request = serde_json::from_str(&request_json).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(2, rusqlite::types::Type::Text, Box::new(e))
        })?;
        Ok(SavedRequest {
            id: row.get(0)?,
            name: row.get(1)?,
            request,
            created_at: row.get(3)?,
            updated_at: row.get(4)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn delete_saved(conn: &Connection, id: &str) -> anyhow::Result<()> {
    conn.execute("DELETE FROM saved_requests WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn add_history(conn: &Connection, entry: &HistoryEntry) -> anyhow::Result<()> {
    let request_json = serde_json::to_string(&entry.request)?;
    conn.execute(
        "INSERT INTO history (id, request, status, total_ms, ok, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            entry.id,
            request_json,
            entry.status,
            entry.total_ms,
            entry.ok as i64,
            entry.created_at
        ],
    )?;
    // Keep history bounded (most recent 500 entries).
    conn.execute(
        "DELETE FROM history WHERE id NOT IN
            (SELECT id FROM history ORDER BY created_at DESC LIMIT 500)",
        [],
    )?;
    Ok(())
}

pub fn list_history(conn: &Connection, limit: i64) -> anyhow::Result<Vec<HistoryEntry>> {
    let mut stmt = conn.prepare(
        "SELECT id, request, status, total_ms, ok, created_at
         FROM history ORDER BY created_at DESC LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![limit], |row| {
        let request_json: String = row.get(1)?;
        let request = serde_json::from_str(&request_json).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(1, rusqlite::types::Type::Text, Box::new(e))
        })?;
        let ok_int: i64 = row.get(4)?;
        Ok(HistoryEntry {
            id: row.get(0)?,
            request,
            status: row.get(2)?,
            total_ms: row.get(3)?,
            ok: ok_int != 0,
            created_at: row.get(5)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn clear_history(conn: &Connection) -> anyhow::Result<()> {
    conn.execute("DELETE FROM history", [])?;
    Ok(())
}

// --- Environments ----------------------------------------------------------

pub fn save_env(conn: &Connection, item: &SavedEnvironment) -> anyhow::Result<()> {
    let vars_json = serde_json::to_string(&item.variables)?;
    conn.execute(
        "INSERT INTO environments (id, name, variables, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            variables = excluded.variables,
            updated_at = excluded.updated_at",
        params![item.id, item.name, vars_json, item.created_at, item.updated_at],
    )?;
    Ok(())
}

pub fn list_envs(conn: &Connection) -> anyhow::Result<Vec<SavedEnvironment>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, variables, created_at, updated_at
         FROM environments ORDER BY name ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        let vars_json: String = row.get(2)?;
        let variables = serde_json::from_str(&vars_json).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(2, rusqlite::types::Type::Text, Box::new(e))
        })?;
        Ok(SavedEnvironment {
            id: row.get(0)?,
            name: row.get(1)?,
            variables,
            created_at: row.get(3)?,
            updated_at: row.get(4)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn delete_env(conn: &Connection, id: &str) -> anyhow::Result<()> {
    conn.execute("DELETE FROM environments WHERE id = ?1", params![id])?;
    Ok(())
}

// --- Collections -----------------------------------------------------------

pub fn save_collection(conn: &Connection, item: &Collection) -> anyhow::Result<()> {
    let items_json = serde_json::to_string(&item.items)?;
    conn.execute(
        "INSERT INTO collections (id, name, items, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            items = excluded.items,
            updated_at = excluded.updated_at",
        params![item.id, item.name, items_json, item.created_at, item.updated_at],
    )?;
    Ok(())
}

pub fn list_collections(conn: &Connection) -> anyhow::Result<Vec<Collection>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, items, created_at, updated_at
         FROM collections ORDER BY name ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        let items_json: String = row.get(2)?;
        let items = serde_json::from_str(&items_json).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(2, rusqlite::types::Type::Text, Box::new(e))
        })?;
        Ok(Collection {
            id: row.get(0)?,
            name: row.get(1)?,
            items,
            created_at: row.get(3)?,
            updated_at: row.get(4)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn delete_collection(conn: &Connection, id: &str) -> anyhow::Result<()> {
    conn.execute("DELETE FROM collections WHERE id = ?1", params![id])?;
    Ok(())
}

// --- Settings (key/value) --------------------------------------------------

pub fn get_setting(conn: &Connection, key: &str) -> anyhow::Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
    let mut rows = stmt.query(params![key])?;
    if let Some(row) = rows.next()? {
        Ok(Some(row.get(0)?))
    } else {
        Ok(None)
    }
}

pub fn set_setting(conn: &Connection, key: &str, value: Option<&str>) -> anyhow::Result<()> {
    match value {
        Some(v) => {
            conn.execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key, v],
            )?;
        }
        None => {
            conn.execute("DELETE FROM settings WHERE key = ?1", params![key])?;
        }
    }
    Ok(())
}
