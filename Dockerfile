# ============================================================
# Construida SOBRE la imagen ya desplegada (36d en produccion),
# que ya contiene: Python 3.10 + flask/oracledb, Chrome, Oracle
# InstantClient, node_modules. No se ejecuta pip ni apt-get.
# Solo se reemplaza el runtime de Node 18 -> 24 y los fuentes.
# ============================================================
FROM base-botserviciosgl-wa:1

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=America/Guatemala

# Instalar Node 24 LTS desde tarball oficial de nodejs.org (evita apt/nodesource)
RUN wget -q https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-x64.tar.xz -O /tmp/node24.tar.xz \
    && mkdir -p /opt/node24 \
    && tar -xJf /tmp/node24.tar.xz -C /opt/node24 --strip-components=1 \
    && rm /tmp/node24.tar.xz \
    && ln -sfn /opt/node24/bin/node /usr/local/bin/node \
    && ln -sfn /opt/node24/bin/npm /usr/local/bin/npm \
    && ln -sfn /opt/node24/bin/npx /usr/local/bin/npx \
    && node --version

ENV PATH=/opt/node24/bin:$PATH
ENV NODE_PATH=/usr/local/lib/node_modules

WORKDIR /app

# Alinear Puppeteer con la version que exige whatsapp-web.js (24.38.0) e instalar
# su Chrome embebido. El sistema trae Chrome 147 manejado por puppeteer 22.15.0:
# ese desajuste de protocolo CDP colgaba el renderer.
# IMPORTANTE: esta capa va ANTES de copiar los fuentes para que un cambio de
# codigo no obligue a re-descargar Chrome.
ENV PUPPETEER_CACHE_DIR=/app/.puppeteer
RUN cd /app \
    && PUPPETEER_SKIP_CHROMIUM_DOWNLOAD= PUPPETEER_SKIP_DOWNLOAD= npm install puppeteer@24.38.0 puppeteer-core@24.38.0 --no-save --no-audit --no-fund \
    && npx puppeteer browsers install chrome \
    && node -e "console.log('puppeteer:', require('/app/node_modules/puppeteer/package.json').version, 'core:', require('/app/node_modules/puppeteer-core/package.json').version)" \
    && ls -d /app/.puppeteer/chrome/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
# Usar el Chrome embebido de Puppeteer (compatible con su CDP), no el del sistema
ENV PUPPETEER_EXECUTABLE_PATH=""

# Fuentes del servicio (cambian seguido; van al final para aprovechar la cache)
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

COPY whatsapp/service.cjs /app/whatsapp/service.cjs
COPY whatsapp/bot.cjs /app/whatsapp/bot.cjs

RUN mkdir -p /app/data/session /app/data/documentos /app/data/.wwebjs_cache

ENTRYPOINT ["/app/entrypoint.sh"]

EXPOSE 3000

# bot.cjs (no bot.js): reintenta en vez de process.exit(1) ante fallos de arranque
CMD ["node", "whatsapp/bot.cjs"]
