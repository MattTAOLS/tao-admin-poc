/** Rule titles from contracts/rules.yaml (read at build time). The file is data; only `id` and `title` are read,
 * with a line scan rather than a YAML dependency. */
import raw from '@contracts/rules.yaml?raw'

export function parseRuleTitles(yaml: string): Record<string, string> {
  const out: Record<string, string> = {}
  let id: string | null = null
  for (const line of yaml.split(/\r?\n/)) {
    const m = /^\s*-\s+id:\s*(R\d+)\s*$/.exec(line)
    if (m) { id = m[1]; continue }
    const t = /^\s+title:\s*(.+?)\s*$/.exec(line)
    if (t && id && !out[id]) out[id] = t[1].replace(/^["']|["']$/g, '')
  }
  return out
}

export const RULE_TITLES = parseRuleTitles(raw)
export const ruleTitle = (id: string) => RULE_TITLES[id] ?? id
