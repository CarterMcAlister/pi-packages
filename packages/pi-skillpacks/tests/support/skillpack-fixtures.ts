import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

export async function createTempSkillpackRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'skillpacks-'))
}

export async function writeSkill(
  rootDir: string,
  relativeDir: string,
): Promise<void> {
  const absoluteDir = join(rootDir, relativeDir)

  await mkdir(join(absoluteDir, 'templates'), { recursive: true })
  await writeFile(
    join(absoluteDir, 'SKILL.md'),
    `---\nname: ${relativeDir.replaceAll('/', '-')}\ndescription: fixture skill\n---\nFixture skill.\n`,
  )
  await writeFile(join(absoluteDir, 'templates', 'example.txt'), 'fixture')
}

export async function removeTempDir(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true })
}

export function toRelativePaths(
  rootDir: string,
  absolutePaths: string[],
): string[] {
  return absolutePaths
    .map((absolutePath) =>
      relative(rootDir, absolutePath).replaceAll('\\', '/'),
    )
    .sort()
}
