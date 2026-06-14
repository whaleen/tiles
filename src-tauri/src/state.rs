use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};
use std::time::Instant;

use crate::models::{RunningAction, VideoEntry};

/// Cached result from a video list scan.
type VideoCacheKey = (Option<String>, Option<String>, Option<String>, Option<bool>);

struct CachedVideoList {
    videos: Vec<VideoEntry>,
    created: Instant,
}

pub struct AppState {
    /// Project root directory (contains src/, outputs/, configs/)
    pub root: Arc<RwLock<PathBuf>>,
    /// Path to the `tiles` CLI binary
    pub tiles_bin: PathBuf,
    /// Active actions currently running
    pub running_actions: Arc<Mutex<Vec<RunningAction>>>,
    /// Cache for video list scans, keyed by (project, search, folder, recursive)
    video_cache: Mutex<HashMap<VideoCacheKey, CachedVideoList>>,
    /// Per-file ffprobe duration cache, keyed by src-relative path -> (mtime, seconds).
    /// Probed once per file (re-probed only if mtime changes); not TTL'd.
    duration_cache: Mutex<HashMap<String, (u64, Option<f64>)>>,
}

/// How long cached video lists remain valid.
const VIDEO_CACHE_TTL_SECS: u64 = 300;

impl AppState {
    pub fn new(root: Arc<RwLock<PathBuf>>, tiles_bin: PathBuf) -> Self {
        Self {
            root,
            tiles_bin,
            running_actions: Arc::new(Mutex::new(Vec::new())),
            video_cache: Mutex::new(HashMap::new()),
            duration_cache: Mutex::new(HashMap::new()),
        }
    }

    /// Real durations (seconds) for the given src-relative video paths. Probed
    /// lazily via ffprobe and cached per file by mtime, so callers (timeline,
    /// library) get one source of truth without eagerly probing whole folders.
    pub fn get_durations(&self, rel_paths: &[String]) -> Vec<Option<f64>> {
        let root = self.root.read().unwrap().clone();
        let src = root.join("src");
        rel_paths
            .iter()
            .map(|rel| {
                if rel.contains("..") || std::path::Path::new(rel).is_absolute() {
                    return None;
                }
                let full = src.join(rel);
                let mtime = std::fs::metadata(&full)
                    .and_then(|m| m.modified())
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                if let Ok(cache) = self.duration_cache.lock() {
                    if let Some((cached_mtime, dur)) = cache.get(rel) {
                        if *cached_mtime == mtime {
                            return *dur;
                        }
                    }
                }
                let dur = crate::services::ffprobe::get_video_duration(&full, &root);
                if let Ok(mut cache) = self.duration_cache.lock() {
                    cache.insert(rel.clone(), (mtime, dur));
                }
                dur
            })
            .collect()
    }

    /// Get cached video list or compute it.
    pub fn get_videos(
        &self,
        project: Option<&str>,
        search: Option<&str>,
        folder: Option<&str>,
        recursive: Option<bool>,
    ) -> Vec<VideoEntry> {
        let root = self.root.read().unwrap().clone();
        let key = (
            project.map(String::from),
            search.map(String::from),
            folder.map(String::from),
            recursive,
        );
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
            crate::services::fs_scanner::list_videos(&root, project, search, folder, recursive);

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
