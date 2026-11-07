import { cosmiconfig } from 'cosmiconfig';
import type { WipOptions } from './types.ts';

/**
 * Load options from the first config file found by cosmiconfig, searching from the current working directory up to
 * the user's home directory (`package.json` `"node-git-wip"` key, `.node-git-wiprc`, `.node-git-wiprc.json`,
 * `node-git-wip.config.js`, ...).
 */
export async function loadConfig(): Promise<WipOptions> {
  // cosmiconfig 9 only searches the start directory by default. 'global' restores the walk up to the home directory
  // that cosmiconfig 6 did.
  const result = await cosmiconfig('node-git-wip', { searchStrategy: 'global' }).search();
  const config: unknown = result?.config;
  return config && typeof config === 'object' ? (config as WipOptions) : {};
}
