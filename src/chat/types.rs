use crate::llm;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct SystemPrompt {
    pub name: String,
    pub prompt: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct MessageCost {
    pub prompt: f64,
    pub completion: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Message {
    pub prompt_name: Option<String>,
    pub role: String,
    pub content: String,
    pub model_name: Option<String>,
    pub cost: Option<MessageCost>,
}

impl Message {
    pub fn to_llm(&self) -> llm::Message {
        llm::Message {
            role: self.role.clone(),
            content: self.content.clone(),
        }
    }
}