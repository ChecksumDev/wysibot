FROM oven/bun

# Create a user
RUN adduser -D -u 1000 -g 1000 -s /bin/sh wysi
USER wysi

# Copy files
COPY . .

# Install dependencies
RUN bun install

# Build
RUN bun build --minify --target=bun src/index.ts --outfile=dist/index.js

# Run
CMD ["node", "dist/index.js"]