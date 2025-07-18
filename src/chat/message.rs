use crate::copy_button::CopyButton;
use crate::markdown::Markdown;
use leptos::ev::KeyboardEvent;
use leptos::prelude::*;
use std::sync::Arc;

use super::types::Message;

#[component]
pub fn ChatMessage(
    #[prop(into)] message: Message,
    #[prop(into)] set_messages: WriteSignal<Vec<Message>>,
    #[prop(into)] message_index: usize,
    regenerate: Arc<impl Fn(usize) + std::marker::Send + std::marker::Sync + 'static>,
) -> impl IntoView {
    let (is_editing, set_is_editing) = signal(false);
    let (input, set_input) = signal(message.content.clone());

    let handle_resubmit = {
        let regenerate = regenerate.clone();
        let message = message.clone();
        move || {
            set_messages.update(|ms| {
                ms[message_index] = Message {
                    content: input.get(),
                    ..message.clone()
                };
            });
            set_is_editing(false);
            regenerate(message_index + 1);
        }
    };

    let regenerate = regenerate.clone();
    let m_clone_for_copy = message.clone();
    let text_for_copy_button = Signal::derive(move || {
        if is_editing.get() {
            input.get()
        } else {
            m_clone_for_copy.content.clone()
        }
    });
    let role = message.role.clone();
    let message_for_cost = message.clone();
    view! {
        <chat-message data-role=role>
            <div style="display: flex">
                <chat-message-role>
                    {match message.role.as_str() {
                        "assistant" => {
                            if let Some(model) = &message.model_name {
                                format!("assistant ({model})")
                            } else {
                                "assistant".to_string()
                            }
                        }
                        "system" => {
                            if let Some(name) = &message.prompt_name {
                                format!("system @{name}")
                            } else {
                                "system".to_string()
                            }
                        }
                        _ => message.role.clone(),
                    }}
                </chat-message-role>
                <chat-message-buttons>
                    <CopyButton text_to_copy=text_for_copy_button />
                    {
                        let regenerate = regenerate.clone();
                        let message = message.clone();
                        move || {
                            let regenerate = regenerate.clone();
                            if message.role.clone() == "assistant" {
                                view! {
                                    <button
                                        data-size="compact"
                                        on:click=move |_| { regenerate(message_index) }
                                    >
                                        "regenerate"
                                    </button>
                                }
                                    .into_any()
                            } else if message.role.clone() == "user" {
                                view! {
                                    <button
                                        data-size="compact"
                                        on:click=move |_| {
                                            set_is_editing(!is_editing());
                                        }
                                    >
                                        "edit"
                                    </button>
                                }
                                    .into_any()
                            } else {
                                ().into_any()
                            }
                        }
                    }
                </chat-message-buttons>
            </div>
            <chat-message-content>
                {move || {
                    if is_editing() {
                        let handle_resubmit_for_textarea = handle_resubmit.clone();
                        let handle_resubmit_for_button = handle_resubmit.clone();
                        view! {
                            <textarea
                                style="width: 100%"
                                prop:value=input
                                on:input:target=move |ev| { set_input(ev.target().value()) }
                                on:keydown=move |ev: KeyboardEvent| {
                                    if ev.key() == "Enter" && !ev.shift_key() {
                                        ev.prevent_default();
                                        handle_resubmit_for_textarea();
                                    }
                                }
                            />
                            <div style="display:flex; justify-content: flex-end; gap: 4px;">
                                <button
                                    data-role="secondary"
                                    style="margin-left:auto;"
                                    on:click={
                                        let message = message.clone();
                                        move |_| {
                                            set_input(message.content.clone());
                                            set_is_editing(false);
                                        }
                                    }
                                >
                                    "Discard"
                                </button>
                                <button on:click=move |_| {
                                    handle_resubmit_for_button()
                                }>"Re-submit"</button>
                            </div>
                        }
                            .into_any()
                    } else {
                        let content = message.content.clone();
                        view! { <Markdown markdown_text=content /> }.into_any()
                    }
                }}
            </chat-message-content>
            {move || {
                message_for_cost
                    .cost
                    .map(|cost| {
                        view! {
                            <chat-message-cost style="text-align: right; font-size: 0.8em; opacity: 0.6; margin-top: 4px;">
                                {format!(
                                    "prompt: ${:.6}, completion: ${:.6}, total: ${:.6}",
                                    cost.prompt,
                                    cost.completion,
                                    cost.prompt + cost.completion,
                                )}
                            </chat-message-cost>
                        }
                    })
            }}
        </chat-message>
    }
}