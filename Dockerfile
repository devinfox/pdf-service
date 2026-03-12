# Use Node.js LTS
FROM node:20-slim

# Install pdftk-java and dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    pdftk-java \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy built files
COPY dist ./dist

# Expose port
EXPOSE 3000

# Start server
CMD ["node", "dist/server.js"]
