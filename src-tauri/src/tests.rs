use crate::{backup, database::*, discovery, models::*};
use serde_json::json;
use std::{fs, io::Write};
fn setup() -> (tempfile::TempDir, Store) {
    let dir = tempfile::tempdir().unwrap();
    let s = Store::open(&dir.path().join("workspace")).unwrap();
    (dir, s)
}
fn edge(a: &str, b: &str) -> Citation {
    Citation {
        citing: a.into(),
        cited: b.into(),
        source: "manual".into(),
        verified: false,
        created_at: "2026-11-01".into(),
    }
}
#[test]
fn migrations_are_versioned_and_idempotent() {
    let (d, s) = setup();
    let v: u32 =
        s.db.query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
    assert_eq!(v, 2);
    drop(s);
    assert!(Store::open(&d.path().join("workspace")).is_ok());
}
#[test]
fn rejects_newer_database_version() {
    let (d, s) = setup();
    s.db.execute_batch("PRAGMA user_version=999").unwrap();
    drop(s);
    assert!(Store::open(&d.path().join("workspace")).is_err());
}
#[test]
fn unicode_metadata_tags_positions_status_survive_restart() {
    let (d, mut s) = setup();
    let mut p = Paper::blank("پژوهش 科学 α²");
    p.tags = vec!["روش".into(), "方法".into()];
    p.status = "core".into();
    p.pinned = true;
    p.x = 101.;
    p.y = -42.;
    let p = s.save(p, false).unwrap();
    s.position(&p.id, 155., 88.).unwrap();
    drop(s);
    let s = Store::open(&d.path().join("workspace")).unwrap();
    let p = s.paper(&p.id).unwrap();
    assert_eq!(p.title, "پژوهش 科学 α²");
    assert_eq!(p.tags.len(), 2);
    assert_eq!((p.x, p.y), (155., 88.));
    assert!(p.pinned);
    assert_eq!(p.status, "core");
}
#[test]
fn doi_normalization_and_validation() {
    for s in [
        "DOI: 10.1234/ABC",
        "https://doi.org/10.1234/abc",
        "https://dx.doi.org/10.1234/abc",
    ] {
        assert_eq!(normalize_doi(s).unwrap(), "10.1234/abc");
    }
    assert!(normalize_doi("junk").is_err());
}
#[test]
fn duplicate_import_preserves_user_work_and_note() {
    let (_d, mut s) = setup();
    let mut a = Paper::blank("Original correction");
    a.doi = "10.1234/test".into();
    a.tags = vec!["personal".into()];
    a.status = "read".into();
    a.pinned = true;
    a.x = 999.;
    a.summary = "My assessment".into();
    let a = s.save(a, false).unwrap();
    let n = s.read_note(&a.id).unwrap();
    s.save_note(&a.id, "Personal note", &n.revision).unwrap();
    let mut b = Paper::blank("API title");
    b.doi = "https://doi.org/10.1234/TEST".into();
    let b = s.save(b, true).unwrap();
    assert_eq!(a.id, b.id);
    assert_eq!(b.title, "Original correction");
    assert_eq!(b.summary, "My assessment");
    assert_eq!(b.x, 999.);
    assert_eq!(b.status, "read");
    assert!(b.pinned);
    assert_eq!(b.tags, vec!["personal"]);
    assert_eq!(s.read_note(&a.id).unwrap().content, "Personal note");
    assert_eq!(s.snapshot().unwrap().papers.len(), 1);
}
#[test]
fn conflicting_identifiers_are_not_silently_merged() {
    let (_d, mut s) = setup();
    let mut a = Paper::blank("A");
    a.doi = "10.1234/a".into();
    s.save(a, false).unwrap();
    let mut b = Paper::blank("B");
    b.openalex = "W2".into();
    s.save(b, false).unwrap();
    let mut c = Paper::blank("C");
    c.source = "OpenAlex".into();
    c.doi = "10.1234/a".into();
    c.openalex = "W2".into();
    assert!(s.save(c, true).is_err());
    assert_eq!(s.snapshot().unwrap().papers.len(), 2);
}
#[test]
fn title_only_records_are_never_merged() {
    let (_d, mut s) = setup();
    s.save(Paper::blank("Same title"), true).unwrap();
    s.save(Paper::blank("Same title"), true).unwrap();
    assert_eq!(s.snapshot().unwrap().papers.len(), 2);
}
#[test]
fn shared_citations_and_duplicate_edges() {
    let (_d, mut s) = setup();
    let mut a = Paper::blank("A");
    a.openalex = "W1".into();
    let a = s.save(a, false).unwrap();
    let mut b = Paper::blank("B");
    b.openalex = "W2".into();
    let b = s.save(b, false).unwrap();
    let mut c = Paper::blank("C");
    c.references = vec![a.openalex.clone(), b.openalex.clone()];
    c.source = "OpenAlex".into();
    let c = s.save(c, false).unwrap();
    s.infer_edges().unwrap();
    s.infer_edges().unwrap();
    let snap = s.snapshot().unwrap();
    assert_eq!(snap.citations.len(), 2);
    assert!(snap
        .citations
        .iter()
        .all(|e| e.citing == c.id && e.verified));
    s.edge(&edge(&c.id, &a.id)).unwrap();
    assert_eq!(s.snapshot().unwrap().citations.len(), 2);
    assert!(s.snapshot().unwrap().citations.iter().all(|e| e.verified));
}
#[test]
fn manually_entered_references_do_not_become_provider_verified() {
    let (_d, mut s) = setup();
    let mut a = Paper::blank("A");
    a.openalex = "W1".into();
    let a = s.save(a, false).unwrap();
    let mut b = Paper::blank("B");
    b.references = vec![a.openalex];
    s.save(b, false).unwrap();
    s.infer_edges().unwrap();
    let edges = s.snapshot().unwrap().citations;
    assert_eq!(edges.len(), 1);
    assert!(!edges[0].verified);
    assert_eq!(edges[0].source, "manual references");
}
#[test]
fn invalid_foreign_keys_self_citations_and_cycles() {
    let (_d, mut s) = setup();
    let a = s.save(Paper::blank("A"), false).unwrap();
    let b = s.save(Paper::blank("B"), false).unwrap();
    assert!(s
        .edge(&edge(&a.id, &uuid::Uuid::new_v4().to_string()))
        .is_err());
    assert!(s.edge(&edge(&a.id, &a.id)).is_err());
    s.edge(&edge(&a.id, &b.id)).unwrap();
    s.edge(&edge(&b.id, &a.id)).unwrap();
    assert_eq!(s.snapshot().unwrap().citations.len(), 2);
}
#[test]
fn invalid_metadata_is_rejected_without_records() {
    let (_d, mut s) = setup();
    for mut p in [Paper::blank(""), Paper::blank("OK"), Paper::blank("Other")] {
        if p.title == "OK" {
            p.status = "bogus".into();
        }
        if p.title == "Other" {
            p.url = "javascript:alert(1)".into();
        }
        assert!(s.save(p, false).is_err());
    }
    assert!(s.snapshot().unwrap().papers.is_empty());
}
#[test]
fn position_updates_do_not_reset_pinning_or_metadata() {
    let (_d, mut s) = setup();
    let mut p = Paper::blank("A");
    p.pinned = true;
    let p = s.save(p, false).unwrap();
    s.position(&p.id, -12., 99.).unwrap();
    let q = s.paper(&p.id).unwrap();
    assert_eq!((q.x, q.y), (-12., 99.));
    assert!(q.pinned);
    assert!(s.position(&p.id, f64::NAN, 0.).is_err());
}
#[test]
fn statuses_and_hiding_preserve_notes_and_relationships() {
    let (_d, mut s) = setup();
    let a = s.save(Paper::blank("A"), false).unwrap();
    let mut b = s.save(Paper::blank("B"), false).unwrap();
    s.edge(&edge(&b.id, &a.id)).unwrap();
    for status in [
        "core",
        "candidate",
        "unreviewed",
        "read",
        "archived",
        "rejected",
    ] {
        b.status = status.into();
        b.hidden = true;
        b = s.save(b, false).unwrap();
        assert!(s.read_note(&b.id).unwrap().exists);
        assert_eq!(s.snapshot().unwrap().citations.len(), 1);
    }
}
#[test]
fn failed_batch_savepoint_rolls_back_papers_and_layout() {
    let (_d, mut s) = setup();
    s.db.execute_batch("SAVEPOINT batch_import").unwrap();
    s.save(Paper::blank("Should roll back"), true).unwrap();
    assert!(s.save(Paper::blank(""), true).is_err());
    s.db.execute_batch("ROLLBACK TO batch_import; RELEASE batch_import")
        .unwrap();
    assert!(s.snapshot().unwrap().papers.is_empty());
}
#[test]
fn notes_are_never_overwritten_by_metadata_edits() {
    let (_d, mut s) = setup();
    let mut p = s.save(Paper::blank("Original"), false).unwrap();
    let n = s.read_note(&p.id).unwrap();
    s.save_note(&p.id, "# My notes\n\nUnicode پژوهش", &n.revision)
        .unwrap();
    p.title = "Updated title".into();
    s.save(p.clone(), false).unwrap();
    assert!(s
        .read_note(&p.id)
        .unwrap()
        .content
        .contains("Unicode پژوهش"));
}
#[test]
fn external_note_conflicts_and_recovery_copy() {
    let (_d, mut s) = setup();
    let p = s.save(Paper::blank("Notes"), false).unwrap();
    let n = s.read_note(&p.id).unwrap();
    fs::write(s.note_path(&p.id).unwrap(), "External editor update").unwrap();
    assert!(s.save_note(&p.id, "Stale edits", &n.revision).is_err());
    let n = s.read_note(&p.id).unwrap();
    s.save_note(&p.id, "Merged edits", &n.revision).unwrap();
    assert_eq!(
        fs::read_to_string(s.note_path(&p.id).unwrap().with_extension("md.previous")).unwrap(),
        "External editor update"
    );
}
#[test]
fn missing_note_can_be_recreated_safely() {
    let (_d, mut s) = setup();
    let p = s.save(Paper::blank("Missing"), false).unwrap();
    fs::remove_file(s.note_path(&p.id).unwrap()).unwrap();
    let n = s.read_note(&p.id).unwrap();
    assert!(!n.exists);
    assert_eq!(n.revision, "");
    s.save_note(&p.id, &n.content, &n.revision).unwrap();
    assert!(s.read_note(&p.id).unwrap().exists);
}
#[test]
fn note_path_rejects_traversal() {
    let (_d, s) = setup();
    assert!(s.note_path("../../evil").is_err());
    assert!(s.note_path("C:\\evil").is_err());
}
#[test]
fn deletion_retains_markdown_file_for_recovery() {
    let (_d, mut s) = setup();
    let p = s.save(Paper::blank("Delete me"), false).unwrap();
    let path = s.note_path(&p.id).unwrap();
    s.db.execute("DELETE FROM papers WHERE id=?", [p.id])
        .unwrap();
    assert!(s.snapshot().unwrap().papers.is_empty());
    assert!(path.exists());
}
#[test]
fn backup_restore_roundtrip_preserves_entire_workspace() {
    let (d, mut s) = setup();
    let mut p = Paper::blank("備份 پژوهش");
    p.status = "core".into();
    p.tags = vec!["methods".into()];
    p.pinned = true;
    p.x = 42.;
    p.y = 51.;
    let p = s.save(p, false).unwrap();
    let b = s.save(Paper::blank("B"), false).unwrap();
    s.edge(&edge(&b.id, &p.id)).unwrap();
    let n = s.read_note(&p.id).unwrap();
    s.save_note(&p.id, "# Notes\n\nPersian فارسی", &n.revision)
        .unwrap();
    s.setting("theme", "light").unwrap();
    let target = d.path().join("backup.yara");
    backup::export(&s, &target).unwrap();
    let restored = backup::restore(d.path(), &target).unwrap();
    let snap = restored.snapshot().unwrap();
    assert_eq!(snap.papers.len(), 2);
    assert_eq!(snap.citations.len(), 1);
    let q = restored.paper(&p.id).unwrap();
    assert_eq!((q.x, q.y), (42., 51.));
    assert_eq!(q.status, "core");
    assert_eq!(q.tags, p.tags);
    assert!(q.pinned);
    assert_eq!(
        restored.read_note(&p.id).unwrap().content,
        "# Notes\n\nPersian فارسی"
    );
    assert_eq!(snap.settings["theme"], "light");
    assert!(s.root.exists());
    backup::activate(d.path(), &restored.root).unwrap();
    assert_eq!(backup::active_root(d.path()).unwrap(), restored.root);
}
#[test]
fn backup_failures_preserve_existing_data() {
    let (d, mut s) = setup();
    let p = s.save(Paper::blank("A"), false).unwrap();
    let target = d.path().join("existing.yara");
    fs::write(&target, "old backup").unwrap();
    assert!(backup::export(&s, &target).is_err());
    assert_eq!(fs::read_to_string(&target).unwrap(), "old backup");
    assert!(backup::restore(d.path(), &target).is_err());
    assert_eq!(s.snapshot().unwrap().papers.len(), 1);
    assert!(s.read_note(&p.id).unwrap().exists);
    assert!(backup::export(&s, &d.path().join("unavailable/backup.yara")).is_err());
}
#[test]
fn missing_notes_fail_complete_backup_explicitly() {
    let (d, mut s) = setup();
    let p = s.save(Paper::blank("A"), false).unwrap();
    fs::remove_file(s.note_path(&p.id).unwrap()).unwrap();
    assert!(backup::export(&s, &d.path().join("missing.yara"))
        .unwrap_err()
        .contains("missing"));
}
#[test]
fn restore_rejects_unsafe_archive_paths() {
    let (d, s) = setup();
    let target = d.path().join("malicious.yara");
    let f = fs::File::create(&target).unwrap();
    let mut z = zip::ZipWriter::new(f);
    z.start_file("../escape", zip::write::SimpleFileOptions::default())
        .unwrap();
    z.write_all(b"malicious").unwrap();
    z.finish().unwrap();
    assert!(backup::restore(d.path(), &target)
        .err()
        .unwrap()
        .contains("unsafe"));
    assert!(s.root.exists());
    assert!(!d.path().join("escape").exists());
}
#[test]
fn checksum_mismatch_is_rejected() {
    let (d, s) = setup();
    let target = d.path().join("damaged.yara");
    let f = fs::File::create(&target).unwrap();
    let mut z = zip::ZipWriter::new(f);
    let o = zip::write::SimpleFileOptions::default();
    z.start_file("manifest.json", o).unwrap();
    z.write_all(br#"{"format":"yara-research","version":1,"files":{"workspace.sqlite":"wrong"}}"#)
        .unwrap();
    z.start_file("workspace.sqlite", o).unwrap();
    z.write_all(b"bad bytes").unwrap();
    z.finish().unwrap();
    assert!(backup::restore(d.path(), &target)
        .err()
        .unwrap()
        .contains("checksum"));
    assert!(s.root.exists());
}
#[test]
fn provider_parsing_reconstructs_abstract_and_handles_missing_values() {
    let w = json!({"id":"https://openalex.org/W1","title":"Title","abstract_inverted_index":{"world":[1],"Hello":[0]},"referenced_works":["https://openalex.org/W2"],"authorships":[{"author":{"display_name":"Jane Doe"}}]});
    let p = discovery::parse_work(&w).unwrap();
    assert_eq!(p.r#abstract, "Hello world");
    assert_eq!(p.authors, vec!["Jane Doe"]);
    assert_eq!(p.references.len(), 1);
    assert!(p.year.is_none());
    assert!(discovery::parse_work(&json!({"id":"W1"})).is_err());
    assert!(discovery::parse_result(&json!({"unexpected":true}), 1).is_err());
}
#[test]
fn provider_pagination_and_citation_filter_semantics() {
    let q = |mode: &str, page| DiscoveryQuery {
        session_id: None,
        mode: mode.into(),
        term: "https://openalex.org/W123".into(),
        page,
        refresh: false,
    };
    let u = discovery::api_url(&q("citing", 2)).unwrap();
    assert!(u
        .query_pairs()
        .any(|(k, v)| k == "filter" && v == "cites:W123"));
    assert!(u.query_pairs().any(|(k, v)| k == "page" && v == "2"));
    let u = discovery::api_url(&q("references", 1)).unwrap();
    assert!(u
        .query_pairs()
        .any(|(k, v)| k == "filter" && v == "cited_by:W123"));
    assert!(discovery::api_url(&q("citing", 0)).is_err());
    let r = discovery::parse_result(&json!({"meta":{"count":101},"results":[]}), 2).unwrap();
    assert!(r.more);
    assert!(
        !discovery::parse_result(&json!({"meta":{"count":100},"results":[]}), 2)
            .unwrap()
            .more
    );
}
#[test]
fn query_cache_is_persisted_locally() {
    let (_d, s) = setup();
    let r = DiscoveryResult {
        refresh_error: None,
        papers: vec![Paper::blank("Cached")],
        count: 1,
        page: 1,
        more: false,
        cached: false,
        fetched_at: "2026-11-01".into(),
        stale: false,
    };
    s.cache_put("key", &r).unwrap();
    assert_eq!(
        s.cache_get("key").unwrap().unwrap().papers[0].title,
        "Cached"
    );
    assert!(s.cache_get("unknown").unwrap().is_none());
}
#[test]
fn external_urls_reject_executable_schemes_and_credentials() {
    for u in [
        "javascript:alert(1)",
        "file:///C:/Windows/notepad.exe",
        "https://user:password@example.com",
    ] {
        assert!(validate_url(u).is_err());
    }
    assert!(validate_url("https://doi.org/10.1234/a").is_ok());
}

#[test]
fn duplicate_import_enriches_missing_identifiers_without_replacing_corrections() {
    let (_d, mut s) = setup();
    let mut a = Paper::blank("My corrected title");
    a.doi = "10.1234/a".into();
    a.summary = "Personal assessment".into();
    let a = s.save(a, false).unwrap();
    let mut remote = Paper::blank("Provider title");
    remote.doi = a.doi.clone();
    remote.openalex = "https://openalex.org/W1".into();
    remote.authors = vec!["Jane Doe".into()];
    let result = s.save(remote, true).unwrap();
    assert_eq!(result.title, a.title);
    assert_eq!(result.summary, a.summary);
    assert_eq!(result.openalex, "https://openalex.org/W1");
    assert_eq!(result.authors, vec!["Jane Doe"]);
}

fn mock_http(status: &str, headers: &str, body: &str) -> url::Url {
    use std::io::Read;
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n{headers}\r\n{body}",
        body.len()
    );
    std::thread::spawn(move || {
        if let Ok((mut stream, _)) = listener.accept() {
            let mut request = [0; 8192];
            let _ = stream.read(&mut request);
            let _ = stream.write_all(response.as_bytes());
        }
    });
    url::Url::parse(&format!("http://{address}/works")).unwrap()
}
#[tokio::test]
async fn provider_invalid_key_is_recoverable() {
    let url = mock_http("403 Forbidden", "", "{}");
    let e = discovery::fetch_url(url, 1, "invalid", std::time::Duration::from_secs(2))
        .await
        .unwrap_err();
    assert!(e.contains("rejected the API key"));
    assert!(!e.contains("invalid"));
}
#[tokio::test]
async fn provider_rate_limit_respects_retry_after() {
    let url = mock_http("429 Too Many Requests", "Retry-After: 45\r\n", "{}");
    let e = discovery::fetch_url(url, 1, "", std::time::Duration::from_secs(2))
        .await
        .unwrap_err();
    assert!(e.contains("45 seconds"));
}
#[tokio::test]
async fn provider_rejects_malformed_json() {
    let url = mock_http("200 OK", "", "not json");
    let e = discovery::fetch_url(url, 1, "", std::time::Duration::from_secs(2))
        .await
        .unwrap_err();
    assert!(e.contains("invalid JSON"));
}
#[tokio::test]
async fn provider_offline_failure_is_bounded() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    drop(listener);
    let url = url::Url::parse(&format!("http://{address}/works")).unwrap();
    let start = std::time::Instant::now();
    let error = discovery::fetch_url(url, 1, "", std::time::Duration::from_millis(100))
        .await
        .unwrap_err();
    // Windows may drop a closed-port connection rather than immediately refusing it.
    assert!(
        error.contains("Cannot reach OpenAlex") || error.contains("timed out"),
        "{error}"
    );
    assert!(start.elapsed() < std::time::Duration::from_secs(5));
}
#[tokio::test]
async fn provider_timeout_retries_then_returns_clear_error() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    std::thread::spawn(move || {
        let mut streams = vec![];
        for _ in 0..3 {
            streams.push(listener.accept().unwrap().0);
        }
        std::thread::sleep(std::time::Duration::from_millis(300));
    });
    let url = url::Url::parse(&format!("http://{address}/works")).unwrap();
    assert!(
        discovery::fetch_url(url, 1, "", std::time::Duration::from_millis(80))
            .await
            .unwrap_err()
            .contains("timed out")
    );
}
