use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use crate::models::{RunningAction, VideoEntry};

/// Cached result from a video list scan.
struct CachedVideoList {
    videos: Vec<VideoEntry>,
    created: Instant,
}

pub struct AppState {
    /// Project root directory (contains src/, outputs/, configs/)
    pub root: PathBuf,
    /// Path to the `tiles` CLI binary
    pub tiles_bin: PathBuf,
    /// Active actions currently running
    pub running_actions: Arc<Mutex<Vec<RunningAction>>>,
    /// Cache for video list scans, keyed by (project, search)
    video_cache: Mutex<HashMap<(Option<String>, Option<String>), CachedVideoList>>,
}

/// How long cached video lists remain valid.
const VIDEO_CACHE_TTL_SECS: u64 = 30;

impl AppState {
    pub fn new(root: PathBuf, tiles_bin: PathBuf) -> Self {
        Self {
            root,
            tiles_bin,
            running_actions: Arc::new(Mutex::new(Vec::new())),
            video_cache: Mutex::new(HashMap::new()),
        }
    }

    /// Get cached video list or compute it.
    pub fn get_videos(
        &self,
        project: Option<&str>,
        search: Option<&str>,
    ) -> Vec<VideoEntry> {
        let key = (project.map(String::from), search.map(String::from));
        {
            if let Ok(cache) = self.video_cache.lock() {
                if let Some(entry) = cache.get(&key) {
                    if entry.created.elapsed().as_secs() < VIDEO_CACHE_TTL_SECS {
                        return entry.videos.clone();
                    }
                }
            }
        }

        let videos =
            crate::services::fs_scanner::list_videos(&self.root, project, search);

        if let Ok(mut cache) = self.video_cache.lock() {
            cache.insert(
                key,
                CachedVideoList {
                    videos: videos.clone(),
                    created: Instant::now(),
                },
            );
        }

        videos
    }

    /// Invalidate all cached video lists (call after mutations).
    pub fn invalidate_video_cache(&self) {
        if let Ok(mut cache) = self.video_cache.lock() {
            cache.clear();
        }
    }
}
