FROM node:22-bookworm

RUN apt-get update && apt-get install -y \
    curl \
    git \
    sudo \
    vim \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set up workspace
RUN mkdir -p /workspace
WORKDIR /workspace

# Switch to non-root user
USER node
