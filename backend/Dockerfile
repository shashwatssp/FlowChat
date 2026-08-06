# Build stage
FROM golang:1.22-alpine AS builder

WORKDIR /build

# Download dependencies first for better caching
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build the binary
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -a -installsuffix cgo -o /build/server ./cmd/server

# Final stage
FROM alpine:latest

RUN apk --no-cache add ca-certificates

WORKDIR /root/

# Copy the binary from the builder
COPY --from=builder /build/server .

# Expose port
EXPOSE 8080

# Run the binary
CMD ["./server"]
