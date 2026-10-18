import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // node:sqlite is a Node built-in; keep it out of the server bundle.
  serverExternalPackages: ['exceljs', 'undici', 'nodemailer', 'node-html-parser', 'pg', 'sharp', '@aws-sdk/client-s3'],
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [...(config.externals || []), { 'node:sqlite': 'commonjs node:sqlite' }];
    }
    return config;
  },
};

export default nextConfig;
