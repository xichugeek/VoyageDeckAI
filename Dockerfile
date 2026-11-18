FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim-bookworm@sha256:935c3c5b12357a7e10caa9c1e6ca5692344d97cf229832ef584be2cec9fc03df
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    VOYAGEDECK_STATIC_DIR=/opt/voyagedeck/static \
    VOYAGEDECK_DB_PATH=/data/voyagedeck.sqlite3 \
    VOYAGEDECK_API_DOCS=0
WORKDIR /opt/voyagedeck
COPY backend/requirements.txt ./requirements.txt
RUN python -m pip install --no-cache-dir --disable-pip-version-check --root-user-action=ignore -r requirements.txt \
    && groupadd --gid 10001 voyage \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin voyage \
    && install -d -m 0750 -o 10001 -g 10001 /data
COPY backend/app/ ./app/
COPY --from=frontend /build/dist/ ./static/
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=8s --retries=3 CMD ["python", "-c", "from urllib.request import urlopen; assert urlopen('http://127.0.0.1:8080/api/health', timeout=2).status == 200"]
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--limit-concurrency", "32", "--backlog", "64", "--timeout-graceful-shutdown", "15", "--no-access-log"]
