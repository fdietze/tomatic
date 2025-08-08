use super::types::{Message, MessageCost, SystemPrompt};
use crate::llm::{self, DisplayModelInfo, StreamedMessage};
use futures::{pin_mut, select, FutureExt, StreamExt};
use futures_channel::oneshot;
use leptos::logging::log;
use leptos::prelude::*;

pub async fn handle_llm_request(
    messages_to_submit: Vec<Message>,
    model: llm::Model,
    api_key: String,
    set_messages: WriteSignal<Vec<Message>>,
    set_error: WriteSignal<Option<String>>,
    cached_models: Signal<Vec<DisplayModelInfo>>,
    current_model_name: String,
    selected_prompt: Memo<Option<SystemPrompt>>,
    mut cancel_receiver: oneshot::Receiver<()>,
) {
    let response_message = Message {
        role: "assistant".to_string(),
        content: String::new(),
        prompt_name: selected_prompt.get().map(|sp| sp.name.clone()),
        system_prompt_content: selected_prompt.get().map(|sp| sp.prompt.clone()),
        model_name: Some(current_model_name.clone()),
        cost: None,
    };
    set_messages.update(|m| m.push(response_message));

    match llm::request_message_content_streamed(
        messages_to_submit.iter().map(|m| m.to_llm()).collect(),
        model,
        api_key,
    )
    .await
    {
        Ok(stream) => {
            let mut accumulated_content = String::new();
            pin_mut!(stream);

            let mut buffer = String::new();
            let mut last_update_time: Option<f64> = None;
            const THROTTLE_MS: f64 = 200.0;
            let performance = window()
                .performance()
                .expect("performance should be available");

            loop {
                select! {
                    _ = cancel_receiver => {
                        log!("[INFO] LLM request cancelled by user.");
                        set_messages.update(|m| {
                            m.pop(); // Remove the empty/partial assistant message
                        });
                        return;
                    },
                    chunk_result = stream.next().fuse() => {
                        if let Some(chunk_result) = chunk_result {
                             match chunk_result {
                                Ok(streamed_message) => match streamed_message {
                                    StreamedMessage::Content(content) => {
                                        buffer.push_str(&content);
                                        let now = performance.now();
                                        let should_update = if let Some(last_time) = last_update_time {
                                            now - last_time > THROTTLE_MS
                                        } else {
                                            true // First chunk, update immediately
                                        };

                                        if should_update {
                                            accumulated_content.push_str(&buffer);
                                            buffer.clear();
                                            set_messages.update(|m| {
                                                if let Some(last) = m.last_mut() {
                                                    last.content = accumulated_content.clone();
                                                }
                                            });
                                            last_update_time = Some(now);
                                        }
                                    }
                                    StreamedMessage::Usage(usage) => {
                                        if !buffer.is_empty() {
                                            accumulated_content.push_str(&buffer);
                                            buffer.clear();
                                            set_messages.update(|m| {
                                                if let Some(last) = m.last_mut() {
                                                    last.content = accumulated_content.clone();
                                                }
                                            });
                                        }

                                        let model_info = cached_models
                                            .get()
                                            .into_iter()
                                            .find(|m| m.id == current_model_name);
                                        if let Some(model_info) = model_info {
                                            let prompt_cost =
                                                model_info.prompt_cost_usd_pm.unwrap_or(0.0)
                                                    * usage.prompt_tokens as f64
                                                    / 1_000_000.0;
                                            let completion_cost = model_info
                                                .completion_cost_usd_pm
                                                .unwrap_or(0.0)
                                                * usage.completion_tokens as f64
                                                / 1_000_000.0;
                                            set_messages.update(|m| {
                                                if let Some(last) = m.last_mut() {
                                                    last.cost = Some(MessageCost {
                                                        prompt: prompt_cost,
                                                        completion: completion_cost,
                                                    });
                                                }
                                            });
                                        }
                                    }
                                },
                                Err(err) => {
                                    set_error.set(Some(err.to_string()));
                                    set_messages.update(|m| {
                                        m.pop();
                                    });
                                    return;
                                }
                            }
                        } else {
                            // Stream finished
                            break;
                        }
                    }
                }
            }

            if !buffer.is_empty() {
                accumulated_content.push_str(&buffer);
                set_messages.update(|m| {
                    if let Some(last) = m.last_mut() {
                        last.content = accumulated_content.clone();
                    }
                });
            }
        }
        Err(err) => {
            set_error.set(Some(err.to_string()));
            set_messages.update(|m| {
                m.pop();
            });
        }
    }
}
