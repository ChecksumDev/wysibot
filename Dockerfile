FROM debian:stable-slim

# Install dependencies
RUN apt install -y curl unzip

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash 

# Create a user
RUN adduser --system --disabled-password --no-create-home --uid 727 --group --shell /bin/bash wysi
USER wysi

# Create a working directory and copy the source code
WORKDIR /srv/wysibotbs
COPY . .

# Install dependencies
RUN bun install

# Build
RUN bun build --minify --target=bun src/index.ts --outfile=dist/index.js

# Run
CMD ["node", "dist/index.js"]