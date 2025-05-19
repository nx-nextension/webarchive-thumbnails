
#!/bin/bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd $DIR/..

# get project environment variables and local overrides
source $DIR/../.env
test -f $DIR/../.env.local && source $DIR/../.env.local

docker-compose exec puppeteer sh -c '${0} ${1+"$@"}' npx jest "$@"

