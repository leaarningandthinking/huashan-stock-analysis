/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  output: "standalone",
  // 关掉 StrictMode：它在 dev 模式下故意让 useEffect 跑两次，
  // 这会让 SSE 连接被关掉重连，导致后端 _PENDING 被消费一次后第二次连接 404
  reactStrictMode: false,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "source.unsplash.com" },
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "images.pexels.com" },
    ],
  },
  async rewrites() {
    // 开发期把 /api/* 代理到后端。rewrites 跑在 Next 服务侧，要用 docker 内网地址
    const target = process.env.API_BASE_INTERNAL || "http://localhost:8000";
    return [
      { source: "/api/:path*", destination: `${target}/api/:path*` },
    ];
  },
};

export default nextConfig;
