// src/config.rs
//
// Runtime configuration for the compaction service.
//
// All settings are loaded from environment variables so the service can be
// configured without rebuilding when deployed in Docker Compose alongside
// the rest of the SyncTeX stack.

use std::env;

/// Parsed runtime configuration.
#[derive(Debug, Clone)]
pub struct Config {
    /// The `[host]:port` string the gRPC server should bind to.
    /// Defaults to `[::]:50051` (all interfaces, IPv4+IPv6).
    pub grpc_addr: String,
}

impl Config {
    /// Load configuration from the current process environment.
    ///
    /// # Environment variables
    ///
    /// | Variable          | Default       | Description                              |
    /// |-------------------|---------------|------------------------------------------|
    /// | `GRPC_ADDR`       | `[::]:50051`  | Address for the gRPC server to bind to.  |
    pub fn from_env() -> Self {
        let grpc_addr = env::var("GRPC_ADDR").unwrap_or_else(|_| "0.0.0.0:50051".to_string());

        Self { grpc_addr }
    }
}