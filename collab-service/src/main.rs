//! Entry point.  Builds config, shared state, and the Axum router, then
//! serves until interrupted.

mod config;
mod error;
mod state;
mod doc;
mod yjs;
mod upload;
mod projects;
mod ws;

use std::sync::Arc;
use axum::{routing::get, Router};
use tower_http::trace::TraceLayer;
use tracing::info;

#[tokio::main]
async fn main() {
    // Initialise structured logging
    // RUST_LOG controls verbosity
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
        )
        .init();

    // Load server config from environmental variables
    let config = config::Config::from_env();
    let bind_addr = config.bind_addr.clone();

    // Wrap AppState in Arc so every cloned handler shares it cheaply
    let app_state = Arc::new(state::AppState::new(config));

    // Setup request routing
    let app = Router::new()
        // WebSocket endpoint.  doc_id is a path parameter
        .route("/ws/:doc_id", get(ws::handler::ws_handler))
        // Simple health check for load balancers / k8s liveness probes
        .route("/health", get(|| async { "ok" }))
        .layer(TraceLayer::new_for_http())
        .with_state(app_state);

    // Run server
    info!("collab-service listening on {bind_addr}");
    let listener = tokio::net::TcpListener::bind(&bind_addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}