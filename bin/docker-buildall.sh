#!/bin/bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd $DIR/..
#source $DIR/../.env
#test -f $DIR/../.env.local && source $DIR/../.env.local

# Cross-platform scripts (amd64/arm64) to build container images
# only works on macOS or specially prepared linux machines
# use `docker login registry.gitlab.com` to push images
TARGET_ENV=env-${1:-test}
docker buildx build  --platform linux/amd64,linux/arm64/v8 -fdocker/puppeteer/Dockerfile.alpine \
--pull --push \
--tag registry.gitlab.com/target/thumbnails/${TARGET_ENV}/puppeteer:latest .

docker buildx build  --platform linux/amd64,linux/arm64/v8 -fdocker/epubcover/Dockerfile \
--pull --push \
--tag registry.gitlab.com/target/thumbnails/${TARGET_ENV}/epubcover:latest .

docker buildx build  --platform linux/amd64,linux/arm64/v8 -fdocker/redis/Dockerfile \
--pull --push \
--tag registry.gitlab.com/target/thumbnails/${TARGET_ENV}/redis:latest .
