import type { NextConfig } from "next";
import withFlowbiteReact from "flowbite-react/plugin/nextjs";
import { MAX_ARCHIVE_UPLOAD_BYTES } from "./lib/uploadLimits";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    proxyClientMaxBodySize: MAX_ARCHIVE_UPLOAD_BYTES,
  },
};

export default withFlowbiteReact(nextConfig);
