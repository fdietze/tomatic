use futures::{Stream, StreamExt};
use openrouter_api::{
    types::chat::{ChatCompletionRequest, Message as OpenRouterMessage},
    OpenRouterClient,
    // types::models::Model as OpenRouterApiModel, // Removed problematic import
};
use serde::{Deserialize, Serialize};
// schemars might not be needed if we only implement streaming for now.
// use schemars::JsonSchema;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Message {
    pub role: String,
    pub content: String,
    // Add prompt_name if you need to pass it for your internal logic,
    // but OpenRouter's Message struct doesn't have it directly.
    // prompt_name: Option<String>,
}

impl Message {
    /// Converts this application's Message to OpenRouter's Message type.
    fn to_openrouter_message(&self) -> OpenRouterMessage {
        OpenRouterMessage {
            role: self.role.clone(),
            content: self.content.clone(),
            name: None,        // OpenRouter's Message has a name field, default to None
            tool_calls: None,  // Not used in basic chat
            tool_call_id: None,
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Model {
    pub model: String,        // e.g., "openai/gpt-4o"
    pub seed: Option<i64>,    // OpenRouter might not directly support seed for all models in the same way
    pub temperature: Option<f64>,
}

pub async fn request_message_content_streamed(
    messages: Vec<Message>,
    model_config: Model,
    api_key: String,
) -> anyhow::Result<impl Stream<Item = anyhow::Result<String>>> {
    if api_key.is_empty() {
        return Err(anyhow::anyhow!("OpenRouter API key is missing."));
    }

    let client = OpenRouterClient::new()
        .with_base_url("https://openrouter.ai/api/v1/")?
        .with_timeout_secs(60) // Configure timeout before setting API key
        .with_api_key(api_key.clone())?; // API key is the final step to get a Ready client

    let openrouter_messages: Vec<OpenRouterMessage> = messages
        .into_iter()
        .map(|m| m.to_openrouter_message())
        .collect();

    let request = ChatCompletionRequest {
        model: model_config.model,
        messages: openrouter_messages,
        stream: Some(true),
        // Explicitly set other optional fields to None as ChatCompletionRequest doesn't implement Default
        response_format: None,
        tools: None,
        provider: None,
        models: None,
        transforms: None,
        // Temperature, seed, and other specific OpenAI parameters are not direct top-level fields
        // in this version of the openrouter_api ChatCompletionRequest.
        // They might be configurable via the model string (e.g., "model_name@temperature=0.7")
        // or through other mechanisms depending on the crate's API for advanced features.
        // For now, we rely on OpenRouter's defaults for these if not specified in the model string.
        };

        let chat_api = client.chat()?;
    let mut stream = chat_api.chat_completion_stream(request);

    let output_stream = async_stream::stream! {
        while let Some(chunk_result) = stream.next().await {
            match chunk_result {
                Ok(chunk) => {
                    // Process the chunk
                    // A chunk can have multiple choices, but for typical streaming, we expect one.
                    if let Some(choice) = chunk.choices.first() {
                        if let Some(content) = &choice.delta.content {
                            yield Ok(content.clone());
                        }
                    }
                    // You might also want to handle other parts of the chunk, e.g., finish_reason or usage.
                    // For now, we only care about content.
                }
                Err(e) => {
                    // Log the error or handle it as appropriate
                    eprintln!("[DEBUG] llm.rs stream error: {e:?}");
                    yield Err(anyhow::anyhow!("Error from OpenRouter stream: {}", e));
                    break; // Stop streaming on error
                }
            }
        }
    };

    Ok(output_stream)
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Default)]
pub struct DisplayModelInfo {
    pub id: String,
    pub name: String,
    pub prompt_cost_usd_pm: Option<f64>, // Cost per million prompt tokens
    pub completion_cost_usd_pm: Option<f64>, // Cost per million completion tokens
}

// Helper function to parse price string and convert to per million tokens
fn parse_price_to_per_million(price_str: &str) -> Option<f64> {
    price_str.parse::<f64>().ok().map(|p| p * 1_000_000.0)
}

pub async fn list_available_models(api_key: String) -> anyhow::Result<Vec<DisplayModelInfo>> {
    if api_key.is_empty() {
        return Err(anyhow::anyhow!("OpenRouter API key is missing."));
    }

    let client = OpenRouterClient::new()
        .with_base_url("https://openrouter.ai/api/v1/")?
        .with_timeout_secs(60)
        .with_api_key(api_key)?;

    let models_api = client.models()?;
    let open_router_model_list = models_api.list_models(None).await?;

    let model_infos: Vec<DisplayModelInfo> = open_router_model_list
        .data
        .into_iter()
        .map(|m: openrouter_api::types::models::ModelInfo| DisplayModelInfo { // Use the correct ModelInfo from the library
            id: m.id,
            name: m.name, // m.name is String, not Option<String>
            prompt_cost_usd_pm: parse_price_to_per_million(&m.pricing.prompt),
            completion_cost_usd_pm: parse_price_to_per_million(&m.pricing.completion),
        })
        .collect();

    Ok(model_infos)
}

// --- Old OpenAI specific code commented out for reference or later porting ---
/*
use reqwest::Client;
use schemars::{schema_for, JsonSchema};

#[derive(Debug, Serialize)]
pub struct OpenAIRequest {
    pub model: String,
    pub messages: Vec<Message>, // Assuming your Message struct is compatible or mapped
    pub response_format: Option<ResponseFormat>,
    pub seed: Option<i64>,
    pub temperature: Option<f64>,
    pub stream: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[allow(unused)]
pub struct OpenAIResponse {
    pub id: String,
    pub created: i32,
    pub model: String,
    pub choices: Vec<OpenAIChoice>,
}

#[derive(Debug, Deserialize)]
pub struct OpenAIChoice {
    pub message: Message, // Assuming your Message struct is compatible
}


#[derive(Debug, Deserialize)]
struct ErrorResponse {
    error: ErrorDetail,
}

#[derive(Debug, Deserialize)]
#[allow(unused)]
struct ErrorDetail {
    message: String,
    #[serde(rename = "type")]
    error_type: String,
    param: Option<String>,
    code: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ResponseFormat {
    #[serde(rename = "type")]
    pub type_: String,
    pub json_schema: ResponseSchema,
}

impl ResponseFormat {
    pub fn json_schema(schema: schemars::Schema) -> Self {
        ResponseFormat {
            type_: "json_schema".to_string(),
            json_schema: ResponseSchema {
                name: "event".to_string(),
                schema: serde_json::to_value(&schema).unwrap(),
                strict: true,
            },
        }
    }
}

#[derive(Debug, Serialize)]
pub struct ResponseSchema {
    pub name: String,
    pub schema: serde_json::Value,
    pub strict: bool,
}


impl Model {
    pub fn to_openai_request(
        &self,
        messages: Vec<Message>,
        response_format: Option<ResponseFormat>,
        stream: Option<bool>,
    ) -> OpenAIRequest {
        OpenAIRequest {
            model: self.model.clone(),
            seed: self.seed,
            temperature: self.temperature,
            messages,
            response_format,
            stream,
        }
    }
}

#[allow(unused)]
pub async fn request<T: for<'de> Deserialize<'de> + JsonSchema>(
    messages: Vec<Message>,
    model: Model,
    api_key: String,
) -> anyhow::Result<T> {
    let url = "https://api.openai.com/v1/chat/completions";
    let request_payload = model.to_openai_request(
        messages,
        Some(ResponseFormat::json_schema(schema_for!(T))),
        None,
    );
    let response = api_chat_completions(request_payload, api_key).await?;
    let content = &response
        .choices
        .first()
        .ok_or_else(|| anyhow::Error::msg("No choices found"))?
        .message
        .content;
    let result: T = serde_json::from_str(content)?;
    Ok(result)
}

#[allow(unused)]
pub async fn request_message_content_openai( // Renamed to avoid conflict if testing both
    messages: Vec<Message>,
    model: Model,
    api_key: String,
) -> anyhow::Result<String> {
    let url = "https://api.openai.com/v1/chat/completions";
    let request_payload = model.to_openai_request(messages, None, None);
    let response = api_chat_completions(request_payload, api_key).await?;
    let content = &response
        .choices
        .first()
        .ok_or_else(|| anyhow::Error::msg("No choices found"))?
        .message
        .content;
    Ok(content.to_string())
}

#[allow(unused)]
pub async fn api_chat_completions(request: OpenAIRequest, api_key: String) -> anyhow::Result<OpenAIResponse> {
    let url = "https://api.openai.com/v1/chat/completions";
    let client = Client::new();
    let response = client
        .post(url)
        .bearer_auth(api_key)
        .json(&request)
        .send()
        .await?;
    let response_text = response.text().await?;

    match serde_json::from_str::<OpenAIResponse>(&response_text) {
        Ok(parsed_response) => Ok(parsed_response),
        Err(_) => {
            if let Ok(error_response) = serde_json::from_str::<ErrorResponse>(&response_text) {
                Err(anyhow::anyhow!(error_response.error.message))
            } else {
                Err(anyhow::anyhow!("Unknown error occurred: {}", response_text))
            }
        }
    }
}

// ... other old functions like single_shot_str, single_shot, chain_of_thought_str, chain_of_thought ...
// These would need similar rewrites if they are to be kept.
*/
