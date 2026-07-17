import { DEFAULT_CONFIG, LoggerConfigRegistry } from './logger.config';

describe('LoggerConfigRegistry', () => {
  it('merges partial file configuration with defaults', () => {
    const registry = new LoggerConfigRegistry({
      file: {
        enabled: true,
        directory: 'custom-logs',
      },
    });

    expect(registry.getFileConfig()).toEqual({
      ...DEFAULT_CONFIG.file,
      enabled: true,
      directory: 'custom-logs',
    });
  });

  it('does not expose mutable file configuration state', () => {
    const registry = new LoggerConfigRegistry();
    const fileConfig = registry.getFileConfig();

    fileConfig.enabled = true;

    expect(registry.getFileConfig().enabled).toBe(false);
  });
});
