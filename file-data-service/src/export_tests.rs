use yrs::{Doc, ReadTxn, Text, Transact};

use crate::export::extract_text;

fn snapshot_with(content: &str) -> Vec<u8> {
    let doc = Doc::new();
    doc.get_or_insert_text("content")
        .insert(&mut doc.transact_mut(), 0, content);
    doc.transact()
        .encode_state_as_update_v1(&yrs::StateVector::default())
}

fn framed(update: Vec<u8>) -> Vec<u8> {
    let mut output = (update.len() as u32).to_be_bytes().to_vec();
    output.extend(update);
    output
}

fn snapshot_and_pending(base: &str, appended: &str) -> (Vec<u8>, Vec<u8>) {
    let doc = Doc::new();
    let text = doc.get_or_insert_text("content");
    text.insert(&mut doc.transact_mut(), 0, base);
    let snapshot = doc
        .transact()
        .encode_state_as_update_v1(&yrs::StateVector::default());
    let state_vector = doc.transact().state_vector();
    text.insert(&mut doc.transact_mut(), base.len() as u32, appended);
    let pending = doc.transact().encode_state_as_update_v1(&state_vector);
    (snapshot, framed(pending))
}

#[test]
fn exports_snapshot_and_pending_updates() {
    let (snapshot, pending) = snapshot_and_pending("base", " + pending");
    assert_eq!(
        extract_text(Some(&snapshot), Some(&pending)).unwrap(),
        "base + pending"
    );
}

#[test]
fn exports_snapshot_only() {
    let snapshot = snapshot_with("snapshot only");
    assert_eq!(
        extract_text(Some(&snapshot), None).unwrap(),
        "snapshot only"
    );
}

#[test]
fn exports_pending_updates_only() {
    let pending = snapshot_with("pending only");
    assert_eq!(
        extract_text(None, Some(&framed(pending))).unwrap(),
        "pending only"
    );
}

#[test]
fn exports_empty_document_when_all_sources_absent() {
    assert_eq!(extract_text(None, None).unwrap(), "");
}

#[test]
fn rejects_malformed_snapshot_and_pending_frames() {
    assert!(extract_text(Some(&[0xff]), None).is_err());
    assert!(extract_text(None, Some(&[0, 0, 0, 2, 1])).is_err());
}
