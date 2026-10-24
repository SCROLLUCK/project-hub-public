# Project Hub in a container. It runs git, dev servers, docker and reads ~/.claude on the host,
# so the base matches the host (Ubuntu 24.04, so glibc and python match an Ubuntu 24.04-based host) and the
# compose file mounts $HOME at the same path. See docs/container.md.
FROM node:24.15.0-bookworm-slim AS node
FROM docker:29.0-cli AS docker

FROM ubuntu:24.04 AS build
COPY --from=node /usr/local/ /usr/local/
WORKDIR /opt/project-hub
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm -w web run build

FROM ubuntu:24.04
RUN apt-get update \
  && apt-get install -y --no-install-recommends git iproute2 ca-certificates openssh-client python3 python3-venv make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/ /usr/local/
COPY --from=docker /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker /usr/local/libexec/docker/cli-plugins/ /usr/local/libexec/docker/cli-plugins/
WORKDIR /opt/project-hub
COPY --from=build /opt/project-hub ./
ENV PROJECT_HUB_WEB_DIST=/opt/project-hub/web/dist
WORKDIR /opt/project-hub/server
CMD ["node", "--import", "tsx", "src/index.ts"]
