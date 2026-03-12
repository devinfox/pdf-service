# Use Debian-based Node image
FROM node:20-bookworm

# Install pdftk
RUN apt-get update && \
    apt-get install -y pdftk-java && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including dev for build)
RUN npm ci

# Copy source files
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN npm run build

# Remove dev dependencies
RUN npm prune --production

# Expose port
EXPOSE 3000

# Start server
CMD ["node", "dist/server.js"]
