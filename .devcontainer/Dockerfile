FROM mcr.microsoft.com/devcontainers/rust:1-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    clang \
    curl \
    git \
    lld \
    libssl-dev \
    pkg-config \
    postgresql-client \
    unzip \
  && rm -rf /var/lib/apt/lists/*

# Ensure rustfmt and clippy are available for rust-analyzer and cargo checks
RUN rustup component add rustfmt clippy

# Pre-create volume mount directories owned by vscode
RUN mkdir -p /workspaces/sleek/node_modules /workspaces/sleek/native/target /usr/local/cargo/registry \
  && chown -R vscode:vscode /workspaces/sleek /usr/local/cargo/registry

USER vscode

# Install Bun for the vscode user
ENV BUN_INSTALL="/home/vscode/.bun"
ENV PATH="${BUN_INSTALL}/bin:${PATH}"
RUN curl -fsSL https://bun.sh/install | bash
