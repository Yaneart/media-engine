import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadLocalEnv } from './env';

describe('local env loader', () => {
  it('loads nearest .env values without overriding existing env', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'media-engine-env-'));
    const nestedDir = join(rootDir, 'apps', 'api');
    const env: NodeJS.ProcessEnv = {
      EXISTING_VALUE: 'existing',
    };

    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(
      join(rootDir, '.env'),
      [
        'EXISTING_VALUE=file-value',
        'EXAMPLE_VALUE="loaded-value"',
        "VITE_MEDIA_ENGINE_API_URL='http://127.0.0.1:3000'",
        'MULTILINE_VALUE="first\\nsecond"',
        'export EXPORTED_VALUE=exported',
        'INVALID-KEY=ignored',
        'missing-separator',
        '# ignored comment',
        '',
      ].join('\n'),
    );

    expect(loadLocalEnv(nestedDir, env)).toBe(join(rootDir, '.env'));
    expect(env.EXISTING_VALUE).toBe('existing');
    expect(env.EXAMPLE_VALUE).toBe('loaded-value');
    expect(env.VITE_MEDIA_ENGINE_API_URL).toBe('http://127.0.0.1:3000');
    expect(env.MULTILINE_VALUE).toBe('first\nsecond');
    expect(env.EXPORTED_VALUE).toBe('exported');
    expect(env['INVALID-KEY']).toBeUndefined();
  });

  it('does not search above the workspace root', () => {
    const parentDir = mkdtempSync(join(tmpdir(), 'media-engine-parent-'));
    const workspaceDir = join(parentDir, 'workspace');
    const nestedDir = join(workspaceDir, 'apps', 'api');
    const env: NodeJS.ProcessEnv = {};

    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(join(parentDir, '.env'), 'EXAMPLE_VALUE=parent-value\n');
    writeFileSync(join(workspaceDir, 'pnpm-workspace.yaml'), 'packages: []\n');

    expect(loadLocalEnv(nestedDir, env)).toBeUndefined();
    expect(env.EXAMPLE_VALUE).toBeUndefined();
  });
});
