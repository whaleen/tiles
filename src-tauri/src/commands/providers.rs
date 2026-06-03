//! Provider / capability descriptors — the single source of truth for the
//! AI-actions UI. Settings, action gating, forms, and payload preview all
//! render from `list_providers`.
//!
//! Capabilities are generic verbs (e.g. `image-edit`); providers and models are
//! configuration. Declared here from each provider's docs — no API calls. Only
//! ModelsLab is declared for now; adding a provider is adding a `ProviderInfo`.

use serde::Serialize;
use serde_json::{json, Value};

#[derive(Debug, Serialize, Clone)]
pub struct ProviderInfo {
    /// Stable id used as the credential-map key and `--provider` value.
    pub id: String,
    pub label: String,
    pub docs_url: Option<String>,
    pub capabilities: Vec<CapabilityInfo>,
}

#[derive(Debug, Serialize, Clone)]
pub struct CapabilityInfo {
    /// Generic verb. This is the action name the registry/runner use.
    pub capability: String,
    pub label: String,
    pub description: String,
    /// "image" | "video" | "text"
    pub input_media: String,
    /// "image" | "video"
    pub output_media: String,
    pub models: Vec<ModelInfo>,
    pub fields: Vec<FieldInfo>,
}

#[derive(Debug, Serialize, Clone)]
pub struct ModelInfo {
    pub id: String,
    pub label: String,
    pub default: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct FieldInfo {
    pub name: String,
    pub label: String,
    /// "text" | "textarea" | "number" | "slider" | "select" | "bool"
    pub kind: String,
    /// "core" (hand-coded, always shown) | "advanced" (descriptor-driven)
    pub group: String,
    pub required: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step: Option<f64>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub options: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub help: Option<String>,
}

impl FieldInfo {
    fn base(name: &str, label: &str, kind: &str, group: &str) -> Self {
        FieldInfo {
            name: name.to_string(),
            label: label.to_string(),
            kind: kind.to_string(),
            group: group.to_string(),
            required: false,
            default: None,
            min: None,
            max: None,
            step: None,
            options: Vec::new(),
            help: None,
        }
    }

    fn required(mut self) -> Self {
        self.required = true;
        self
    }

    fn default(mut self, value: Value) -> Self {
        self.default = Some(value);
        self
    }

    fn range(mut self, min: f64, max: f64, step: f64) -> Self {
        self.min = Some(min);
        self.max = Some(max);
        self.step = Some(step);
        self
    }

    fn options(mut self, options: &[&str]) -> Self {
        self.options = options.iter().map(|s| s.to_string()).collect();
        self
    }

    fn help(mut self, help: &str) -> Self {
        self.help = Some(help.to_string());
        self
    }
}

/// All declared providers. Returned to the frontend as the AI-actions contract.
#[tauri::command]
pub fn list_providers() -> Vec<ProviderInfo> {
    vec![modelslab()]
}

fn modelslab() -> ProviderInfo {
    ProviderInfo {
        id: "modelslab".to_string(),
        label: "ModelsLab".to_string(),
        docs_url: Some("https://docs.modelslab.com".to_string()),
        capabilities: vec![image_edit()],
    }
}

/// image -> image edit (img2img). The proof capability for the scaffold.
fn image_edit() -> CapabilityInfo {
    CapabilityInfo {
        capability: "image-edit".to_string(),
        label: "Edit Image".to_string(),
        description: "Edit an image from a text prompt (img2img).".to_string(),
        input_media: "image".to_string(),
        output_media: "image".to_string(),
        models: vec![ModelInfo {
            id: "flux".to_string(),
            label: "Flux".to_string(),
            default: true,
        }],
        fields: vec![
            FieldInfo::base("prompt", "Prompt", "textarea", "core")
                .required()
                .help("Describe the edit you want to make."),
            FieldInfo::base("strength", "Strength", "slider", "core")
                .default(json!(0.75))
                .range(0.1, 1.0, 0.05)
                .help("Low = subtle edit, high = strong transformation."),
            FieldInfo::base("negative_prompt", "Negative prompt", "textarea", "advanced"),
            FieldInfo::base("width", "Width", "number", "advanced")
                .default(json!(1024))
                .range(256.0, 2048.0, 8.0),
            FieldInfo::base("height", "Height", "number", "advanced")
                .default(json!(1024))
                .range(256.0, 2048.0, 8.0),
            FieldInfo::base("num_inference_steps", "Steps", "slider", "advanced")
                .default(json!(20))
                .range(1.0, 50.0, 1.0),
            FieldInfo::base("guidance_scale", "Guidance scale", "slider", "advanced")
                .default(json!(7.5))
                .range(1.0, 20.0, 0.5),
            FieldInfo::base("samples", "Samples", "number", "advanced")
                .default(json!(1))
                .range(1.0, 4.0, 1.0),
            FieldInfo::base("seed", "Seed", "text", "advanced")
                .help("Leave blank for random."),
            FieldInfo::base("output_format", "Output format", "select", "advanced")
                .default(json!("jpg"))
                .options(&["jpg", "png", "webp"]),
            FieldInfo::base("safety_checker", "Safety checker", "bool", "advanced")
                .default(json!(true)),
            FieldInfo::base("enhance_prompt", "Enhance prompt", "bool", "advanced")
                .default(json!(false)),
        ],
    }
}
