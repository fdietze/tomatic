interface NavigatorUAData {
  readonly brands: readonly { brand: string; version: string }[];
  readonly mobile: boolean;
  readonly platform: string;
}

declare global {
  interface Navigator {
    readonly userAgentData?: NavigatorUAData;
  }
  interface Window {
		__IS_TESTING__?: boolean;
	}
}

export {};
