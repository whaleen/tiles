use base64::Engine;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::State;
use tokio::time::{sleep, Duration, Instant};

use crate::prefs::read_prefs;
use crate::state::AppState;

#[derive(Serialize)]
struct FluxImg2ImgRequest {
    key: String,
    model_id: String,
    prompt: String,
    init_image: String,
    strength: f32,
    width: u32,
    height: u32,
    num_inference_steps: u32,
    guidance_scale: f32,
    samples: u32,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct FluxImg2ImgResponse {
    pub status: String,
    pub output: Option<Vec<String>>,
    pub message: Option<String>,
    pub fetch_result: Option<String>,
}

#[tauri::command]
pub async fn flux_img2img(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    image_rel_path: String,
    prompt: String,
    strength: f32,
    width: u32,
    height: u32,
    output_folder: String,
) -> Result<FluxImg2ImgResponse, String> {
    if image_rel_path.contains("..") || std::path::Path::new(&image_rel_path).is_absolute() {
        return Err("invalid image path".to_string());
    }
    if output_folder.contains("..") || std::path::Path::new(&output_folder).is_absolute() {
        return Err("invalid output folder".to_string());
    }

    let key = read_prefs(&app)
        .provider_key("modelslab")
        .ok_or_else(|| "ModelsLab API key not set. Go to Settings to add it.".to_string())?;

    let root = state.root.read().unwrap().clone();
    let image_path = root.join("src").join(&image_rel_path);
    if !image_path.is_file() {
        return Err("image not found".to_string());
    }

    let image_bytes = std::fs::read(&image_path).map_err(|e| e.to_string())?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(image_bytes);
    let ext = image_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("jpeg")
        .to_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => "image/jpeg",
    };
    let data_uri = format!("data:{mime};base64,{encoded}");

    let client = Client::new();
    let mut resp = client
        .post("https://modelslab.com/api/v6/realtime/img2img")
        .json(&FluxImg2ImgRequest {
            key,
            model_id: "flux".to_string(),
            prompt,
            init_image: data_uri,
            strength: strength.clamp(0.0, 1.0),
            width,
            height,
            num_inference_steps: 20,
            guidance_scale: 7.5,
            samples: 1,
        })
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<FluxImg2ImgResponse>()
        .await
        .map_err(|e| e.to_string())?;

    if resp.output.is_none() {
        if let Some(fetch_url) = resp.fetch_result.clone() {
            resp = poll_flux_result(&client, &fetch_url).await?;
        }
    }

    if resp.status == "success" {
        if let Some(urls) = &resp.output {
            let dest = root.join(&output_folder);
            std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
            for (i, url) in urls.iter().enumerate() {
                let bytes = client
                    .get(url)
                    .send()
                    .await
                    .map_err(|e| e.to_string())?
                    .bytes()
                    .await
                    .map_err(|e| e.to_string())?;
                let fname = format!("flux-img2img-{i}.jpg");
                std::fs::write(dest.join(fname), &bytes).map_err(|e| e.to_string())?;
            }
        }
        state.invalidate_video_cache();
    }

    Ok(resp)
}

async fn poll_flux_result(client: &Client, url: &str) -> Result<FluxImg2ImgResponse, String> {
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        if Instant::now() >= deadline {
            return Err("ModelsLab result polling timed out".to_string());
        }
        sleep(Duration::from_secs(2)).await;
        let resp = client
            .get(url)
            .send()
            .await
            .map_err(|e| e.to_string())?
            .json::<FluxImg2ImgResponse>()
            .await
            .map_err(|e| e.to_string())?;
        if matches!(resp.status.as_str(), "success" | "failed" | "error") {
            return Ok(resp);
        }
    }
}
