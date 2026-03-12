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

# Install dependencies
RUN npm ci --only=production

# Copy built files
COPY dist ./dist

# Expose port
EXPOSE 3000

# Start server
CMD ["node", "dist/server.js"]
