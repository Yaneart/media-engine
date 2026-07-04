import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadLocalEnv } from './env';

describe('local env loader', () => {
  it('loads nearest .env values without overriding existing env', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'media-engine-env-'));
    const nestedDir = join(rootDir, 'apps', 'api');
    const env: NodeJS.ProcessEnv = {
      TMDB_API_READ_ACCESS_TOKEN: 'existing-token',
    };

    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(
      join(rootDir, '.env'),
      [
        'TMDB_API_READ_ACCESS_TOKEN=file-token',
        'TMDB_API_KEY="fallback-token"',
        "VITE_MEDIA_ENGINE_API_URL='http://127.0.0.1:3000'",
        '# ignored comment',
        '',
      ].join('\n'),
    );

    expect(loadLocalEnv(nestedDir, env)).toBe(join(rootDir, '.env'));
    expect(env.TMDB_API_READ_ACCESS_TOKEN).toBe('existing-token');
    expect(env.TMDB_API_KEY).toBe('fallback-token');
    expect(env.VITE_MEDIA_ENGINE_API_URL).toBe('http://127.0.0.1:3000');
  });

  it('does not search above the workspace root', () => {
    const parentDir = mkdtempSync(join(tmpdir(), 'media-engine-parent-'));
    const workspaceDir = join(parentDir, 'workspace');
    const nestedDir = join(workspaceDir, 'apps', 'api');
    const env: NodeJS.ProcessEnv = {};

    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(join(parentDir, '.env'), 'TMDB_API_KEY=parent-token\n');
    writeFileSync(join(workspaceDir, 'pnpm-workspace.yaml'), 'packages: []\n');

    expect(loadLocalEnv(nestedDir, env)).toBeUndefined();
    expect(env.TMDB_API_KEY).toBeUndefined();
  });
});
