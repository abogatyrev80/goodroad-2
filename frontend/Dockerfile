# Frontend Dockerfile for Road Monitor Expo App
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install global dependencies
RUN npm install -g expo-cli@6.3.10

# Copy package files
COPY package.json yarn.lock ./

# Install dependencies
RUN yarn install --frozen-lockfile

# Copy application code
COPY . .

# Expose port
EXPOSE 3000
EXPOSE 19000
EXPOSE 19001
EXPOSE 19002

# Start Expo
CMD ["yarn", "start"]