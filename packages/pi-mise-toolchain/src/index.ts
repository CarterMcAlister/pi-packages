import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { setupBlockers } from './blockers';
import { registerToolchainSettings } from './commands/settings-command';
import {
  configLoader,
  queueIgnoredLegacyLocalConfigWarning,
  resolveRuntimeConfig,
} from './config';
import { registerBashIntegration } from './hooks/bash-integration';
import {
  hasRewriteFeatures,
  registerRewriteNotifications,
} from './hooks/rewrite-notifications';
import { registerSessionStartWarnings } from './hooks/session-start';
import { findProjectToolchainConfig } from './project-config';

/**
 * Toolchain Extension
 *
 * Enforces opinionated toolchain preferences per feature, each independently
 * set to one of three modes:
 *
 * - "disabled": no action taken
 * - "rewrite": transparently rewrite matching commands via spawn hook
 * - "block": block commands via tool_call hook
 *
 * Configuration:
 * - Global settings: ~/.pi/agent/extensions/toolchain.json
 * - Memory settings: session-only overrides via /toolchain:settings
 * - Project toolchain: nearest mise.toml
 */
export default async function (pi: ExtensionAPI) {
  queueIgnoredLegacyLocalConfigWarning();
  await configLoader.load();
  const extensionConfig = configLoader.getConfig();
  const projectConfig = await findProjectToolchainConfig();
  const config = resolveRuntimeConfig(extensionConfig, projectConfig);
  if (!config.enabled) return;

  registerToolchainSettings(pi);
  registerSessionStartWarnings(pi);
  setupBlockers(pi, config);
  registerRewriteNotifications(pi, config);

  if (!hasRewriteFeatures(config)) return;
  registerBashIntegration(pi, config);
}
