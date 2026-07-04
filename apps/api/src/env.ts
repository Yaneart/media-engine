import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// EN: Load the nearest .env file for local development without adding runtime dependencies.
// RU: Загружает ближайший .env для локальной разработки без добавления runtime-зависимостей.
export function loadLocalEnv(
  startDir = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const envPath = findEnvFile(startDir);

  if (envPath === undefined) {
    return undefined;
  }

  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const entry = parseEnvLine(line);

    if (entry === undefined || env[entry.key] !== undefined) {
      continue;
    }

    env[entry.key] = entry.value;
  }

  return envPath;
}

// EN: Walk upward so both root scripts and package-local scripts can find the project .env.
// RU: Идет вверх по папкам, чтобы root scripts и package-local scripts находили project .env.
function findEnvFile(startDir: string): string | undefined {
  let currentDir = resolve(startDir);

  while (true) {
    const candidate = join(currentDir, '.env');
    const workspaceMarker = join(currentDir, 'pnpm-workspace.yaml');

    if (existsSync(candidate)) {
      return candidate;
    }

    if (existsSync(workspaceMarker)) {
      return undefined;
    }

    const parentDir = dirname(currentDir);

    if (parentDir === currentDir) {
      return undefined;
    }

    currentDir = parentDir;
  }
}

// EN: Parse simple dotenv KEY=VALUE lines while ignoring comments and blank lines.
// RU: Парсит простые dotenv строки KEY=VALUE, игнорируя comments и пустые строки.
function parseEnvLine(
  line: string,
): { key: string; value: string } | undefined {
  const trimmed = line.trim();

  if (trimmed.length === 0 || trimmed.startsWith('#')) {
    return undefined;
  }

  const normalized = trimmed.startsWith('export ')
    ? trimmed.slice(7).trimStart()
    : trimmed;
  const separatorIndex = normalized.indexOf('=');

  if (separatorIndex <= 0) {
    return undefined;
  }

  const key = normalized.slice(0, separatorIndex).trim();

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return undefined;
  }

  return {
    key,
    value: unquoteEnvValue(normalized.slice(separatorIndex + 1).trim()),
  };
}

// EN: Remove matching dotenv quotes and common escaped newlines for local secrets.
// RU: Убирает парные dotenv кавычки и частый escaped newline для локальных секретов.
function unquoteEnvValue(value: string): string {
  const quote = value[0];

  if ((quote !== '"' && quote !== "'") || value[value.length - 1] !== quote) {
    return value;
  }

  const unquoted = value.slice(1, -1);

  return quote === '"' ? unquoted.replaceAll('\\n', '\n') : unquoted;
}
