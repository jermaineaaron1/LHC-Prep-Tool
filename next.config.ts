import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Worship app served via app/route.ts at /
  // Practice Game (Vocal Hero) served at /practice-game
  turbopack: {
    resolveAlias: {
      // vits-web's emscripten glue has a Node-only require('fs') branch the
      // browser never executes; give the bundler an empty module for it.
      fs: { browser: "./src/lib/shims/empty.ts" },
    },
  },
};

export default nextConfig;
