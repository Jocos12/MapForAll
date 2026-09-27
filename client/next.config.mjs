/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // The "Route / Try Turbopack" menu is the Next.js dev overlay. Production
  // (`next build && next start`) never mounts it. This also hides it during
  // `next dev`, so a local rehearsal cannot show it over the photo gallery.
  devIndicators: false,
  async rewrites() {
    return [
      {
        source: '/adk/:path*',
        destination: `${process.env.ADK_BASE_URL || 'http://localhost:8000'}/:path*`,
      },
    ]
  },
}

export default nextConfig
