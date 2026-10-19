/**
 * The browser-sized copy of the `scrumit-sprint` agent skill.
 *
 * The source of truth is the `skills/scrumit-sprint/` directory at the
 * repository root, which is also what `scrumit skill install` copies into a
 * checkout. Vite inlines every file at build time; the glob is lazy so the skill
 * does not inflate first load.
 */

export const SPRINT_SKILL_FOLDER = 'scrumit-sprint'

const modules = import.meta.glob('../../skills/scrumit-sprint/**/*', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>

export interface SkillFile {
  /** Path relative to the skill directory, always posix-style. */
  path: string
  text: string
}

export async function loadSprintSkillFiles(): Promise<SkillFile[]> {
  const files = await Promise.all(
    Object.entries(modules).map(async ([file, load]) => ({
      path: file.replace('../../skills/scrumit-sprint/', ''),
      text: await load(),
    })),
  )
  return files
    .filter((file) => file.path !== 'manifest.json')
    .sort((a, b) => a.path.localeCompare(b.path))
}
