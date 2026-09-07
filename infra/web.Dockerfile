FROM golang:1.26.6-alpine AS caddy-build

RUN apk add --no-cache git
RUN git clone --depth 1 --branch v2.11.4 https://github.com/caddyserver/caddy.git /src/caddy
WORKDIR /src/caddy
RUN go get golang.org/x/net@v0.56.0 golang.org/x/text@v0.39.0 google.golang.org/grpc@v1.82.1 \
	&& go mod tidy \
	&& CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /usr/bin/caddy ./cmd/caddy

FROM caddy:2.11-alpine

RUN apk upgrade --no-cache
COPY --from=caddy-build /usr/bin/caddy /usr/bin/caddy
RUN addgroup -S -g 10001 caddy-runtime \
	&& adduser -S -D -H -u 10001 -G caddy-runtime caddy-runtime \
	&& chown -R caddy-runtime:caddy-runtime /data /config

COPY infra/Caddyfile /etc/caddy/Caddyfile
COPY *.html /srv/
COPY css /srv/css
COPY js /srv/js
COPY Logo /srv/Logo
COPY slide /srv/slide

USER caddy-runtime