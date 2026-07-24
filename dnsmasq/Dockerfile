FROM alpine:3.20
RUN apk add --no-cache dnsmasq
ENTRYPOINT ["dnsmasq", "--keep-in-foreground", "--no-resolv", "--no-hosts", "--conf-dir=/etc/dnsmasq.d"]
