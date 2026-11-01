use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Paper {
    pub id: String,
    pub title: String,
    pub authors: Vec<String>,
    pub year: Option<i32>,
    pub doi: String,
    pub openalex: String,
    #[serde(default)]
    pub ieee: String,
    pub r#abstract: String,
    pub journal: String,
    pub publisher: String,
    pub url: String,
    pub publication_date: String,
    pub citation_count: Option<u64>,
    pub status: String,
    pub tags: Vec<String>,
    pub keywords: Vec<String>,
    pub summary: String,
    pub strengths: String,
    pub weaknesses: String,
    pub findings: String,
    pub relevance: String,
    pub tasks: String,
    pub raw: String,
    pub source: String,
    pub references: Vec<String>,
    pub x: f64,
    pub y: f64,
    pub pinned: bool,
    pub hidden: bool,
    pub has_note: bool,
    pub created_at: String,
    pub updated_at: String,
    pub last_discovery: String,
}
impl Paper {
    pub fn blank(title: &str) -> Self {
        let now = chrono::Utc::now().to_rfc3339();
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            title: title.into(),
            authors: vec![],
            year: None,
            doi: String::new(),
            openalex: String::new(),
            ieee: String::new(),
            r#abstract: String::new(),
            journal: String::new(),
            publisher: String::new(),
            url: String::new(),
            publication_date: String::new(),
            citation_count: None,
            status: "unreviewed".into(),
            tags: vec![],
            keywords: vec![],
            summary: String::new(),
            strengths: String::new(),
            weaknesses: String::new(),
            findings: String::new(),
            relevance: String::new(),
            tasks: String::new(),
            raw: String::new(),
            source: "manual".into(),
            references: vec![],
            x: 0.,
            y: 0.,
            pinned: false,
            hidden: false,
            has_note: false,
            created_at: now.clone(),
            updated_at: now,
            last_discovery: String::new(),
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Citation {
    pub citing: String,
    pub cited: String,
    pub source: String,
    pub verified: bool,
    pub created_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snapshot {
    pub papers: Vec<Paper>,
    pub citations: Vec<Citation>,
    pub settings: HashMap<String, String>,
    pub root: String,
    pub workspace: Workspace,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    pub content: String,
    pub revision: String,
    pub exists: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveryQuery {
    pub mode: String,
    pub term: String,
    pub page: u32,
    pub refresh: bool,
    #[serde(default, rename = "sessionId")]
    pub session_id: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryResult {
    pub papers: Vec<Paper>,
    pub count: u64,
    pub page: u32,
    pub more: bool,
    pub cached: bool,
    pub fetched_at: String,
    pub stale: bool,
    #[serde(default)]
    pub refresh_error: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub paper_count: u64,
    pub active: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceSnapshot {
    pub id: String,
    pub provider: String,
    pub direction: String,
    pub focal: Paper,
    pub captured_at: String,
    pub source_url: String,
    pub method: String,
    pub coverage: String,
    pub total: Option<u64>,
    pub raw: String,
    pub error: String,
    pub items: Vec<Paper>,
}
pub type Result<T> = std::result::Result<T, String>;
