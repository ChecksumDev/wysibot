FROM oven/bun

# Create a user
RUN adduser --system --disabled-password --no-create-home --uid 1000 --group --shell /bin/bash wysi
USER wysi

# Copy files
COPY . .

# Install dependencies
RUN bun install

# Build
RUN bun build --minify --target=bun src/index.ts --outfile=dist/index.js

# Run
CMD ["node", "dist/index.js"]