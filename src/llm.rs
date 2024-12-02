use reqwest::Client;
use schemars::{schema_for, JsonSchema};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
pub struct ResponseFormat {
    #[serde(rename = "type")]
    pub type_: String,
    pub json_schema: ResponseSchema,
}

impl ResponseFormat {
    pub fn json_schema(schema: schemars::schema::RootSchema) -> Self {
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

#[derive(Debug, Serialize)]
pub struct Request {
    pub model: String,
    pub messages: Vec<Message>,
    pub response_format: Option<ResponseFormat>,
    pub seed: Option<i64>,
    pub temperature: Option<f64>,
    pub top_p: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[allow(unused)]
pub struct Response {
    pub id: String,
    pub created: i32,
    pub model: String,
    pub choices: Vec<Choice>,
}

#[derive(Debug, Deserialize)]
pub struct Choice {
    pub message: Message,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Message {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone)]
pub struct MessageHistory {
    pub messages: Vec<Message>,
}

#[allow(unused)]
impl MessageHistory {
    pub fn last(&self) -> String {
        self.messages.last().unwrap().content.clone()
    }
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

#[allow(unused)]
pub async fn request<T: for<'de> Deserialize<'de> + JsonSchema>(
    messages: Vec<Message>,
) -> anyhow::Result<T> {
    let api_key = std::env::var("OPENAI_API_KEY").expect("No OPENAI_API_KEY found");
    let url = "https://api.openai.com/v1/chat/completions";
    let request = Request {
        model: "gpt-4o".to_string(),
        seed: Some(42),
        top_p: Some(0.000000001),
        temperature: Some(0.0),
        messages,
        response_format: Some(ResponseFormat::json_schema(schema_for!(T))),
    };
    // println!(
    //     "schema: {}",
    //     serde_json::to_string_pretty(&schema_for!(T)).unwrap()
    // );
    let client = Client::new();
    let response = client
        .post(url)
        .bearer_auth(api_key)
        .json(&request)
        .send()
        .await?;

    let response_text = response.text().await?;
    // println!("{response_text}");
    // Try to deserialize into the intended structure
    match serde_json::from_str::<Response>(&response_text) {
        Ok(parsed_response) => {
            let content = &parsed_response
                .choices
                .first()
                .ok_or_else(|| anyhow::Error::msg("No choices found"))?
                .message
                .content;
            let result: T = serde_json::from_str(content)?;
            Ok(result)
        }
        Err(_) => {
            // If deserialization into Response fails, try to deserialize into ErrorResponse
            if let Ok(error_response) = serde_json::from_str::<ErrorResponse>(&response_text) {
                Err(anyhow::anyhow!(error_response.error.message))
            } else {
                Err(anyhow::anyhow!("Unknown error occurred"))
            }
        }
    }
}

#[allow(unused)]
pub async fn request_str(messages: Vec<Message>, api_key: String) -> anyhow::Result<String> {
    let url = "https://api.openai.com/v1/chat/completions";
    let request = Request {
        model: "gpt-4o".to_string(),
        seed: Some(42),
        top_p: Some(0.000000001),
        temperature: Some(0.0),
        messages,
        response_format: None, // text
    };
    let client = Client::new();
    let response = client
        .post(url)
        .bearer_auth(api_key)
        .json(&request)
        .send()
        .await?;
    let response_text = response.text().await?;

    match serde_json::from_str::<Response>(&response_text) {
        Ok(parsed_response) => {
            let content = &parsed_response
                .choices
                .first()
                .ok_or_else(|| anyhow::Error::msg("No choices found"))?
                .message
                .content;
            Ok(content.to_string())
        }
        Err(_) => {
            // If deserialization into Response fails, try to deserialize into ErrorResponse
            if let Ok(error_response) = serde_json::from_str::<ErrorResponse>(&response_text) {
                Err(anyhow::anyhow!(error_response.error.message))
            } else {
                Err(anyhow::anyhow!("Unknown error occurred"))
            }
        }
    }
}

#[allow(unused)]
pub async fn single_shot_str(prompt: String, api_key: String) -> anyhow::Result<String> {
    request_str(
        vec![Message {
            role: "user".to_string(),
            content: prompt,
        }],
        api_key,
    )
    .await
}

#[allow(unused)]
pub async fn single_shot<T: for<'de> Deserialize<'de> + JsonSchema>(
    prompt: String,
) -> anyhow::Result<T> {
    request(vec![Message {
        role: "user".to_string(),
        content: prompt,
    }])
    .await
}

#[allow(unused)]
pub async fn chain_of_thought_str(
    steps: Vec<String>,
    api_key: String,
) -> anyhow::Result<MessageHistory> {
    let mut messages: Vec<Message> = vec![];
    for step in steps {
        messages.push(Message {
            role: "user".to_string(),
            content: step.to_string(),
        });
        // println!("\n> {step}");
        let result = request_str(messages.clone(), api_key.clone()).await?;
        println!("\n{result}\n---\n");
        messages.push(Message {
            role: "assistant".to_string(),
            content: result.to_string(),
        });
    }
    Ok(MessageHistory { messages })
}

#[allow(unused)]
pub async fn chain_of_thought<T: for<'de> Deserialize<'de> + JsonSchema>(
    steps: Vec<String>,
    api_key: String,
) -> anyhow::Result<T> {
    let mut messages: Vec<Message> = vec![];
    for step in &steps[..steps.len() - 1] {
        messages.push(Message {
            role: "user".to_string(),
            content: step.to_string(),
        });
        // println!("\n> {step}");
        let result = request_str(messages.clone(), api_key.clone()).await?;
        println!("\n{result}");
        messages.push(Message {
            role: "assistant".to_string(),
            content: result.to_string(),
        });
    }
    let step = steps.last().unwrap();
    // last step has  structured output
    messages.push(Message {
        role: "user".to_string(),
        content: step.to_string(),
    });
    // println!("\n> {step}");
    let structured_output = request::<T>(messages).await?;
    Ok(structured_output)
}
