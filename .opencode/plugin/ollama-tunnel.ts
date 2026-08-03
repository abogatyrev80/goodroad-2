import { execSync, spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import type { Plugin } from "@opencode-ai/plugin"

function isTunnelRunning(): boolean {
  try {
    execSync("pgrep -f 'cloudflared tunnel'", { stdio: "pipe" })
    return true
  } catch {
    return false
  }
}

export default (({ directory }) => {
  try {
    if (isTunnelRunning()) return {}
    const script = join(directory, "backend", "ollama_tunnel.sh")
    if (!existsSync(script)) return {}
    const child = spawn("bash", [script], {
      detached: true,
      stdio: "ignore",
    })
    child.unref()
  } catch {}
  return {}
}) satisfies Plugin
