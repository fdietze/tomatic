#![feature(async_closure)]

mod chat;
mod llm;
mod settings;

use std::str::FromStr;
use codee::string::JsonSerdeCodec;
use leptos::{prelude::*, web_sys};
use leptos_use::storage::use_local_storage;
use serde::{Deserialize, Serialize};
use leptos::wasm_bindgen::JsCast;
use web_sys::js_sys::Reflect;
use strum::{EnumString, Display};

fn main() {
    console_error_panic_hook::set_once();
    mount_to_body(App);
}

#[derive(Debug, Copy, Clone, Serialize, Deserialize, PartialEq, Default, EnumString, Display)]
#[strum(serialize_all = "lowercase")]
enum Page {
    #[default]
    Chat,
    Settings,
}

#[component]
fn App() -> impl IntoView {
    let (page, set_page, _) = use_local_storage::<Page, JsonSerdeCodec>("page");

    let handle_tab_switch = move |ev: leptos::ev::CustomEvent| {
        let panel_name = Reflect::get(&ev.detail(), &"name".into()).unwrap().as_string().unwrap();
        let new_page = Page::from_str(&panel_name).unwrap_or(Page::Chat);
        set_page(new_page);
    };

    view! {
        <sl-tab-group on:sl-tab-show=handle_tab_switch id="navigation-tab-group">
            <sl-tab slot="nav" panel={Page::Chat.to_string()} active={page() == Page::Chat}>
                Chat
            </sl-tab>
            <sl-tab slot="nav" panel={Page::Settings.to_string()} active={page() == Page::Settings}>
                Settings
            </sl-tab>

            <sl-tab-panel name={Page::Chat.to_string()}>
                    <Show when=move || page() == Page::Chat>
                        <chat::ChatInterface />
                    </Show>
            </sl-tab-panel>
            <sl-tab-panel name={Page::Settings.to_string()}>
                    <Show when=move || page() == Page::Settings>
                        <settings::Settings />
                    </Show>
            </sl-tab-panel>
        </sl-tab-group>
    }
}
