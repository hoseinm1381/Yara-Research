use crate::{backup, bridge, database::Store, evidence, models::*, workspaces};
use serde_json::json;
fn setup() -> (tempfile::TempDir, Store) {
    let dir = tempfile::tempdir().unwrap();
    let s = Store::open(&dir.path().join("workspace")).unwrap();
    (dir, s)
}
fn focal() -> Paper {
    let mut p = Paper::blank("Focal IEEE paper");
    p.doi = "10.1109/5.726791".into();
    p.ieee = "726791".into();
    p.openalex = "https://openalex.org/W1".into();
    p
}
fn related(title: &str, doi: &str) -> Paper {
    let mut p = Paper::blank(title);
    p.doi = doi.into();
    p
}
#[test]
fn ieee_complete_metadata_survives_bridge_sqlite_restart_and_safe_enrichment() {
    let (dir, mut s) = setup();
    let workspace = s.workspace().unwrap().id;
    let mut minimal = Paper::blank("Title-only initial import");
    minimal.ieee = "726791".into();
    let first = bridge::handle(
        dir.path(),
        message(
            &uuid::Uuid::new_v4().to_string(),
            &workspace,
            None,
            Some(minimal),
        ),
    )
    .unwrap();
    let id = first["paperId"].as_str().unwrap().to_string();
    let mut old = s.paper(&id).unwrap();
    old.title = "My corrected title".into();
    old.status = "read".into();
    old.tags = vec!["Personal tag".into()];
    old.pinned = true;
    old.hidden = true;
    old.x = 321.;
    old.y = -123.;
    s.save(old, false).unwrap();
    let note = s.read_note(&id).unwrap();
    s.save_note(&id, "My notes فارسی α²", &note.revision)
        .unwrap();
    let other = s
        .save(related("Connected work", "10.1234/connected"), false)
        .unwrap();
    s.edge(&Citation {
        citing: id.clone(),
        cited: other.id.clone(),
        source: "manual".into(),
        verified: false,
        created_at: chrono::Utc::now().to_rfc3339(),
    })
    .unwrap();
    let mut incoming = Paper::blank("Provider title");
    incoming.ieee = "726791".into();
    incoming.doi = "10.1109/5.726791".into();
    incoming.authors = vec!["Zoë García".into(), "李华".into()];
    incoming.year = Some(1998);
    incoming.publication_date = "November 1998".into();
    incoming.journal = "Proceedings of the IEEE".into();
    incoming.publisher = "IEEE".into();
    incoming.r#abstract = "Complete abstract α².\n\nSecond paragraph.".into();
    incoming.keywords = vec!["Neural networks".into(), "認識".into()];
    incoming.citation_count = Some(42);
    let imported = bridge::handle(
        dir.path(),
        message(
            &uuid::Uuid::new_v4().to_string(),
            &workspace,
            None,
            Some(incoming.clone()),
        ),
    )
    .unwrap();
    assert_eq!(imported["paperId"].as_str().unwrap(), id);
    drop(s);
    let mut s = Store::open(&dir.path().join("workspace")).unwrap();
    let stored = s.paper(&id).unwrap();
    assert_eq!(stored.authors, incoming.authors);
    assert_eq!(stored.doi, incoming.doi);
    assert_eq!(stored.year, Some(1998));
    assert_eq!(stored.publication_date, incoming.publication_date);
    assert_eq!(stored.journal, incoming.journal);
    assert_eq!(stored.publisher, incoming.publisher);
    assert_eq!(stored.r#abstract, incoming.r#abstract);
    assert_eq!(stored.keywords, incoming.keywords);
    assert_eq!(stored.citation_count, Some(42));
    assert_eq!(stored.title, "My corrected title");
    assert_eq!(stored.status, "read");
    assert_eq!(stored.tags, vec!["Personal tag"]);
    assert_eq!(stored.x, 321.);
    assert_eq!(stored.y, -123.);
    assert!(stored.pinned && stored.hidden);
    assert_eq!(s.read_note(&id).unwrap().content, "My notes فارسی α²");
    assert_eq!(s.snapshot().unwrap().papers.len(), 2);
    assert_eq!(s.snapshot().unwrap().citations.len(), 1);
    let mut corrected = stored;
    corrected.keywords = vec!["My corrected keyword".into()];
    corrected.authors = vec!["My corrected author".into()];
    corrected.citation_count = Some(123);
    s.save(corrected, false).unwrap();
    bridge::handle(
        dir.path(),
        message(
            &uuid::Uuid::new_v4().to_string(),
            &workspace,
            None,
            Some(incoming),
        ),
    )
    .unwrap();
    assert_eq!(s.paper(&id).unwrap().keywords, vec!["My corrected keyword"]);
    assert_eq!(s.paper(&id).unwrap().authors, vec!["My corrected author"]);
    assert_eq!(s.paper(&id).unwrap().citation_count, Some(123));
    assert!(s
        .evidence(&s.paper(&id).unwrap(), "references")
        .unwrap()
        .is_empty());
}
fn capture(provider: &str, items: Vec<Paper>) -> EvidenceSnapshot {
    EvidenceSnapshot {
        id: uuid::Uuid::new_v4().to_string(),
        provider: provider.into(),
        direction: "references".into(),
        focal: focal(),
        captured_at: chrono::Utc::now().to_rfc3339(),
        source_url: "https://ieeexplore.ieee.org/document/726791".into(),
        method: "Test fixture · structured bibliography".into(),
        coverage: "partial".into(),
        total: Some(10),
        raw: "Original citation export".into(),
        error: String::new(),
        items,
    }
}
fn message(id: &str, w: &str, c: Option<EvidenceSnapshot>, p: Option<Paper>) -> bridge::Message {
    bridge::Message {
        version: 1,
        request_id: id.into(),
        action: if c.is_some() {
            "capture_relationships"
        } else {
            "import_paper"
        }
        .into(),
        workspace_id: Some(w.into()),
        paper: p,
        capture: c,
        page_url: Some("https://ieeexplore.ieee.org/document/726791".into()),
        provider: Some("IEEE".into()),
    }
}
#[test]
fn legacy_database_migrates_without_changing_notes_layout_or_papers() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("workspace");
    std::fs::create_dir_all(root.join("notes")).unwrap();
    let db = rusqlite::Connection::open(root.join("workspace.sqlite")).unwrap();
    db.execute_batch(include_str!("../migrations/001_initial.sql"))
        .unwrap();
    let mut p = focal();
    p.pinned = true;
    p.x = 331.;
    p.y = -92.;
    let mut raw = serde_json::to_value(&p).unwrap();
    raw.as_object_mut().unwrap().remove("ieee");
    db.execute(
        "INSERT INTO papers VALUES(?1,?2,?3,?4,?5,?6)",
        rusqlite::params![p.id, p.doi, p.openalex, p.title, p.status, raw.to_string()],
    )
    .unwrap();
    db.execute("INSERT INTO layout VALUES(?1,331,-92,1,0)", [&p.id])
        .unwrap();
    db.execute("INSERT INTO settings VALUES('theme','light')", [])
        .unwrap();
    db.execute(
        "INSERT INTO settings VALUES('viewport','{\"x\":31,\"y\":-18,\"zoom\":0.7}')",
        [],
    )
    .unwrap();
    std::fs::write(
        root.join("notes").join(format!("{}.md", p.id)),
        "Private notes فارسی",
    )
    .unwrap();
    drop(db);
    let s = Store::open(&root).unwrap();
    assert_eq!(s.snapshot().unwrap().papers.len(), 1);
    assert_eq!(s.paper(&p.id).unwrap().x, 331.);
    assert!(s.paper(&p.id).unwrap().pinned);
    assert_eq!(s.snapshot().unwrap().settings["theme"], "light");
    assert_eq!(
        s.snapshot().unwrap().settings["viewport"],
        "{\"x\":31,\"y\":-18,\"zoom\":0.7}"
    );
    assert_eq!(s.read_note(&p.id).unwrap().content, "Private notes فارسی");
    assert!(uuid::Uuid::parse_str(&s.workspace().unwrap().id).is_ok());
}
#[test]
fn genuine_v1_schema_and_backup_manifest_restore_safely() {
    use std::{collections::BTreeMap, io::Write};
    use zip::{write::SimpleFileOptions, ZipWriter};
    let dir = tempfile::tempdir().unwrap();
    let sqlite = dir.path().join("legacy.sqlite");
    let db = rusqlite::Connection::open(&sqlite).unwrap();
    db.execute_batch(include_str!("../migrations/001_initial.sql"))
        .unwrap();
    let p = focal();
    let mut raw = serde_json::to_value(&p).unwrap();
    raw.as_object_mut().unwrap().remove("ieee");
    db.execute(
        "INSERT INTO papers VALUES(?1,?2,?3,?4,?5,?6)",
        rusqlite::params![p.id, p.doi, p.openalex, p.title, p.status, raw.to_string()],
    )
    .unwrap();
    db.execute("INSERT INTO layout VALUES(?1,123,-45,1,0)", [&p.id])
        .unwrap();
    drop(db);
    let bytes = std::fs::read(&sqlite).unwrap();
    let note = "Legacy backup notes فارسی".as_bytes();
    let note_name = format!("notes/{}.md", p.id);
    let hashes = BTreeMap::from([
        (
            "workspace.sqlite".to_string(),
            crate::database::hash(&bytes),
        ),
        (note_name.clone(), crate::database::hash(note)),
    ]);
    let manifest = json!({"format":"yara-research","version":1,"files":hashes});
    let archive = dir.path().join("legacy.yara");
    let mut zip = ZipWriter::new(std::fs::File::create(&archive).unwrap());
    for (name, data) in [
        (
            "manifest.json".to_string(),
            manifest.to_string().into_bytes(),
        ),
        ("workspace.sqlite".into(), bytes),
        (note_name, note.to_vec()),
    ] {
        zip.start_file(name, SimpleFileOptions::default()).unwrap();
        zip.write_all(&data).unwrap();
    }
    zip.finish().unwrap();
    let restored = backup::restore(dir.path(), &archive).unwrap();
    assert_eq!(restored.snapshot().unwrap().papers.len(), 1);
    assert_eq!(restored.paper(&p.id).unwrap().x, 123.);
    assert_eq!(restored.paper(&p.id).unwrap().ieee, "");
    assert_eq!(
        restored.read_note(&p.id).unwrap().content,
        "Legacy backup notes فارسی"
    );
    assert!(uuid::Uuid::parse_str(&restored.workspace().unwrap().id).is_ok());
    assert!(archive.is_file());
}
#[test]
fn metadata_provenance_never_implies_a_relationship() {
    let (_d, mut s) = setup();
    let f = s.save(focal(), false).unwrap();
    let b = s.save(related("B", "10.1234/b"), false).unwrap();
    s.metadata_source(
        &b.id,
        "IEEE",
        "https://ieeexplore.ieee.org/document/726791",
        &b,
    )
    .unwrap();
    assert!(s.evidence(&f, "references").unwrap().is_empty());
    assert!(s.snapshot().unwrap().citations.is_empty());
}
#[test]
fn independent_source_relationships_and_partial_history_survive() {
    let (d, s) = setup();
    let b = related("B", "10.1234/b");
    s.capture(capture("IEEE", vec![b.clone()]), 1).unwrap();
    s.capture(capture("OpenAlex", vec![b.clone()]), 1).unwrap();
    let mut failed = capture("IEEE", vec![]);
    failed.coverage = "failed".into();
    failed.error = "Page not loaded".into();
    s.capture(failed, 1).unwrap();
    let mut partial = capture("IEEE", vec![related("C", "10.1234/c")]);
    partial.total = Some(12);
    s.capture(partial, 1).unwrap();
    drop(s);
    let s = Store::open(&d.path().join("workspace")).unwrap();
    let all = s.evidence(&focal(), "references").unwrap();
    assert_eq!(all.len(), 4);
    assert_eq!(
        all.iter()
            .filter(|c| c.items.iter().any(|p| p.doi == b.doi))
            .count(),
        2
    );
    assert!(all.iter().any(|c| c.coverage == "failed"));
    assert!(s.evidence(&focal(), "citing").unwrap().is_empty());
}
#[test]
fn capture_session_cannot_be_reused_for_a_different_context() {
    let (_d, s) = setup();
    let c = capture("IEEE", vec![related("B", "10.1234/b")]);
    s.capture(c.clone(), 1).unwrap();
    let mut wrong = c.clone();
    wrong.direction = "citing".into();
    assert!(s.capture(wrong, 2).is_err());
    let mut wrong = c.clone();
    wrong.focal.doi = "10.1234/different".into();
    assert!(s.capture(wrong, 2).is_err());
    let mut wrong = c;
    wrong.provider = "OpenAlex".into();
    assert!(s.capture(wrong, 2).is_err());
    assert_eq!(
        s.evidence(&focal(), "references").unwrap()[0].items.len(),
        1
    );
}
#[test]
fn ieee_capture_requires_real_article_context() {
    let (_d, s) = setup();
    for url in [
        "https://example.com/document/726791",
        "https://ieeexplore.ieee.org.evil.test/document/726791",
        "http://ieeexplore.ieee.org/document/726791",
        "https://ieeexplore.ieee.org:8443/document/726791",
        "https://ieeexplore.ieee.org/search/searchresult.jsp",
    ] {
        let mut c = capture("IEEE", vec![]);
        c.source_url = url.into();
        assert!(s.capture(c, 1).is_err());
    }
    let mut c = capture("IEEE", vec![]);
    c.focal.ieee = "999".into();
    assert!(s.capture(c, 1).is_err());
    assert_eq!(
        evidence::ieee_url("https://ieeexplore.ieee.org/document/726791?x=1#references").unwrap(),
        "https://ieeexplore.ieee.org/document/726791"
    );
}
#[test]
fn complete_capture_requires_known_total_and_all_distinct_entries() {
    let (_d, s) = setup();
    let b = related("B", "10.1234/b");
    let mut c = capture("IEEE", vec![b.clone()]);
    c.coverage = "complete".into();
    assert!(s.capture(c.clone(), 1).is_err());
    c.total = Some(1);
    s.capture(c.clone(), 1).unwrap();
    c.id = uuid::Uuid::new_v4().to_string();
    c.items.push(b);
    c.total = Some(2);
    assert!(s.capture(c, 1).is_err());
}
#[test]
fn openalex_only_becomes_complete_after_all_pages_and_counts() {
    let (_d, mut s) = setup();
    let f = s.save(focal(), false).unwrap();
    let q = |page| DiscoveryQuery {
        mode: "references".into(),
        term: f.openalex.clone(),
        page,
        refresh: true,
        session_id: Some("d362e946-97ba-4908-bfc3-e5130123e631".into()),
    };
    let p = |i| {
        let mut p = related(&format!("Paper {i}"), &format!("10.1234/{i}"));
        p.openalex = format!("https://openalex.org/W{}", i + 10);
        p
    };
    let mut r = DiscoveryResult {
        papers: (0..50).map(p).collect(),
        count: 51,
        page: 1,
        more: true,
        cached: false,
        fetched_at: chrono::Utc::now().to_rfc3339(),
        stale: false,
        refresh_error: None,
    };
    s.record_openalex(&q(1), &r).unwrap();
    assert_eq!(s.evidence(&f, "references").unwrap()[0].coverage, "partial");
    r.papers = vec![p(50)];
    r.page = 2;
    r.more = false;
    s.record_openalex(&q(2), &r).unwrap();
    let c = &s.evidence(&f, "references").unwrap()[0];
    assert_eq!(c.coverage, "complete");
    assert_eq!(c.items.len(), 51);
}
#[test]
fn real_named_workspaces_are_isolated_and_never_moved() {
    let (d, mut a) = setup();
    a.save(focal(), false).unwrap();
    let b = workspaces::create(d.path(), "Different research").unwrap();
    let list = workspaces::list(d.path()).unwrap();
    assert_eq!(list.len(), 2);
    assert_ne!(a.workspace().unwrap().id, b.workspace().unwrap().id);
    assert_eq!(b.snapshot().unwrap().papers.len(), 0);
    assert!(workspaces::find(d.path(), "../../workspace").is_err());
    assert_eq!(
        workspaces::find(d.path(), &a.workspace().unwrap().id).unwrap(),
        a.root
    );
}
#[test]
fn repeated_extension_delivery_is_idempotent_and_collision_is_rejected() {
    let (d, s) = setup();
    let w = s.workspace().unwrap().id;
    let id = uuid::Uuid::new_v4().to_string();
    let m = message(
        &id,
        &w,
        Some(capture("IEEE", vec![related("B", "10.1234/b")])),
        None,
    );
    let a = bridge::handle(d.path(), m.clone()).unwrap();
    let b = bridge::handle(d.path(), m.clone()).unwrap();
    assert_eq!(a, b);
    assert_eq!(s.evidence(&focal(), "references").unwrap().len(), 1);
    let mut forged = m;
    forged.capture.as_mut().unwrap().direction = "citing".into();
    assert!(bridge::handle(d.path(), forged).is_err());
}
#[test]
fn extension_import_preserves_user_data_and_targets_selected_workspace() {
    let (d, mut a) = setup();
    let mut f = focal();
    f.status = "core".into();
    f.pinned = true;
    f.x = 123.;
    let f = a.save(f, false).unwrap();
    let b = workspaces::create(d.path(), "Other").unwrap();
    let mut incoming = focal();
    incoming.title = "Provider replacement".into();
    let m = message(
        &uuid::Uuid::new_v4().to_string(),
        &a.workspace().unwrap().id,
        None,
        Some(incoming.clone()),
    );
    bridge::handle(d.path(), m).unwrap();
    let stored = a.paper(&f.id).unwrap();
    assert_eq!(stored.title, f.title);
    assert!(stored.pinned);
    assert_eq!(stored.x, 123.);
    assert_eq!(stored.status, "core");
    assert!(b.snapshot().unwrap().papers.is_empty());
    incoming.doi = "10.1234/other".into();
    incoming.ieee = "726791".into();
    bridge::handle(
        d.path(),
        message(
            &uuid::Uuid::new_v4().to_string(),
            &b.workspace().unwrap().id,
            None,
            Some(incoming),
        ),
    )
    .unwrap();
    assert_eq!(b.snapshot().unwrap().papers.len(), 1);
    assert_eq!(a.snapshot().unwrap().papers.len(), 1);
}
#[test]
fn forged_payloads_unknown_workspaces_and_senders_are_rejected() {
    let (d, s) = setup();
    assert!(bridge::allowed_origin(&format!(
        "chrome-extension://{}/",
        bridge::EXTENSION_ID.trim()
    )));
    assert!(!bridge::allowed_origin("chrome-extension://evil/"));
    let w = s.workspace().unwrap().id;
    let mut m = message(
        &uuid::Uuid::new_v4().to_string(),
        &w,
        Some(capture("IEEE", vec![])),
        None,
    );
    m.page_url = Some("https://example.com/document/726791".into());
    assert!(bridge::handle(d.path(), m).is_err());
    let m = message(
        &uuid::Uuid::new_v4().to_string(),
        &uuid::Uuid::new_v4().to_string(),
        None,
        Some(focal()),
    );
    assert!(bridge::handle(d.path(), m).is_err());
    assert!(serde_json::from_value::<bridge::Message>(json!({"version":1,"requestId":uuid::Uuid::new_v4().to_string(),"action":"list_workspaces","shell":"evil"})).is_err());
}
#[test]
fn backup_restore_includes_sources_receipts_and_distinct_workspace_identity() {
    let (d, mut s) = setup();
    let f = s.save(focal(), false).unwrap();
    s.metadata_source(
        &f.id,
        "IEEE",
        "https://ieeexplore.ieee.org/document/726791",
        &f,
    )
    .unwrap();
    s.capture(capture("IEEE", vec![related("B", "10.1234/b")]), 1)
        .unwrap();
    let path = d.path().join("v11.yara");
    backup::export(&s, &path).unwrap();
    let restored = backup::restore(d.path(), &path).unwrap();
    assert_eq!(restored.evidence(&f, "references").unwrap().len(), 1);
    let n: i64 = restored
        .db
        .query_row("SELECT COUNT(*) FROM metadata_sources", [], |r| r.get(0))
        .unwrap();
    assert_eq!(n, 1);
    assert_ne!(s.workspace().unwrap().id, restored.workspace().unwrap().id);
    assert_eq!(
        s.read_note(&f.id).unwrap().content,
        restored.read_note(&f.id).unwrap().content
    );
}
