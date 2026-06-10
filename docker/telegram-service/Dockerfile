FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY telegram-service/go.mod ./
COPY telegram-service/main.go ./
RUN go build -o /telegram-service .

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=builder /telegram-service .
EXPOSE 8082
CMD ["./telegram-service"]
