# Build stage
FROM node:22 AS build
WORKDIR /src
COPY . ./

RUN corepack enable
RUN yarn install --immutable

RUN yarn run web:build:prod

# Release stage
FROM node:22-alpine
WORKDIR /app
COPY --from=build /src/web/.webpack ./.webpack
COPY web/server.js ./

EXPOSE 8080

ENV ROSBAG_FOLDER=/mnt/rosbags
CMD ["node", "server.js"]
