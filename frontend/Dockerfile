# Multi-stage Dockerfile for React Frontend
# Stage 1: Build static assets
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package descriptors and install dependencies
COPY package*.json ./
RUN npm install

# Copy source and build project
COPY . .
RUN npm run build

# Stage 2: Web Server
FROM nginx:stable-alpine

# Copy built bundle from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy custom Nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
