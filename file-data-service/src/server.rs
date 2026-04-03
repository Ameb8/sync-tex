// src/server.rs
//
// Implements the `CompactionService` gRPC trait generated from compaction.proto.
//
// Each RPC call is handled by `CompactionServiceImpl::compact_document`, which:
//   1. Downloads the raw update log from the caller-supplied pre-signed URL.
//   2. Compacts it using the core logic in `crate::compaction`.
//   3. Uploads the compacted result to the caller-supplied upload URL.
//   4. Returns a `CompactResponse` indicating success or describing the error.
//
// This layer intentionally contains no business logic — it only wires together
// the HTTP and compaction modules and maps their results into gRPC types.

use std::sync::Arc;

use tonic::{Request, Response, Status};
use tracing::{error, info, instrument};

use crate::compaction::compact_update_log;
use crate::http::{download_bytes, upload_bytes};
use crate::proto::compaction::{
    compaction_service_server::CompactionService,
    CompactRequest,
    CompactResponse,
};


/// Shared state for the gRPC service.
///
/// `reqwest::Client` is cheaply clone-able (it wraps an `Arc` internally) and
/// should be reused across requests to benefit from connection pooling.
pub struct CompactionServiceImpl {
    http: Arc<reqwest::Client>,
}

impl CompactionServiceImpl {
    /// Construct a new service instance with a default HTTP client.
    pub fn new() -> Self {
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .expect("Failed to build reqwest HTTP client");

        Self {
            http: Arc::new(http),
        }
    }
}


// gRPC trait implementation
#[tonic::async_trait]
impl CompactionService for CompactionServiceImpl {
    /// Handle a `CompactDocument` RPC call.
    ///
    /// The `#[instrument]` attribute attaches a tracing span to every call so
    /// that log lines emitted inside the handler are correlated automatically.
    #[instrument(skip(self, request), fields(download_url, upload_url))]
    async fn compact_document(
        &self,
        request: Request<CompactRequest>,
    ) -> Result<Response<CompactResponse>, Status> {
        let req = request.into_inner();

        // Validate that both URLs were supplied
        if req.download_url.is_empty() {
            return Err(Status::invalid_argument("download_url must not be empty"));
        }
        if req.upload_url.is_empty() {
            return Err(Status::invalid_argument("upload_url must not be empty"));
        }

        info!(
            download_url = %req.download_url,
            upload_url   = %req.upload_url,
            "Received CompactDocument request"
        );

        let base_url = if req.base_snapshot_url.is_empty() {
            None
        } else {
            Some(req.base_snapshot_url.as_str())
        };

        // Delegate to the internal helper; map any error into a CompactResponse
        // rather than a gRPC Status error so the caller always gets structured
        // information back.
        match run_compaction(&self.http, &req.download_url, &req.upload_url, base_url).await {
            Ok((updates_merged, compacted_size_bytes)) => {
                info!(
                    updates_merged,
                    compacted_size_bytes,
                    "CompactDocument succeeded"
                );
                Ok(Response::new(CompactResponse {
                    success: true,
                    error_message: String::new(),
                    updates_merged,
                    compacted_size_bytes,
                }))
            }
            Err(e) => {
                // Log the full error chain at ERROR level for observability,
                // but also surface a human-readable message to the caller.
                error!(error = %e, "CompactDocument failed");
                Ok(Response::new(CompactResponse {
                    success: false,
                    error_message: format!("{:#}", e), // `{:#}` prints the full error chain
                    updates_merged: 0,
                    compacted_size_bytes: 0,
                }))
            }
        }
    }
}

/// Execute the full (download, compact, upload)
///
/// Returns `(updates_merged, compacted_size_bytes)` on success.
/// Any step that fails propagates an `anyhow::Error`.
async fn run_compaction(
    http: &reqwest::Client,
    download_url: &str,
    upload_url: &str,
    snapshot_url: Option <&str>
) -> anyhow::Result<(u32, u64)> {
    // Download the base snapshot first if one was supplied.
    let base_snapshot = if let Some(url) = snapshot_url {
        info!(bytes = ?url, "Downloading base snapshot");
        let bytes = download_bytes(http, url).await?;
        Some(bytes)
    } else {
        None
    };

    // Download the raw update log
    let raw = download_bytes(http, download_url).await?;
    info!(bytes = raw.len(), "Downloaded update log");

    // Compact the update log 
    let base_ref = base_snapshot.as_deref();
    let result = compact_update_log(&raw, base_ref)?;
    let compacted_size = result.compacted_bytes.len() as u64;
    info!(
        updates_merged    = result.updates_merged,
        compacted_bytes   = compacted_size,
        "Compaction complete"
    );

    // Upload the compacted snapshot
    upload_bytes(http, upload_url, result.compacted_bytes).await?;

    Ok((result.updates_merged, compacted_size))
}