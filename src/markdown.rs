use leptos::{html, prelude::*};

use crate::dom_utils;

#[component]
pub fn Markdown(#[prop(into)] markdown_text: String) -> impl IntoView {
    let markdown_options = markdown::Options {
        parse: markdown::ParseOptions {
            constructs: markdown::Constructs {
                math_flow: true,
                math_text: true,
                ..markdown::Constructs::gfm()
            },
            ..markdown::ParseOptions::default()
        },
        compile: markdown::CompileOptions {
            allow_dangerous_html: true,
            allow_dangerous_protocol: true,
            ..markdown::CompileOptions::default()
        },
    };

    let content_div_ref = NodeRef::<html::Div>::new();

    Effect::new(move |_| {
        if let Some(div_element) = content_div_ref.get() {
            let html_output = markdown::to_html_with_options(&markdown_text, &markdown_options)
                .unwrap_or_else(|_| markdown_text.clone());

            dom_utils::set_html_content_with_copy_buttons(&div_element, &html_output);
        }
    });

    view! { <div node_ref=content_div_ref></div> }
}
