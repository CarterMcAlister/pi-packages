import {
  registerSettingsCommand,
  type SettingsSection,
} from '@aliou/pi-utils-settings';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import type {
  BashSourceMode,
  FeatureMode,
  ResolvedExtensionConfig,
  ToolchainConfig,
} from '../config';
import { configLoader } from '../config';

type FeatureKey = keyof ResolvedExtensionConfig['features'];

const FEATURE_UI: Record<
  FeatureKey,
  { label: string; description: string; modes: FeatureMode[] }
> = {
  gitRebaseEditor: {
    label: 'Git rebase editor',
    description:
      'Inject GIT_EDITOR and GIT_SEQUENCE_EDITOR for non-interactive rebase (rewrite only)',
    modes: ['disabled', 'rewrite'],
  },
};

const BASH_SOURCE_MODES: BashSourceMode[] = ['override-bash', 'composed-bash'];

export function registerToolchainSettings(pi: ExtensionAPI): void {
  registerSettingsCommand<ToolchainConfig, ResolvedExtensionConfig>(pi, {
    commandName: 'toolchain:settings',
    title: 'Toolchain Settings',
    configStore: configLoader,
    buildSections: (
      tabConfig: ToolchainConfig | null,
      resolved: ResolvedExtensionConfig,
      _ctx,
    ): SettingsSection[] => {
      const featureItems = (Object.keys(FEATURE_UI) as FeatureKey[]).map(
        (key) => ({
          id: `features.${key}`,
          label: FEATURE_UI[key].label,
          description: FEATURE_UI[key].description,
          currentValue: tabConfig?.features?.[key] ?? resolved.features[key],
          values: FEATURE_UI[key].modes,
        }),
      );

      return [
        {
          label: 'Features',
          items: featureItems,
        },
        {
          label: 'Bash Integration',
          items: [
            {
              id: 'bash.sourceMode',
              label: 'Source mode',
              description:
                'override-bash: toolchain registers bash when rewrite is active. composed-bash: toolchain contributes rewrite hook to external bash composer.',
              currentValue:
                tabConfig?.bash?.sourceMode ?? resolved.bash.sourceMode,
              values: [...BASH_SOURCE_MODES],
            },
          ],
        },
      ];
    },
  });
}
