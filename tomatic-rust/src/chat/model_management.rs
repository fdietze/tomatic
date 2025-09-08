use leptos::prelude::*;
use crate::combobox::ComboboxItem;
use crate::llm::DisplayModelInfo;

pub struct ModelManager {
    pub items: Memo<Vec<ComboboxItem>>,
    pub external_error: Memo<Option<String>>,
}

impl ModelManager {
    pub fn new(
        cached_models: Signal<Vec<DisplayModelInfo>>,
        models_loading: ReadSignal<bool>,
        models_error: ReadSignal<Option<String>>,
        api_key: Signal<String>,
    ) -> Self {
        let items = Memo::new(move |_| {
            cached_models
                .get()
                .into_iter()
                .map(|model_info| {
                    let (display_text, display_html) = if let (Some(prompt_cost), Some(completion_cost)) = (
                        model_info.prompt_cost_usd_pm,
                        model_info.completion_cost_usd_pm,
                    ) {
                        let price_display =
                            format!("in: {prompt_cost: >6.2}$ out: {completion_cost: >6.2}$/MTok");

                        let text = format!("{} {}", model_info.name, price_display);
                        let html = format!(
                            "<div style='display: flex; justify-content: space-between; align-items: center; width: 100%; gap: 1em;'>\n                                <span style='white-space: nowrap; flex-shrink: 0'>{}</span>\n                                <span class='model-price' style='white-space: pre; text-align: right; overflow: hidden; flex-shrink: 1'>{}</span>\n                            </div>",
                            model_info.name,
                            &price_display
                        );
                        (text, Some(html))
                    } else {
                        let text = format!("{} (ID: {})", model_info.name, model_info.id);
                        (text, None)
                    };
                    ComboboxItem {
                        id: model_info.id.clone(),
                        display_text,
                        display_html,
                    }
                })
                .collect::<Vec<ComboboxItem>>()
        });

        let external_error = Memo::new(move |_| {
            if api_key.get().is_empty() {
                Some("API key required in Settings to use models.".to_string())
            } else if let Some(e) = models_error.get() {
                Some(format!("Failed to load models: {e}"))
            } else if cached_models.get().is_empty() && !models_loading.get() {
                Some("No models found. Try reloading.".to_string())
            } else {
                None
            }
        });

        Self { items, external_error }
    }
}