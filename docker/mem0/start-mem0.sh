#!/bin/sh
set -eu

until python -c "import os, psycopg; psycopg.connect(host=os.environ['POSTGRES_HOST'], port=os.environ['POSTGRES_PORT'], dbname=os.environ['APP_DB_NAME'], user=os.environ['POSTGRES_USER'], password=os.environ['POSTGRES_PASSWORD']).close()"
do
  echo 'Waiting for Mem0 PostgreSQL...'
  sleep 2
done

alembic upgrade head
exec uvicorn main:app --host 0.0.0.0 --port 8000
