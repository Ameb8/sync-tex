//! HTTP client wrapper for the projects-service internal REST API.
//!
//! All calls are thin async wrappers around `reqwest` so callers don't need
//! to construct URLs or deserialise responses themselves.

use serde::Deserialize;
use crate::error::{CollabError, Result};

/// Response shape from `GET /internal/docs/{doc_id}/presigned-url?op=download`
#[derive(Deserialize)]
pub struct PresignedUrlResponse {
    pub url: String,
}

/// Client for the projects-service.  Cheap to clone (Arc inside).
#[derive(Clone)]
pub struct ProjectsClient {
    http: reqwest::Client,
    base_url: String,
}

impl ProjectsClient {
    pub fn new(base_url: impl Into<String>) -> Self {
        Self {
            http: reqwest::Client::new(),
            base_url: base_url.into(),
        }
    }

    /// Fetch a presigned URL to *download* the current state of `doc_id`
    /// from the file store.
    pub async fn get_download_url(&self, doc_id: &str) -> Result<String> {
        let url = format!(
            "{}/file/{}/download",
            self.base_url, doc_id
        );
        let resp: PresignedUrlResponse = self.http
            .get(&url)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        Ok(resp.url)
    }

    /// Fetch a presigned URL to *upload* (PUT) the current state of `doc_id`
    /// to the file store.
    pub async fn get_upload_url(&self, doc_id: &str) -> Result<String> {
        let url = format!(
            "{}/internal/docs/{}/presigned-url?op=upload",
            self.base_url, doc_id
        );
        let resp: PresignedUrlResponse = self.http
            .get(&url)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        Ok(resp.url)
    }

    /// Download the raw document state bytes from the file store using a
    /// presigned URL previously obtained via `get_download_url`.
    pub async fn download_state(&self, presigned_url: &str) -> Result<Vec<u8>> {
        let bytes = self.http
            .get(presigned_url)
            .send()
            .await?
            .error_for_status()?
            .bytes()
            .await?;
        Ok(bytes.to_vec())
    }

    /// Upload raw document state bytes to the file store using a presigned URL.
    pub async fn upload_state(&self, presigned_url: &str, data: Vec<u8>) -> Result<()> {
        let resp = self.http
            .put(presigned_url)
            .header("Content-Type", "application/octet-stream")
            .body(data)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            return Err(CollabError::UploadFailed { status, body });
        }
        Ok(())
    }
}