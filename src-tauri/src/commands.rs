//! Tauri commands — the `invoke` surface the React frontend calls.

use crate::model::{
    now_millis, Auth, Body, Collection, HistoryEntry, HttpRequest, HttpResponse, SavedEnvironment,
    SavedRequest,
};
use crate::net;
use crate::store::{self, Db};
use std::collections::HashMap;
use tauri::State;
use uuid::Uuid;

/// Send an HTTP request through the instrumented client and record it in history.
#[tauri::command]
pub async fn send_request(
    state: State<'_, Db>,
    request: HttpRequest,
    variables: Option<HashMap<String, String>>,
    history_request: Option<HttpRequest>,
) -> Result<HttpResponse, String> {
    // History records the original authored request (falls back to the sent one).
    // Templates keep {{vars}}; resolved secrets are never stored.
    let req_for_history = history_request.unwrap_or_else(|| request.clone());
    let effective = match &variables {
        Some(v) if !v.is_empty() => substitute_request(&request, v),
        _ => request,
    };
    let result = net::execute(effective).await;

    // Record in history (best-effort — never fail the request because of this).
    let entry = HistoryEntry {
        id: Uuid::new_v4().to_string(),
        request: req_for_history,
        status: result.as_ref().ok().map(|r| r.status),
        total_ms: result
            .as_ref()
            .ok()
            .map(|r| r.timings.total_ms)
            .unwrap_or(0.0),
        ok: result.is_ok(),
        created_at: now_millis(),
    };
    if let Ok(conn) = state.0.lock() {
        let _ = store::add_history(&conn, &entry);
    }

    result
}

/// Like `send_request` but does NOT record history — used by the latency
/// profiler so repeated runs don't flood the history list.
#[tauri::command]
pub async fn probe_request(
    request: HttpRequest,
    variables: Option<HashMap<String, String>>,
) -> Result<HttpResponse, String> {
    let effective = match &variables {
        Some(v) if !v.is_empty() => substitute_request(&request, v),
        _ => request,
    };
    net::execute(effective).await
}

#[tauri::command]
pub fn save_request(state: State<'_, Db>, mut item: SavedRequest) -> Result<SavedRequest, String> {
    if item.id.trim().is_empty() {
        item.id = Uuid::new_v4().to_string();
    }
    let now = now_millis();
    if item.created_at == 0 {
        item.created_at = now;
    }
    item.updated_at = now;

    let conn = state.0.lock().map_err(|_| "database lock poisoned".to_string())?;
    store::save_request(&conn, &item).map_err(|e| e.to_string())?;
    Ok(item)
}

#[tauri::command]
pub fn list_saved(state: State<'_, Db>) -> Result<Vec<SavedRequest>, String> {
    let conn = state.0.lock().map_err(|_| "database lock poisoned".to_string())?;
    store::list_saved(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_saved(state: State<'_, Db>, id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|_| "database lock poisoned".to_string())?;
    store::delete_saved(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_history(state: State<'_, Db>, limit: Option<i64>) -> Result<Vec<HistoryEntry>, String> {
    let conn = state.0.lock().map_err(|_| "database lock poisoned".to_string())?;
    store::list_history(&conn, limit.unwrap_or(100)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_history(state: State<'_, Db>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|_| "database lock poisoned".to_string())?;
    store::clear_history(&conn).map_err(|e| e.to_string())
}

/// Generate a fresh UUID (used by the frontend for new saved-request ids).
#[tauri::command]
pub fn new_id() -> String {
    Uuid::new_v4().to_string()
}

// --- Environments ----------------------------------------------------------

#[tauri::command]
pub fn list_envs(state: State<'_, Db>) -> Result<Vec<SavedEnvironment>, String> {
    let conn = state.0.lock().map_err(|_| "database lock poisoned".to_string())?;
    store::list_envs(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_env(
    state: State<'_, Db>,
    mut item: SavedEnvironment,
) -> Result<SavedEnvironment, String> {
    if item.id.trim().is_empty() {
        item.id = Uuid::new_v4().to_string();
    }
    let now = now_millis();
    if item.created_at == 0 {
        item.created_at = now;
    }
    item.updated_at = now;

    let conn = state.0.lock().map_err(|_| "database lock poisoned".to_string())?;
    store::save_env(&conn, &item).map_err(|e| e.to_string())?;
    Ok(item)
}

#[tauri::command]
pub fn delete_env(state: State<'_, Db>, id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|_| "database lock poisoned".to_string())?;
    store::delete_env(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_active_env(state: State<'_, Db>) -> Result<Option<String>, String> {
    let conn = state.0.lock().map_err(|_| "database lock poisoned".to_string())?;
    store::get_setting(&conn, "active_env_id").map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_active_env(state: State<'_, Db>, id: Option<String>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|_| "database lock poisoned".to_string())?;
    store::set_setting(&conn, "active_env_id", id.as_deref()).map_err(|e| e.to_string())
}

// --- Collections -----------------------------------------------------------

#[tauri::command]
pub fn list_collections(state: State<'_, Db>) -> Result<Vec<Collection>, String> {
    let conn = state.0.lock().map_err(|_| "database lock poisoned".to_string())?;
    store::list_collections(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_collection(state: State<'_, Db>, mut item: Collection) -> Result<Collection, String> {
    if item.id.trim().is_empty() {
        item.id = Uuid::new_v4().to_string();
    }
    let now = now_millis();
    if item.created_at == 0 {
        item.created_at = now;
    }
    item.updated_at = now;

    let conn = state.0.lock().map_err(|_| "database lock poisoned".to_string())?;
    store::save_collection(&conn, &item).map_err(|e| e.to_string())?;
    Ok(item)
}

#[tauri::command]
pub fn delete_collection(state: State<'_, Db>, id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|_| "database lock poisoned".to_string())?;
    store::delete_collection(&conn, &id).map_err(|e| e.to_string())
}

/// Read a UTF-8 text file from disk (used to load selected Postman export files).
#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("{path}: {e}"))
}

/// Look up geo/ASN info for an IP via ipwho.is (reuses the instrumented client).
#[tauri::command]
pub async fn geo_lookup(ip: String) -> Result<String, String> {
    if ip.trim().is_empty() {
        return Err("no ip".to_string());
    }
    let req = HttpRequest {
        method: "GET".into(),
        url: format!("https://ipwho.is/{ip}"),
        query_params: vec![],
        headers: vec![],
        body: Body::default(),
        auth: Auth::default(),
        follow_redirects: true,
        timeout_ms: 8_000,
        verify_tls: true,
        pre_request_script: String::new(),
        post_response_script: String::new(),
        reuse_connection: false,
        proxy_url: String::new(),
        client_cert_pem: String::new(),
        client_key_pem: String::new(),
    };
    let res = net::execute(req).await?;
    Ok(res.body)
}

/// Fetch a WSDL (or any XML) document as text, for the SOAP builder's importer.
#[tauri::command]
pub async fn fetch_wsdl(url: String) -> Result<String, String> {
    if url.trim().is_empty() {
        return Err("no URL".to_string());
    }
    let req = HttpRequest {
        method: "GET".into(),
        url,
        query_params: vec![],
        headers: vec![],
        body: Body::default(),
        auth: Auth::default(),
        follow_redirects: true,
        timeout_ms: 20_000,
        verify_tls: true,
        pre_request_script: String::new(),
        post_response_script: String::new(),
        reuse_connection: false,
        proxy_url: String::new(),
        client_cert_pem: String::new(),
        client_key_pem: String::new(),
    };
    let res = net::execute(req).await?;
    if res.status >= 400 {
        return Err(format!("WSDL fetch failed: HTTP {}", res.status));
    }
    Ok(res.body)
}

// --- {{variable}} substitution ---------------------------------------------

/// Replace every `{{key}}` occurrence in `s` with its value.
fn apply_vars(s: &str, vars: &HashMap<String, String>) -> String {
    if !s.contains("{{") {
        return s.to_string();
    }
    let mut out = s.to_string();
    for (k, v) in vars {
        out = out.replace(&format!("{{{{{k}}}}}"), v);
    }
    out
}

/// Produce a copy of `req` with `{{variable}}` references resolved from `vars`.
fn substitute_request(req: &HttpRequest, vars: &HashMap<String, String>) -> HttpRequest {
    let mut r = req.clone();
    r.url = apply_vars(&r.url, vars);
    for kv in r.query_params.iter_mut() {
        kv.key = apply_vars(&kv.key, vars);
        kv.value = apply_vars(&kv.value, vars);
    }
    for kv in r.headers.iter_mut() {
        kv.key = apply_vars(&kv.key, vars);
        kv.value = apply_vars(&kv.value, vars);
    }
    r.body.raw = apply_vars(&r.body.raw, vars);
    r.body.graphql_variables = apply_vars(&r.body.graphql_variables, vars);
    r.body.soap_action = apply_vars(&r.body.soap_action, vars);
    r.body.soap_envelope = apply_vars(&r.body.soap_envelope, vars);
    r.body.binary_path = apply_vars(&r.body.binary_path, vars);
    for kv in r.body.form.iter_mut() {
        kv.key = apply_vars(&kv.key, vars);
        kv.value = apply_vars(&kv.value, vars);
    }
    for mp in r.body.multipart.iter_mut() {
        mp.key = apply_vars(&mp.key, vars);
        mp.value = apply_vars(&mp.value, vars);
    }
    r.auth.token = apply_vars(&r.auth.token, vars);
    r.auth.username = apply_vars(&r.auth.username, vars);
    r.auth.password = apply_vars(&r.auth.password, vars);
    r.auth.api_key_name = apply_vars(&r.auth.api_key_name, vars);
    r.auth.api_key_value = apply_vars(&r.auth.api_key_value, vars);
    r.proxy_url = apply_vars(&r.proxy_url, vars);
    r
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Auth, Body};

    #[test]
    fn substitutes_variables_in_url_and_auth() {
        let mut vars = HashMap::new();
        vars.insert("base".to_string(), "https://api.example.com".to_string());
        vars.insert("tok".to_string(), "secret-token".to_string());

        let req = HttpRequest {
            method: "GET".into(),
            url: "{{base}}/users".into(),
            query_params: vec![],
            headers: vec![],
            body: Body::default(),
            auth: Auth {
                kind: "bearer".into(),
                token: "{{tok}}".into(),
                ..Auth::default()
            },
            follow_redirects: true,
            timeout_ms: 30_000,
            verify_tls: true,
            pre_request_script: String::new(),
            post_response_script: String::new(),
            reuse_connection: false,
            proxy_url: String::new(),
            client_cert_pem: String::new(),
            client_key_pem: String::new(),
        };

        let out = substitute_request(&req, &vars);
        assert_eq!(out.url, "https://api.example.com/users");
        assert_eq!(out.auth.token, "secret-token");
    }

    #[test]
    fn leaves_unknown_placeholders_untouched() {
        let vars = HashMap::new();
        assert_eq!(apply_vars("{{missing}}/x", &vars), "{{missing}}/x");
    }
}
