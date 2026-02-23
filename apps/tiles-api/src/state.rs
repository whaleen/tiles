use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use crate::models::RunningAction;

#[derive(Clone)]
pub struct AppState {
    /// Project root directory (contains src/, outputs/, configs/)
    pub root: PathBuf,
    /// Path to the `tiles` CLI binary
    pub tiles_bin: PathBuf,
    /// Active actions currently running
    pub running_actions: Arc<Mutex<Vec<RunningAction>>>,
}

impl AppState {
    pub fn new(root: PathBuf, tiles_bin: PathBuf) -> Self {
        Self {
            root,
            tiles_bin,
            running_actions: Arc::new(Mutex::new(Vec::new())),
        }
    }
}
