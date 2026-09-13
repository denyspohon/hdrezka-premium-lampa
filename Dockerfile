FROM alpine:3.20 AS lampa

RUN apk add --no-cache git ca-certificates

ARG LAMPA_COMMIT=0f50f0c4cb3f602ecaff84925dca07f96bbd38a8

RUN git init /lampa \
    && cd /lampa \
    && git remote add origin https://github.com/yumata/lampa.git \
    && git fetch --depth 1 origin ${LAMPA_COMMIT} \
    && git checkout --detach FETCH_HEAD \
    && rm -rf /lampa/.git


FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV LAMPA_DIR=/app/lampa

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY --from=lampa /lampa /app/lampa

COPY app.py plugin.js denys-init.js ./

EXPOSE 10000

CMD sh -c 'uvicorn app:app --host 0.0.0.0 --port ${PORT:-10000} --proxy-headers --forwarded-allow-ips="*"'
