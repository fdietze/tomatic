{
  description = "tomatic dev environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    # Pinned nixpkgs containing playwright-driver 1.54.1 (must match @playwright/test in package.json).
    # https://www.nixhub.io/packages/playwright
    playwright-nixpkgs.url = "github:nixos/nixpkgs/648f70160c03151bc2121d179291337ad6bc564b";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, playwright-nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        playwrightPkgs = import playwright-nixpkgs { inherit system; };
        playwrightBrowsers = playwrightPkgs.playwright-driver.browsers;
      in
      {
        devShells.default = pkgs.mkShell {
          packages = [
            pkgs.nodejs_24
            pkgs.pnpm
            pkgs.just
            pkgs.oxlint
            pkgs.typescript-go
            playwrightBrowsers
          ];

          shellHook = ''
            export PLAYWRIGHT_BROWSERS_PATH=${playwrightBrowsers}
            export PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=true
            pnpm install
          '';
        };
      });
}
