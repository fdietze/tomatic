use wasm_bindgen::prelude::*;

#[wasm_bindgen(inline_js = r#"
export function is_mobile() {
  // Use the modern, reliable userAgentData API if available
  if (navigator.userAgentData && typeof navigator.userAgentData.mobile !== \'undefined\') {
    return navigator.userAgentData.mobile;
  }
  
  // Fallback to checking for touch events, a strong indicator of mobile
  const hasTouch = \'ontouchstart\' in window || navigator.maxTouchPoints > 0;
  if (hasTouch) return true;

  // As a final check, use media queries to detect coarse pointer devices (like fingers)
  return window.matchMedia("(pointer: coarse)").matches;
}
"#)]
extern "C" {
    pub fn is_mobile() -> bool;
}
