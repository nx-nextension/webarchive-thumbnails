#!/bin/bash

# Enqueues URLs for processing
# KJ/NX 2022-02-20

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd $DIR/..

# get project environment variables and local overrides
source $DIR/../.env
test -f $DIR/../.env.local && source $DIR/../.env.local

# restart puppet to avoid accumulating zombies
#docker compose stop puppeteer
#docker compose up -d puppeteer

docker compose exec -T puppeteer sh -c '${0} ${1+"$@"}' node /usr/src/app/src/cli.js "$@"

