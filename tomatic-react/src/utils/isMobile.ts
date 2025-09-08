export function isMobile(): boolean {
  // Use the modern, reliable userAgentData API if available
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nav = navigator as any;
  if (nav.userAgentData && typeof nav.userAgentData.mobile !== 'undefined') {
    return nav.userAgentData.mobile;
  }

  // Fallback to checking for touch events, a strong indicator of mobile
  const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  if (hasTouch) return true;

  // As a final check, use media queries to detect coarse pointer devices (like fingers)
  return window.matchMedia('(pointer: coarse)').matches;
}
