use crate::chat::types::SystemPrompt;

pub fn extract_mentioned_prompt(input: &str, system_prompts: &[SystemPrompt]) -> Option<SystemPrompt> {
    input
        .split_whitespace()
        .filter_map(|word| {
            if let Some(name) = word.strip_prefix('@') {
                let name = name.trim_matches(|c: char| !c.is_alphanumeric());
                system_prompts.iter().find(|sp| sp.name == name).cloned()
            } else {
                None
            }
        })
        .next()
}