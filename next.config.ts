import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["exceljs", "pg", "jszip", "saxes"],
  // ExcelJS -> unzipper requires Bluebird's nested release directory. Keep
  // that runtime explicit instead of relying on dynamic dependency tracing.
  outputFileTracingIncludes: {
    "/*": ["./node_modules/bluebird/js/release/**/*.js"],
  },
  outputFileTracingExcludes: {
    // '*' also covers next-server tracing. Match normalized relative paths
    // early, before Windows absolute-glob handling in the final trace pass.
    "*": [
      "**/storage/**",
      "**/release/**",
      "**/.desktop-resources/**",
      "**/output/**",
      "**/.playwright-cli/**",
    ],
  },
};
export default config;
