use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::Manager;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitFeedbackInput {
    pub kind: String,
    pub title: Option<String>,
    pub body: String,
    pub app: Option<String>,
    pub environment: Option<String>,
    pub route: Option<String>,
    pub url: Option<String>,
    pub context: Option<Value>,
    pub created_at: Option<String>,
    pub created_by: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitFeedbackResponse {
    pub id: String,
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateFeedbackStatusInput {
    pub id: String,
    pub status: String,
    pub updated_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateFeedbackInput {
    pub id: String,
    pub kind: String,
    pub title: Option<String>,
    pub body: String,
    pub plan: Option<String>,
    pub status: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddFeedbackCommentInput {
    pub id: String,
    pub from: String,
    pub body: String,
    pub created_at: Option<String>,
}

#[tauri::command]
pub fn submit_feedback(
    app: tauri::AppHandle,
    input: SubmitFeedbackInput,
) -> Result<SubmitFeedbackResponse, String> {
    let body = input.body.trim();
    if body.is_empty() {
        return Err("Feedback body is required".to_string());
    }

    let kind = normalize_kind(&input.kind);
    let now = now_millis();
    let id = format!("fb_{}_{}", now, std::process::id());
    let created_at = input
        .created_at
        .unwrap_or_else(|| format!("{}ms_since_unix_epoch", now));

    let inbox_dir = agent_inbox_dir(&app)?;
    fs::create_dir_all(&inbox_dir).map_err(|e| e.to_string())?;
    let path = inbox_dir.join("feedback.jsonl");

    let record = json!({
        "id": id,
        "kind": kind,
        "status": "new",
        "title": clean_optional(input.title),
        "body": body,
        "plan": null,
        "comments": [],
        "app": input.app.unwrap_or_else(|| "tiles".to_string()),
        "environment": input.environment.unwrap_or_else(|| "dev".to_string()),
        "route": input.route,
        "url": input.url,
        "context": input.context.unwrap_or_else(|| json!({})),
        "createdAt": created_at,
        "updatedAt": created_at,
        "createdBy": input.created_by,
        "agentNotes": [],
        "linkedIssue": null,
    });

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    writeln!(file, "{}", record).map_err(|e| e.to_string())?;

    Ok(SubmitFeedbackResponse {
        id,
        path: path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn list_feedback(app: tauri::AppHandle) -> Result<Vec<Value>, String> {
    let path = agent_inbox_dir(&app)?.join("feedback.jsonl");
    if !path.exists() {
        return Ok(Vec::new());
    }
    read_records(&path)
}

#[tauri::command]
pub fn update_feedback_status(
    app: tauri::AppHandle,
    input: UpdateFeedbackStatusInput,
) -> Result<(), String> {
    rewrite_matching_record(&app, &input.id, |record| {
        record["status"] = Value::String(normalize_status(&input.status).to_string());
        record["updatedAt"] = Value::String(
            input
                .updated_at
                .clone()
                .unwrap_or_else(|| format!("{}ms_since_unix_epoch", now_millis())),
        );
        Ok(())
    })
}

#[tauri::command]
pub fn update_feedback(app: tauri::AppHandle, input: UpdateFeedbackInput) -> Result<(), String> {
    let body = input.body.trim().to_string();
    if body.is_empty() {
        return Err("Feedback body is required".to_string());
    }

    rewrite_matching_record(&app, &input.id, |record| {
        record["kind"] = Value::String(normalize_kind(&input.kind).to_string());
        record["title"] = clean_optional(input.title.clone())
            .map(Value::String)
            .unwrap_or(Value::Null);
        record["body"] = Value::String(body.clone());
        record["plan"] = clean_optional(input.plan.clone())
            .map(Value::String)
            .unwrap_or(Value::Null);
        if let Some(status) = &input.status {
            record["status"] = Value::String(normalize_status(status).to_string());
        }
        record["updatedAt"] = Value::String(
            input
                .updated_at
                .clone()
                .unwrap_or_else(|| format!("{}ms_since_unix_epoch", now_millis())),
        );
        Ok(())
    })
}

#[tauri::command]
pub fn add_feedback_comment(
    app: tauri::AppHandle,
    input: AddFeedbackCommentInput,
) -> Result<(), String> {
    let body = input.body.trim().to_string();
    if body.is_empty() {
        return Err("Comment body is required".to_string());
    }
    let from = match input.from.as_str() {
        "user" | "agent" => input.from.clone(),
        _ => return Err("from must be 'user' or 'agent'".to_string()),
    };
    let now = now_millis();
    let comment_id = format!("c_{}_{}", now, std::process::id());
    let created_at = input
        .created_at
        .unwrap_or_else(|| format!("{}ms_since_unix_epoch", now));

    rewrite_matching_record(&app, &input.id, |record| {
        if !record["comments"].is_array() {
            record["comments"] = json!([]);
        }
        let comments = record["comments"]
            .as_array_mut()
            .ok_or_else(|| "comments is not an array".to_string())?;
        comments.push(json!({
            "id": comment_id,
            "from": from,
            "body": body,
            "createdAt": created_at,
        }));
        record["updatedAt"] = Value::String(created_at.clone());
        Ok(())
    })
}

#[tauri::command]
pub fn clear_feedback_comments(
    app: tauri::AppHandle,
    id: String,
    updated_at: Option<String>,
) -> Result<(), String> {
    let now = updated_at.unwrap_or_else(|| format!("{}ms_since_unix_epoch", now_millis()));
    rewrite_matching_record(&app, &id, |record| {
        record["comments"] = json!([]);
        record["updatedAt"] = Value::String(now.clone());
        Ok(())
    })
}

#[tauri::command]
pub fn delete_feedback(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let path = feedback_path(&app)?;
    if !path.exists() {
        return Err("feedback inbox does not exist".to_string());
    }

    let records = read_records(&path)?;
    let initial_len = records.len();
    let kept: Vec<Value> = records
        .into_iter()
        .filter(|record| record.get("id").and_then(Value::as_str) != Some(id.as_str()))
        .collect();

    if kept.len() == initial_len {
        return Err("feedback record not found".to_string());
    }

    write_records(&path, kept)
}

fn rewrite_matching_record<F>(app: &tauri::AppHandle, id: &str, mut update: F) -> Result<(), String>
where
    F: FnMut(&mut Value) -> Result<(), String>,
{
    let path = feedback_path(app)?;
    if !path.exists() {
        return Err("feedback inbox does not exist".to_string());
    }

    let mut found = false;
    let mut records = read_records(&path)?;
    for record in &mut records {
        if record.get("id").and_then(Value::as_str) == Some(id) {
            update(record)?;
            found = true;
        }
    }

    if !found {
        return Err("feedback record not found".to_string());
    }

    write_records(&path, records)
}

fn feedback_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(agent_inbox_dir(app)?.join("feedback.jsonl"))
}

fn read_records(path: &PathBuf) -> Result<Vec<Value>, String> {
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    content
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| serde_json::from_str::<Value>(line).map_err(|e| e.to_string()))
        .collect()
}

fn write_records(path: &PathBuf, records: Vec<Value>) -> Result<(), String> {
    let mut output = String::new();
    for record in records {
        output.push_str(&serde_json::to_string(&record).map_err(|e| e.to_string())?);
        output.push('\n');
    }
    fs::write(path, output).map_err(|e| e.to_string())
}

fn clean_optional(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let value = value.trim().to_string();
        if value.is_empty() {
            None
        } else {
            Some(value)
        }
    })
}

fn normalize_kind(kind: &str) -> &str {
    match kind {
        "bug" | "feature" | "ui" | "chore" | "question" | "other" => kind,
        _ => "other",
    }
}

fn normalize_status(status: &str) -> &str {
    match status {
        "new" | "planned" | "accepted" | "in_progress" | "done" | "wontfix" => status,
        _ => "new",
    }
}

fn agent_inbox_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("TILES_AGENT_INBOX_DIR") {
        return Ok(PathBuf::from(path));
    }

    if cfg!(debug_assertions) {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        if let Some(repo_root) = manifest_dir.parent() {
            return Ok(repo_root.join(".agent").join("inbox"));
        }
    }

    app.path()
        .app_data_dir()
        .map(|path| path.join("agent-inbox"))
        .map_err(|e| e.to_string())
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}
