/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: false, // avoids double-mounting the mic/model workers in dev
  webpack: (config) => {
    // transformers.js ships node-only deps we never use in the browser
    config.resolve.alias = {
      ...config.resolve.alias,
      sharp$: false,
      "onnxruntime-node$": false,
    };
    return config;
  },
  async headers() {
    // Cross-origin isolation enables multithreaded WASM (faster CPU fallback)
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
        ],
      },
    ];
  },
};
export default nextConfig;
