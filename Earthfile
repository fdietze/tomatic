# https://docs.earthly.dev/basics

VERSION 0.8

devbox:
  FROM jetpackio/devbox:latest
  # code generated using `devbox generate dockerfile`:
  # Installing your devbox project
  WORKDIR /code
  USER root:root
  RUN mkdir -p /code && chown ${DEVBOX_USER}:${DEVBOX_USER} /code
  USER ${DEVBOX_USER}:${DEVBOX_USER}
  COPY --chown=${DEVBOX_USER}:${DEVBOX_USER} devbox.json devbox.lock .
  RUN devbox run -- echo "Installed Packages."
  RUN find / \( -type f -o -type d \) -mindepth 1 -maxdepth 1 -print0 | xargs -0 du -sh | sort -hr | head -20 \
   && find /nix/store \( -type f -o -type d \) -mindepth 1 -maxdepth 1 -print0 | xargs -0 du -sh | sort -hr | head -20 

rustup:
  FROM +devbox
  COPY rust-toolchain.toml Cargo.toml Cargo.lock .
  RUN devbox run -- cargo fetch

cargo-chef-planner:
  FROM +rustup
  COPY rust-toolchain.toml Cargo.toml Cargo.lock .
  RUN devbox run -- cargo chef prepare --recipe-path recipe.json
  SAVE ARTIFACT recipe.json

build:
  FROM +rustup
  COPY rust-toolchain.toml Cargo.toml Cargo.lock .
  COPY +cargo-chef-planner/recipe.json recipe.json
  RUN devbox run -- cargo chef cook --target wasm32-unknown-unknown --recipe-path recipe.json
  COPY Cargo.toml . # cargo chef cook overwrites Cargo.toml, which seems to confuse trunk
  COPY --dir src css index.html site.webmanifest Trunk.toml .
  RUN devbox run -- trunk build --skip-version-check
  RUN ls -lh dist

release:
  BUILD +ci-test
  FROM +rustup
  COPY rust-toolchain.toml Cargo.toml Cargo.lock .
  COPY +cargo-chef-planner/recipe.json recipe.json
  RUN devbox run -- cargo chef cook --target wasm32-unknown-unknown --release --recipe-path recipe.json
  COPY Cargo.toml . # cargo chef cook overwrites Cargo.toml, which seems to confuse trunk
  COPY --dir src css index.html site.webmanifest Trunk.toml .
  RUN devbox run -- trunk build --release --minify --skip-version-check
  RUN ls -lh dist
  SAVE ARTIFACT dist

check-formatting:
  FROM +rustup
  COPY --dir src .
  RUN devbox run -- leptosfmt --check src

lint:
  FROM +build
  CACHE --chmod 0777 target
  COPY --dir src .
  RUN devbox run -- cargo clippy --all-targets --all-features -- -D warnings

ci-test:
  BUILD +check-formatting
  BUILD +lint
  BUILD +build
