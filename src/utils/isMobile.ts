function hasUserAgentData(navigator: Navigator): navigator is Navigator & { userAgentData: { mobile: boolean } } {
  const uaData = (navigator as { userAgentData?: { mobile?: unknown } }).userAgentData;
  return typeof uaData?.mobile === 'boolean';
}

export function isMobile(): boolean {
  // Use the modern, reliable userAgentData API if available
  if (hasUserAgentData(navigator)) {
    return navigator.userAgentData.mobile;
  }

  // Fallback to checking for touch events, a strong indicator of mobile
  const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  if (hasTouch) return true;

  // As a final check, use media queries to detect coarse pointer devices (like fingers)
  return window.matchMedia('(pointer: coarse)').matches;
}
