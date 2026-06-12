# WorkHub pilot 单镜像：API daemon + Web 静态产物（单源，无 CORS/SSE 跨域）。
# LAN-first 试运行用；多租户/云部署见 docs/workhub/06-roadmap/phasing-p0-p5.md（P5）。
FROM node:22-slim

# 沙箱白名单库（R5.11.1）：Office/图表/统计能力 + 中文字体。
# 工人不能自行装包（pip 不在命令白名单），能力面由镜像声明。
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip fonts-noto-cjk \
    && pip3 install --break-system-packages --no-cache-dir \
      python-docx==1.1.2 \
      openpyxl==3.1.5 \
      python-pptx==1.0.2 \
      matplotlib==3.9.4 \
      pandas==2.2.3 \
      numpy==2.1.3 \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@11.0.9 --activate

WORKDIR /app

# 先复制清单层，最大化依赖安装缓存命中。
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/desktop-webview/package.json apps/desktop-webview/package.json
COPY packages packages
RUN find packages -mindepth 2 -maxdepth 2 ! -name package.json -exec rm -rf {} + 2>/dev/null; \
    pnpm install --frozen-lockfile

# 再复制源码并构建 Web 产物。
COPY . .
RUN pnpm install --frozen-lockfile --offline && pnpm --filter @workhub/web build

ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    PORT=8787 \
    WEB_DIST_DIR=/app/apps/web/dist \
    LOG_FORMAT=json

EXPOSE 8787

CMD ["pnpm", "--filter", "@workhub/api", "start"]
