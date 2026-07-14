FROM python:3.12

ARG MEM0_COMMIT=42cf18c4e6adb448e981aa1c7b55c1602b0cb670

ADD https://github.com/mem0ai/mem0/archive/${MEM0_COMMIT}.tar.gz /tmp/mem0.tar.gz
RUN mkdir -p /source \
    && tar -xzf /tmp/mem0.tar.gz --strip-components=1 -C /source \
    && rm /tmp/mem0.tar.gz

WORKDIR /source
RUN pip install --no-cache-dir -r server/requirements.txt \
    && pip install --no-cache-dir -e .[graph]

WORKDIR /app
RUN cp -a /source/server/. /app/
COPY docker/mem0/start-mem0.sh /usr/local/bin/start-mem0
RUN chmod +x /usr/local/bin/start-mem0

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
EXPOSE 8000

CMD ["start-mem0"]
