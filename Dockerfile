FROM node:20-alpine

# HEIC/HEIF (foto iPhone) — dukungan libvips untuk sharp
RUN apk add --no-cache libc6-compat vips-cpp libheif

WORKDIR /app

# Copy package files first
COPY package.json package-lock.json* ./

# Copy Prisma schema BEFORE npm ci (postinstall needs it)
COPY prisma ./prisma/

# Install dependencies (postinstall = prisma generate)
RUN npm ci 2>/dev/null || npm install

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Expose port
EXPOSE 8080

# Start the application
CMD ["npm", "run", "start"]