FROM oven/bun

# Create a working directory and copy the source code
WORKDIR /srv/wysibotbs
COPY . .

RUN bun install

RUN bun build --minify --target=bun src/main.ts --outfile=dist/main.js

# Run
CMD ["bun", "dist/main.js"]
