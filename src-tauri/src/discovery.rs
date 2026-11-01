use crate::{
    database::{normalize_doi, validate_url},
    models::*,
};
use serde_json::{json, Value};
use std::time::Duration;
use tokio::sync::Semaphore;
static REQUESTS: Semaphore = Semaphore::const_new(2);
pub fn api_url(q: &DiscoveryQuery) -> Result<url::Url> {
    if q.page == 0 || q.page > 200 {
        return Err("Page must be between 1 and 200 (50 results per page). Narrow your search beyond 10,000 results.".into());
    }
    let mut u = url::Url::parse("https://api.openalex.org/works").unwrap();
    let id = |s: &str| -> Result<String> {
        let s = s
            .trim()
            .trim_start_matches("https://openalex.org/")
            .to_uppercase();
        if regex::Regex::new(r"^W\d+$").unwrap().is_match(&s) {
            Ok(s)
        } else {
            Err("Find this paper by DOI or title first to attach its OpenAlex ID.".into())
        }
    };
    match q.mode.as_str() {
        "search" => {
            let term = q.term.trim();
            if term.is_empty() || term.len() > 1000 {
                return Err("Enter a DOI, OpenAlex ID, or title (up to 1,000 characters).".into());
            }
            if term.to_lowercase().starts_with("10.")
                || term.to_lowercase().contains("doi.org/")
                || term.to_lowercase().starts_with("doi:")
            {
                let doi = normalize_doi(term)?;
                u.query_pairs_mut()
                    .append_pair("filter", &format!("doi:https://doi.org/{doi}"));
            } else if let Ok(work) = id(term) {
                u.set_path(&format!("/works/{work}"));
                return Ok(u);
            } else {
                u.query_pairs_mut().append_pair("search", term);
            }
        }
        "citing" | "references" => {
            let filter = if q.mode == "citing" {
                "cites"
            } else {
                "cited_by"
            };
            u.query_pairs_mut()
                .append_pair("filter", &format!("{filter}:{}", id(&q.term)?));
        }
        "ids" => {
            let works = q.term.split('|').map(id).collect::<Result<Vec<_>>>()?;
            if works.is_empty() || works.len() > 100 {
                return Err("Batch lookup supports 1–100 OpenAlex IDs.".into());
            }
            u.query_pairs_mut()
                .append_pair("filter", &format!("openalex:{}", works.join("|")));
        }
        _ => return Err("Unknown discovery operation.".into()),
    };
    u.query_pairs_mut()
        .append_pair("per_page", "50")
        .append_pair("page", &q.page.to_string());
    Ok(u)
}
pub async fn fetch(q: &DiscoveryQuery, key: &str) -> Result<DiscoveryResult> {
    fetch_url(api_url(q)?, q.page, key, Duration::from_secs(20)).await
}
pub async fn fetch_url(
    u: url::Url,
    page: u32,
    key: &str,
    timeout: Duration,
) -> Result<DiscoveryResult> {
    let _permit = REQUESTS.acquire().await.map_err(|e| e.to_string())?;
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .user_agent("YaraResearch/1.0 (local research manager)")
        .build()
        .map_err(|_| "Cannot initialize network client.")?;
    for attempt in 0..3u32 {
        let mut request = client.get(u.clone());
        if !key.trim().is_empty() {
            request = request.bearer_auth(key.trim());
        }
        let response = match request.send().await {
            Ok(r) => r,
            Err(e) => {
                if attempt < 2 {
                    tokio::time::sleep(Duration::from_millis(500 * 2u64.pow(attempt))).await;
                    continue;
                }
                return Err(if e.is_timeout() {
                    "OpenAlex timed out. Retry or use manual entry; saved research is unaffected."
                } else {
                    "Cannot reach OpenAlex. Check your connection or use manual entry."
                }
                .into());
            }
        };
        let status = response.status();
        if status.as_u16() == 429 || status.is_server_error() {
            if attempt < 2 {
                let wait = response
                    .headers()
                    .get("retry-after")
                    .and_then(|s| s.to_str().ok())
                    .and_then(|s| s.parse::<u64>().ok())
                    .unwrap_or(2u64.pow(attempt));
                if wait > 20 {
                    return Err(format!("OpenAlex asked to wait {wait} seconds. Retry later; saved data remains available."));
                }
                tokio::time::sleep(Duration::from_secs(wait.max(1))).await;
                continue;
            }
            return Err("OpenAlex is busy or its free request budget is exhausted. Retry later or configure a free API key in Settings.".into());
        }
        if status.as_u16() == 401 || status.as_u16() == 403 {
            return Err("OpenAlex rejected the API key or requires one for this request. Verify a free key in Settings or clear it to try anonymous access.".into());
        }
        if !status.is_success() {
            return Err(format!(
                "OpenAlex returned HTTP {}. Try a different identifier or use manual entry.",
                status.as_u16()
            ));
        }
        if response.content_length().is_some_and(|n| n > 20_000_000) {
            return Err("Provider response exceeded the size limit.".into());
        }
        let bytes = response
            .bytes()
            .await
            .map_err(|_| "Failed to read OpenAlex response.")?;
        if bytes.len() > 20_000_000 {
            return Err("Provider response exceeded the size limit.".into());
        }
        let value: Value =
            serde_json::from_slice(&bytes).map_err(|_| "OpenAlex returned invalid JSON.")?;
        return parse_result(&value, page);
    }
    Err("OpenAlex request failed.".into())
}
pub fn parse_result(v: &Value, page: u32) -> Result<DiscoveryResult> {
    let works = if let Some(a) = v.get("results").and_then(Value::as_array) {
        a.clone()
    } else if v.get("id").is_some() {
        vec![v.clone()]
    } else {
        return Err("OpenAlex response did not contain works.".into());
    };
    let papers = works.iter().map(parse_work).collect::<Result<Vec<_>>>()?;
    let count = v["meta"]["count"].as_u64().unwrap_or(papers.len() as u64);
    Ok(DiscoveryResult {
        more: (page as u64) * 50 < count,
        count,
        page,
        papers,
        cached: false,
        fetched_at: chrono::Utc::now().to_rfc3339(),
        stale: false,
        refresh_error: None,
    })
}
pub fn parse_work(w: &Value) -> Result<Paper> {
    let text = |v: &Value| v.as_str().unwrap_or_default().to_string();
    let id = text(&w["id"]);
    let title = text(
        w.get("title")
            .filter(|v| v.is_string())
            .unwrap_or(&w["display_name"]),
    );
    if id.is_empty() || title.is_empty() {
        return Err("Provider returned a paper without a title or identifier.".into());
    }
    let mut p = Paper::blank(&title);
    p.openalex = id;
    p.doi = normalize_doi(&text(&w["doi"]))?;
    p.year = w["publication_year"].as_i64().map(|n| n as i32);
    p.publication_date = text(&w["publication_date"]);
    p.citation_count = w["cited_by_count"].as_u64();
    p.authors = w["authorships"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .filter_map(|a| a["author"]["display_name"].as_str().map(str::to_string))
        .collect();
    p.journal = text(&w["primary_location"]["source"]["display_name"]);
    p.publisher = text(&w["primary_location"]["source"]["host_organization_name"]);
    p.url = text(&w["primary_location"]["landing_page_url"]);
    if validate_url(&p.url).is_err() {
        p.url = String::new();
    }
    p.references = w["referenced_works"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .filter_map(|v| v.as_str().map(str::to_string))
        .collect();
    p.keywords = w["keywords"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .filter_map(|v| v["display_name"].as_str().map(str::to_string))
        .collect();
    p.r#abstract = abstract_text(&w["abstract_inverted_index"]);
    p.source = "OpenAlex".into();
    crate::database::validate(&mut p)?;
    Ok(p)
}
pub fn abstract_text(v: &Value) -> String {
    let mut words = std::collections::BTreeMap::new();
    if let Some(index) = v.as_object() {
        for (word, positions) in index {
            if let Some(a) = positions.as_array() {
                for n in a.iter().filter_map(Value::as_u64).filter(|n| *n < 100000) {
                    words.insert(n, word.as_str());
                }
            }
        }
    }
    words.values().copied().collect::<Vec<_>>().join(" ")
}
pub fn cache_key(q: &DiscoveryQuery) -> String {
    json!([q.mode, q.term, q.page]).to_string()
}
