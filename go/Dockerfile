FROM golang:1.21

# Install build dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libproj-dev

# Set the working directory
WORKDIR /app

# Copy the Go modules files and download dependencies
COPY go.mod go.sum ./
RUN go mod download

# Copy the source code
COPY . .

# Build the application
RUN go build -o /go-xctask task.go

# Set the entrypoint
ENTRYPOINT ["/go-xctask"]

