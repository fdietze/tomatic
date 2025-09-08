# Use the official Node.js image as a base
FROM docker.io/library/node:22-slim

# Install Playwright browsers and their dependencies
RUN apt-get update && apt-get install -yq libgconf-2-4 libatk1.0-0 libatk-bridge2.0-0 libgdk-pixbuf2.0-0 libgtk-3-0 libgbm-dev libnss3 libxss1 && \
    npx playwright install --with-deps chromium

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json to leverage Docker cache
COPY package.json package-lock.json ./

# Install project dependencies
RUN npm ci

# Copy the rest of the application files needed for the test
COPY vite.config.ts vite.config.js .
COPY tsconfig.json tsconfig.node.json .
COPY playwright.config.ts .
COPY public/ ./public/
COPY index.html .
COPY src/ ./src/
COPY tests/ ./tests/

# Run the Playwright tests. The build will fail if tests fail.
RUN npx playwright test --reporter=line
