FROM postgres:17-alpine

RUN apk upgrade --no-cache \
    && apk add --no-cache su-exec \
    && sed -i 's/gosu/su-exec/g' /usr/local/bin/docker-entrypoint.sh \
    && rm -f /usr/local/bin/gosu \
    && mkdir -p /backups \
    && chown postgres:postgres /backups
