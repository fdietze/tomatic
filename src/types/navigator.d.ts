interface NavigatorUAData {
  readonly brands: readonly { brand: string; version: string }[];
  readonly mobile: boolean;
  readonly platform: string;
}

declare global {
  interface Navigator {
    readonly userAgentData?: NavigatorUAData;
  }
}
