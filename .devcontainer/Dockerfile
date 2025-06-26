FROM ubuntu:22.04

# Update package lists
RUN apt-get update

# Install additional packages here
# RUN apt-get install -y \
#     package1 \
#     package2

# Install development tools
RUN apt-get install -y \
    build-essential \
    curl \
    git \
    nodejs \
    npm \
    sudo \
    vim \
    zsh

# Clean up package cache
RUN apt-get clean && rm -rf /var/lib/apt/lists/*

# Set up workspace
RUN mkdir -p /workspace
WORKDIR /workspace

# Create non-root user
ARG USERNAME=vscode
ARG USER_UID=1000
ARG USER_GID=$USER_UID
RUN groupadd --gid $USER_GID $USERNAME \
    && useradd --uid $USER_UID --gid $USER_GID -m $USERNAME \
    && echo $USERNAME ALL=\(root\) NOPASSWD:ALL > /etc/sudoers.d/$USERNAME \
    && chmod 0440 /etc/sudoers.d/$USERNAME

# Switch to non-root user
USER vscode
