// src/http.rs
//
// Async helpers for interacting with pre-signed object-storage URLs.

use anyhow::{Context, Result, bail};
use bytes::Bytes;
use reqwest::Client;
use tracing::{debug, info};

/// Download the entire body of a pre-signed GET URL into memory.
pub async fn download_bytes(client: &Client, url: &str) -> Result<Bytes> {
    debug!(url = %url, "Starting download from pre-signed URL");

    let response = client
        .get(url)
        .send()
        .await
        .context("HTTP GET request to download URL failed")?;

    // Treat any non-2xx status as an error so callers don't have to inspect
    // the body for error XML.
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        bail!("Download failed with HTTP {}: {}", status, body);
    }

    let content_length = response.content_length();
    let bytes = response
        .bytes()
        .await
        .context("Failed to read download response body")?;

    info!(
        bytes = bytes.len(),
        content_length = ?content_length,
        "Download complete"
    );

    Ok(bytes)
}

/// Upload raw bytes to a pre-signed PUT URL.
///
/// `Content-Type: application/octet-stream` since the compacted Yjs update
/// is opaque binary data.
pub async fn upload_bytes(client: &Client, url: &str, data: Bytes) -> Result<()> {
    let len = data.len();
    debug!(url = %url, bytes = len, "Starting upload to pre-signed URL");

    let response = client
        .put(url)
        .header("Content-Type", "application/octet-stream")
        // Some S3-compatible stores require an explicit Content-Length even
        // when the body length is deterministic; reqwest sets it automatically
        // when the body is `Bytes`, but we make the intent explicit here.
        .header("Content-Length", len.to_string())
        .body(data)
        .send()
        .await
        .context("HTTP PUT request to upload URL failed")?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        bail!("Upload failed with HTTP {}: {}", status, body);
    }

    info!(bytes = len, "Upload complete");
    Ok(())
}

/// Upload UTF-8 text to a pre-signed PUT URL.
pub async fn upload_text(client: &Client, url: &str, data: Bytes) -> Result<()> {
    let len = data.len();
    debug!(url = %url, bytes = len, "Starting text upload to pre-signed URL");

    let response = client
        .put(url)
        .header("Content-Type", "text/plain; charset=utf-8")
        .header("Content-Length", len.to_string())
        .body(data)
        .send()
        .await
        .context("HTTP PUT request to text upload URL failed")?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        bail!("Text upload failed with HTTP {}: {}", status, body);
    }

    info!(bytes = len, "Text upload complete");
    Ok(())
}