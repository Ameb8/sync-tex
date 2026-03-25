//! `AppState` is the single shared root injected into every Axum handler via
//! `State<Arc<AppState>>`.  Keeping everything here avoids passing individual
//! fields through handler chains.

use crate::config::Config;
use crate::doc::registry::DocRegistry;
use crate::projects::client::ProjectsClient;

pub struct AppState {
    pub config: Config,
    pub registry: DocRegistry,
    pub projects_client: ProjectsClient,
}

impl AppState {
    pub fn new(config: Config) -> Self {
        Self {
            projects_client: ProjectsClient::new(&config.projects_service_url),
            registry: DocRegistry::new(),
            config,
        }
    }
}