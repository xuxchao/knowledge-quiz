#!/usr/bin/env node

const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");
const readline = require("node:readline/promises");
const { createRequire } = require("node:module");
const { spawnSync } = require("node:child_process");

const backendRequire = createRequire(
  path.resolve(__dirname, "..", "backend", "package.json"),
);
const { Client: PgClient } = backendRequire("pg");
const { createClient: createRedisClient } = backendRequire("redis");
const neo4j = backendRequire("neo4j-driver");
const {
  S3Client,
  CreateBucketCommand,
  DeleteObjectsCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
} = backendRequire("@aws-sdk/client-s3");

const args = new Set(process.argv.slice(2));
const yes = args.has("--yes") || args.has("-y");
const checkOnly = args.has("--check");
const skipObservability = args.has("--skip-observability");
const skipObjectStorage = args.has("--skip-object-storage");

function readEnvFile() {
  const envPath = path.resolve(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) {
    return {};
  }

  return fs
    .readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .reduce((env, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return env;
      }

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) {
        return env;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const rawValue = trimmed.slice(separatorIndex + 1).trim();
      env[key] = rawValue.replace(/^['"]|['"]$/g, "");
      return env;
    }, {});
}

const env = readEnvFile();

function getEnv(name, defaultValue) {
  return env[name] || process.env[name] || defaultValue;
}

function getNumberEnv(name, defaultValue) {
  const value = Number(getEnv(name, String(defaultValue)));
  return Number.isFinite(value) ? value : defaultValue;
}

function getBooleanEnv(name, defaultValue) {
  const value = getEnv(name, String(defaultValue)).toLowerCase();
  return ["1", "true", "yes", "y"].includes(value);
}

const postgresConfig = {
  host: getEnv("POSTGRES_HOST", "localhost"),
  port: getNumberEnv("POSTGRES_PORT", 5432),
  user: getEnv("POSTGRES_USER", "admin"),
  password: getEnv("POSTGRES_PASSWORD", "password"),
};
const postgresDb = getEnv("POSTGRES_DB", "knowledge_doc");
const langfuseDb = getEnv("LANGFUSE_DB", "langfuse");

const redisConfig = {
  socket: {
    host: getEnv("REDIS_HOST", "localhost"),
    port: getNumberEnv("REDIS_PORT", 6379),
  },
  database: getNumberEnv("REDIS_DB", 0),
};
const langfuseRedisDb = getNumberEnv("LANGFUSE_REDIS_DB", 1);
const redisPassword = getEnv("REDIS_PASSWORD", "");
if (redisPassword) {
  redisConfig.password = redisPassword;
}

const neo4jAuth = getEnv("NEO4J_AUTH", "");
const [neo4jAuthUser, neo4jAuthPassword] = neo4jAuth.split("/", 2);
const neo4jConfig = {
  uri: getEnv("NEO4J_URI", "bolt://localhost:7687"),
  user: getEnv("NEO4J_USER", neo4jAuthUser || "neo4j"),
  password: getEnv("NEO4J_PASSWORD", neo4jAuthPassword || "password"),
};

const clickhouseConfig = {
  protocol: getEnv("CLICKHOUSE_PROTOCOL", "http"),
  host: getEnv("CLICKHOUSE_HOST", "localhost"),
  port: getNumberEnv("CLICKHOUSE_PORT", 8123),
  user: getEnv("CLICKHOUSE_USER", "default"),
  password: getEnv("CLICKHOUSE_PASSWORD", "langfuse123"),
  database: getEnv(
    "LANGFUSE_CLICKHOUSE_DB",
    getEnv("CLICKHOUSE_DB", "langfuse"),
  ),
};

const elasticsearchHost = getEnv(
  "ELASTICSEARCH_URL",
  "http://localhost:9200",
).replace(/\/$/, "");

const rustfsConfig = {
  endpoint: getEnv("RUSTFS_ENDPOINT", "http://localhost:9004"),
  accessKeyId: getEnv("RUSTFS_ACCESS_KEY", "rustfsadmin"),
  secretAccessKey: getEnv("RUSTFS_SECRET_KEY", "rustfsadmin"),
  region: getEnv("RUSTFS_REGION", "us-east-1"),
  forcePathStyle: getBooleanEnv("RUSTFS_FORCE_PATH_STYLE", true),
  bucket: getEnv("RUSTFS_BUCKET", "documents"),
};

const langfuseStorageConfig = {
  endpoint: normalizeEndpoint(
    getEnv(
      "LANGFUSE_S3_EVENT_UPLOAD_ENDPOINT",
      getEnv("RUSTFS_ENDPOINT", "http://localhost:9004"),
    ),
    getNumberEnv("RUSTFS_PORT", 9004),
  ),
  accessKeyId: getEnv(
    "LANGFUSE_S3_EVENT_UPLOAD_ACCESS_KEY_ID",
    rustfsConfig.accessKeyId,
  ),
  secretAccessKey: getEnv(
    "LANGFUSE_S3_EVENT_UPLOAD_SECRET_ACCESS_KEY",
    rustfsConfig.secretAccessKey,
  ),
  region: getEnv("LANGFUSE_S3_EVENT_UPLOAD_REGION", rustfsConfig.region),
  forcePathStyle: getBooleanEnv(
    "LANGFUSE_S3_EVENT_UPLOAD_FORCE_PATH_STYLE",
    true,
  ),
  bucket: getEnv("LANGFUSE_S3_EVENT_UPLOAD_BUCKET", "langfuse"),
};

function normalizeEndpoint(endpoint, hostPort) {
  try {
    const url = new URL(endpoint);
    if (url.hostname === "rustfs") {
      url.hostname = "localhost";
      url.port = String(hostPort);
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return endpoint;
  }
}

function quoteSqlString(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

function quoteClickHouseIdentifier(value) {
  return `\`${value.replace(/`/g, "``")}\``;
}

async function resetPostgresDatabase(database, excludedTables = []) {
  const client = new PgClient({
    ...postgresConfig,
    database,
  });

  const excludedArray =
    excludedTables.length > 0
      ? `ARRAY[${excludedTables.map(quoteSqlString).join(",")}]::text[]`
      : "ARRAY[]::text[]";

  const sql = `
DO $$
DECLARE
  table_names text;
BEGIN
  SELECT string_agg(format('%I.%I', schemaname, tablename), ', ')
  INTO table_names
  FROM pg_tables
  WHERE schemaname = 'public'
    AND NOT (tablename = ANY (${excludedArray}));

  IF table_names IS NOT NULL THEN
    EXECUTE 'TRUNCATE TABLE ' || table_names || ' RESTART IDENTITY CASCADE';
  END IF;
END
$$;
`;

  console.log(`正在重置 PostgreSQL 数据库: ${database}`);
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

async function checkPostgresDatabase(database) {
  const client = new PgClient({
    ...postgresConfig,
    database,
  });

  await client.connect();
  try {
    await client.query("SELECT 1");
    console.log(`PostgreSQL 数据库连接正常: ${database}`);
  } finally {
    await client.end();
  }
}

async function resetRedis() {
  const databases = [redisConfig.database];
  if (!skipObservability && langfuseRedisDb !== redisConfig.database) {
    databases.push(langfuseRedisDb);
  }

  console.log(`正在清空 Redis 数据库: ${databases.join(", ")}`);
  const client = createRedisClient(redisConfig);
  await client.connect();
  try {
    for (const database of databases) {
      await client.select(database);
      await client.flushDb();
    }
  } finally {
    await client.quit();
  }
}

async function checkRedis() {
  const client = createRedisClient(redisConfig);
  await client.connect();
  try {
    await client.ping();
    console.log("Redis 连接正常");
  } finally {
    await client.quit();
  }
}

async function withNeo4jSession(action) {
  const driver = neo4j.driver(
    neo4jConfig.uri,
    neo4j.auth.basic(neo4jConfig.user, neo4jConfig.password),
  );
  const session = driver.session();
  try {
    await driver.verifyConnectivity();
    return await action(session);
  } finally {
    await session.close();
    await driver.close();
  }
}

async function resetNeo4j() {
  console.log("正在删除 Neo4j 图数据");
  await withNeo4jSession((session) => session.run("MATCH (n) DETACH DELETE n"));
}

async function checkNeo4j() {
  await withNeo4jSession((session) => session.run("RETURN 1 AS ok"));
  console.log("Neo4j 连接正常");
}

function httpRequest(method, url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === "https:" ? https : http;
    const request = client.request(
      parsedUrl,
      {
        method,
        headers: {
          ...headers,
          ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
        },
      },
      (response) => {
        let responseBody = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          responseBody += chunk;
        });
        response.on("end", () => {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve(responseBody);
          } else {
            reject(
              new Error(
                `${method} ${url} 请求失败，状态码: ${response.statusCode}，响应: ${responseBody}`,
              ),
            );
          }
        });
      },
    );

    request.on("error", reject);
    request.setTimeout(10000, () => {
      request.destroy(new Error(`${method} ${url} 请求超时`));
    });
    if (body) {
      request.write(body);
    }
    request.end();
  });
}

function restartLangfuseServices() {
  console.log("正在重启 Langfuse Web 和 Worker 以恢复默认数据");
  const result = spawnSync(
    "docker",
    ["compose", "restart", "langfuse", "langfuse-worker"],
    {
      cwd: path.resolve(__dirname, ".."),
      stdio: "inherit",
    },
  );

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `Langfuse 服务重启失败，docker compose 退出码: ${result.status}`,
    );
  }
}

async function waitForLangfuse() {
  const baseUrl = getEnv("NEXTAUTH_URL", "http://localhost:3005").replace(
    /\/$/,
    "",
  );
  let lastError;
  let consecutiveSuccesses = 0;

  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      await httpRequest("GET", baseUrl);
      consecutiveSuccesses += 1;
      if (consecutiveSuccesses >= 3) {
        console.log("Langfuse 服务已恢复");
        return;
      }
    } catch (error) {
      lastError = error;
      consecutiveSuccesses = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error(
    `Langfuse 服务未在预期时间内恢复: ${lastError instanceof Error ? lastError.message : lastError}`,
  );
}

function buildClickHouseUrl() {
  const url = new URL(
    `${clickhouseConfig.protocol}://${clickhouseConfig.host}:${clickhouseConfig.port}/`,
  );
  url.searchParams.set("user", clickhouseConfig.user);
  if (clickhouseConfig.password) {
    url.searchParams.set("password", clickhouseConfig.password);
  }
  return url.toString();
}

async function clickHouseQuery(sql) {
  return httpRequest("POST", buildClickHouseUrl(), sql, {
    "Content-Type": "text/plain; charset=utf-8",
  });
}

async function resetClickHouseDatabase() {
  console.log("正在清空 ClickHouse 中的 Langfuse 数据表");

  const tableListSql = `
SELECT name
FROM system.tables
WHERE database = ${quoteSqlString(clickhouseConfig.database)}
  AND engine NOT IN ('View', 'MaterializedView', 'Dictionary')
  AND lower(name) NOT LIKE '%migration%'
FORMAT TSVRaw
`;
  const tableNames = (await clickHouseQuery(tableListSql))
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean);

  for (const tableName of tableNames) {
    const table = `${quoteClickHouseIdentifier(clickhouseConfig.database)}.${quoteClickHouseIdentifier(tableName)}`;
    await clickHouseQuery(`TRUNCATE TABLE IF EXISTS ${table}`);
  }
}

async function checkClickHouse() {
  await clickHouseQuery("SELECT 1");
  console.log("ClickHouse 连接正常");
}

async function resetElasticsearch() {
  console.log("正在删除 Elasticsearch 索引");
  const body = await httpRequest(
    "GET",
    `${elasticsearchHost}/_cat/indices?h=index`,
  );
  const indices = body.split(/\s+/).filter(Boolean);

  for (const index of indices) {
    await httpRequest(
      "DELETE",
      `${elasticsearchHost}/${encodeURIComponent(index)}`,
    );
  }
}

async function checkElasticsearch() {
  await httpRequest("GET", `${elasticsearchHost}/`);
  console.log("Elasticsearch 连接正常");
}

function createS3Client(config) {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

function isMissingBucketError(error) {
  return (
    error?.$metadata?.httpStatusCode === 404 ||
    ["NotFound", "NoSuchBucket", "NotFoundError"].includes(error?.name)
  );
}

async function ensureBucket(client, bucket) {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (error) {
    if (!isMissingBucketError(error)) {
      throw error;
    }
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}

async function clearBucket(label, config) {
  console.log(`正在删除 ${label} 存储桶「${config.bucket}」中的对象`);
  const client = createS3Client(config);
  await ensureBucket(client, config.bucket);

  let continuationToken;
  do {
    const listResult = await client.send(
      new ListObjectsV2Command({
        Bucket: config.bucket,
        ContinuationToken: continuationToken,
      }),
    );
    const objects = (listResult.Contents || [])
      .map((item) => ({ Key: item.Key }))
      .filter((item) => item.Key);

    if (objects.length > 0) {
      await client.send(
        new DeleteObjectsCommand({
          Bucket: config.bucket,
          Delete: {
            Objects: objects,
            Quiet: true,
          },
        }),
      );
    }

    continuationToken = listResult.IsTruncated
      ? listResult.NextContinuationToken
      : undefined;
  } while (continuationToken);
}

async function checkBucket(label, config) {
  const client = createS3Client(config);
  try {
    await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
    console.log(`${label} 存储桶连接正常: ${config.bucket}`);
  } catch (error) {
    if (isMissingBucketError(error)) {
      console.log(
        `${label} 存储桶不存在，执行重置时会自动创建: ${config.bucket}`,
      );
      return;
    }
    throw error;
  }
}

async function confirmReset() {
  if (yes) {
    return true;
  }

  console.log(
    "本操作会删除项目运行过程中产生的数据，包括 PostgreSQL、Redis、Neo4j、Elasticsearch 和 RustFS。",
  );
  if (!skipObservability) {
    console.log(
      "同时也会重置 Langfuse 在 PostgreSQL、ClickHouse、Redis 和 RustFS 中产生的运行数据。",
    );
  }
  console.log("如果确认要继续，请在下面输入 RESET。");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await rl.question("请输入 RESET 继续: ");
    return answer === "RESET";
  } finally {
    rl.close();
  }
}

async function checkConnections() {
  await checkPostgresDatabase(postgresDb);
  await checkRedis();
  await checkNeo4j();
  await checkElasticsearch();

  if (!skipObjectStorage) {
    await checkBucket("RustFS", rustfsConfig);
  }

  if (!skipObservability) {
    await checkPostgresDatabase(langfuseDb);
    await checkClickHouse();
    if (!skipObjectStorage) {
      await checkBucket("Langfuse RustFS", langfuseStorageConfig);
    }
  }
}

async function resetDatabases() {
  await resetPostgresDatabase(postgresDb);
  await resetRedis();
  await resetNeo4j();
  await resetElasticsearch();

  if (!skipObjectStorage) {
    await clearBucket("RustFS", rustfsConfig);
  }

  if (!skipObservability) {
    await resetPostgresDatabase(langfuseDb, ["_prisma_migrations"]);
    await resetClickHouseDatabase();
    if (!skipObjectStorage) {
      await clearBucket("Langfuse RustFS", langfuseStorageConfig);
    }
    restartLangfuseServices();
    await waitForLangfuse();
  }
}

async function main() {
  if (checkOnly) {
    await checkConnections();
    console.log("自检完成，未执行任何清理操作。");
    return;
  }

  const confirmed = await confirmReset();
  if (!confirmed) {
    console.log("已取消操作。");
    return;
  }

  await resetDatabases();
  console.log("数据库重置完成。");
}

main().catch((error) => {
  const nestedErrors = error instanceof AggregateError ? error.errors : [];
  const details = [error, ...nestedErrors]
    .map((item) =>
      item instanceof Error
        ? item.message || item.code || item.name
        : String(item),
    )
    .filter(Boolean)
    .join("; ");
  console.error(details || "数据库重置失败，未返回错误详情");
  process.exit(1);
});
