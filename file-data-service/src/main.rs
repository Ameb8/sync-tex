// src/main.rs
//
// Entry point for the compaction-service gRPC server.
//
// Responsibilities:
//   1. Initialise structured logging via `tracing-subscriber`.
//   2. Load runtime configuration from environment variables.
//   3. Construct the gRPC service implementation.
//   4. Start the tonic server and block until shutdown.

mod compaction;
mod config;
mod export;
mod http;
mod proto;
mod server;

use std::net::SocketAddr;

use tonic::transport::Server;
use tracing::info;

use crate::config::Config;
use crate::proto::compaction::compaction_service_server::CompactionServiceServer;
use crate::server::CompactionServiceImpl;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Enable RUST_LOG to control log display levels
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    // Configuration
    let cfg = Config::from_env();
    info!(grpc_addr = %cfg.grpc_addr, "Starting compaction-service");

    // Parse bind address
    let addr: SocketAddr = cfg.grpc_addr.parse().unwrap_or_else(|e| {
        panic!(
            "Invalid GRPC_ADDR '{}': {}",
            cfg.grpc_addr, e
        )
    });

    // Build the gRPC service
    let svc = CompactionServiceImpl::new();
    let svc_server = CompactionServiceServer::new(svc);

    // Start server
    info!(%addr, "gRPC server listening");
    Server::builder()
        .add_service(svc_server)
        .serve(addr)
        .await?;

    Ok(())
}