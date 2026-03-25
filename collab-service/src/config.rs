//! Application configuration loaded from environment variables at startup.
//! All tuneable values live here so nothing is hardcoded deeper in the stack.

use std::time::Duration;

/// Top-level config.  Constructed once in `main` and stored inside `AppState`.
#[derive(Debug, Clone)]
pub struct Config {
    /// Address the HTTP/WebSocket server will bind to, e.g. `0.0.0.0:3000`.
    pub bind_addr: String,

    /// Base URL of the projects-service, e.g. `http://projects-service:8080`.
    pub projects_service_url: String,

    /// How long to wait after the last Yjs update before triggering an upload.
    /// Prevents uploading on every keystroke.
    pub upload_debounce: Duration,

    /// Hard upper bound: even without a quiet period, force an upload this often.
    pub upload_max_interval: Duration,
}

impl Config {
    /// Read config from the environment.  Panics early on missing required vars
    /// rather than letting the service start in a broken state.
    pub fn from_env() -> Self {
        dotenvy::dotenv().ok(); // load .env file if present; ignore if absent

        // Load environmental variables into config struct
        Self {
            bind_addr: std::env::var("BIND_ADDR")
                .unwrap_or_else(|_| "0.0.0.0:3000".to_string()),

            projects_service_url: std::env::var("PROJECTS_SERVICE_URL")
                .expect("PROJECTS_SERVICE_URL must be set"),

            upload_debounce: Duration::from_millis(
                std::env::var("UPLOAD_DEBOUNCE_MS")
                    .unwrap_or_else(|_| "2000".to_string())
                    .parse()
                    .expect("UPLOAD_DEBOUNCE_MS must be a u64"),
            ),

            upload_max_interval: Duration::from_secs(
                std::env::var("UPLOAD_MAX_INTERVAL_SECS")
                    .unwrap_or_else(|_| "30".to_string())
                    .parse()
                    .expect("UPLOAD_MAX_INTERVAL_SECS must be a u64"),
            ),
        }
    }
}