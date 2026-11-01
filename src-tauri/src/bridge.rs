use crate::{
    database::{hash, valid_id, validate, validate_url, Store},
    evidence,
    models::*,
    workspaces,
};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    path::Path,
};
pub const EXTENSION_ID: &str = include_str!("../../extension/extension-id.txt");
pub const MAX_MESSAGE: usize = 512 * 1024;
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Message {
    pub version: u32,
    pub request_id: String,
    pub action: String,
    #[serde(default)]
    pub workspace_id: Option<String>,
    #[serde(default)]
    pub paper: Option<Paper>,
    #[serde(default)]
    pub capture: Option<EvidenceSnapshot>,
    #[serde(default)]
    pub page_url: Option<String>,
    #[serde(default)]
    pub provider: Option<String>,
}
pub fn allowed_origin(origin: &str) -> bool {
    origin == format!("chrome-extension://{}/", EXTENSION_ID.trim())
}
pub fn handle(base: &Path, m: Message) -> Result<Value> {
    if m.version != 1 {
        return Err(
            "Unsupported extension protocol. Update Yara and its extension together.".into(),
        );
    }
    valid_id(&m.request_id)?;
    if m.action == "list_workspaces" {
        let w = workspaces::list(base)?
            .into_iter()
            .map(|(w, _)| w)
            .collect::<Vec<_>>();
        return Ok(json!({"ok":true,"workspaces":w,"version":env!("CARGO_PKG_VERSION")}));
    }
    let root = workspaces::find(
        base,
        m.workspace_id
            .as_deref()
            .ok_or("Select a destination workspace.")?,
    )?;
    let mut s = Store::open(&root)?;
    let payload_hash = hash(&serde_json::to_vec(&m).map_err(|e| e.to_string())?);
    s.db.execute_batch("BEGIN IMMEDIATE")
        .map_err(|e| e.to_string())?;
    let result = (|| {
        let receipt: Option<(String, String)> =
            s.db.query_row(
                "SELECT payload_hash,response FROM extension_receipts WHERE request_id=?",
                [&m.request_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if let Some((prior, response)) = receipt {
            if prior != payload_hash {
                return Err("Repeated delivery ID has different content. Review the import before retrying.".into());
            }
            return serde_json::from_str(&response).map_err(|e| e.to_string());
        }
        let response = match m.action.as_str() {
            "import_paper" => {
                let mut p = m.paper.clone().ok_or("Missing paper metadata.")?;
                let page = m.page_url.as_deref().ok_or("Missing source page.")?;
                validate_url(page)?;
                let provider = if m.provider.as_deref() == Some("IEEE") {
                    let canonical = evidence::ieee_url(page)?;
                    let id = canonical.rsplit('/').next().unwrap();
                    if p.ieee != id {
                        return Err(
                            "The article identifier does not match the captured IEEE page.".into(),
                        );
                    }
                    "IEEE"
                } else {
                    "Web"
                };
                p.id = uuid::Uuid::new_v4().to_string();
                p.source = provider.into();
                p.status = "unreviewed".into();
                p.x = 0.;
                p.y =
                    s.db.query_row("SELECT COALESCE(MAX(y),-210)+210 FROM layout", [], |r| {
                        r.get(0)
                    })
                    .map_err(|e| e.to_string())?;
                p.pinned = false;
                p.hidden = false;
                validate(&mut p)?;
                let original = p.clone();
                let p = s.save(p, true)?;
                s.metadata_source(&p.id, provider, page, &original)?;
                json!({"ok":true,"paperId":p.id,"title":p.title,"message":"Paper saved in the selected workspace. Existing research was preserved."})
            }
            "capture_relationships" => {
                let mut c = m.capture.clone().ok_or("Missing relationship capture.")?;
                if c.provider != "IEEE" {
                    return Err("This workflow accepts only explicitly captured IEEE article relationships.".into());
                }
                if !evidence::identified(&c.focal) {
                    return Err(
                        "A DOI or IEEE article identifier is required to identify the focal paper."
                            .into(),
                    );
                }
                if evidence::ieee_url(
                    m.page_url
                        .as_deref()
                        .ok_or("Missing browser article context.")?,
                )? != evidence::ieee_url(&c.source_url)?
                {
                    return Err(
                        "The captured section does not belong to the browser's article context."
                            .into(),
                    );
                }
                c.id = m.request_id.clone();
                c.captured_at = chrono::Utc::now().to_rfc3339();
                c.method = format!(
                    "Browser capture · {}",
                    c.method.chars().take(160).collect::<String>()
                );
                for p in &mut c.items {
                    p.id = uuid::Uuid::new_v4().to_string();
                    p.source = "IEEE metadata".into();
                }
                s.capture(c.clone(), 1)?;
                json!({"ok":true,"captureId":c.id,"count":c.items.len(),"coverage":c.coverage,"message":"IEEE evidence saved. Related papers were not automatically added to the graph."})
            }
            _ => return Err("Unknown extension operation.".into()),
        };
        s.db.execute(
            "INSERT INTO extension_receipts VALUES(?1,?2,?3,?4)",
            params![
                m.request_id,
                payload_hash,
                response.to_string(),
                chrono::Utc::now().to_rfc3339()
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(response)
    })();
    match result {
        Ok(r) => {
            s.db.execute_batch("COMMIT").map_err(|e| e.to_string())?;
            Ok(r)
        }
        Err(e) => {
            let _ = s.db.execute_batch("ROLLBACK");
            Err(e)
        }
    }
}
pub fn run_stdio(origin: &str, base: &Path) -> Result<()> {
    if !allowed_origin(origin) {
        return Err("Caller is not the Yara browser extension.".into());
    }
    let mut input = std::io::stdin().lock();
    let mut output = std::io::stdout().lock();
    loop {
        let mut size = [0u8; 4];
        match input.read_exact(&mut size) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(()),
            Err(e) => return Err(e.to_string()),
        };
        let size = u32::from_le_bytes(size) as usize;
        if size == 0 || size > MAX_MESSAGE {
            return Err("Browser message exceeds the 512 KiB safety limit.".into());
        }
        let mut bytes = vec![0; size];
        input.read_exact(&mut bytes).map_err(|e| e.to_string())?;
        let response = match serde_json::from_slice::<Message>(&bytes)
            .map_err(|_| "Invalid extension message.".to_string())
            .and_then(|m| handle(base, m))
        {
            Ok(v) => v,
            Err(e) => json!({"ok":false,"error":e}),
        };
        let bytes = serde_json::to_vec(&response).map_err(|e| e.to_string())?;
        if bytes.len() > MAX_MESSAGE {
            return Err("Workspace response is too large.".into());
        }
        output
            .write_all(&(bytes.len() as u32).to_le_bytes())
            .and_then(|_| output.write_all(&bytes))
            .and_then(|_| output.flush())
            .map_err(|e| e.to_string())?;
    }
}
