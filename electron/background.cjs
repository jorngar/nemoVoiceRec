// Starts a helper process at low priority. macOS: taskpolicy -b (background QoS, efficiency
// cores, throttled I/O — the class Spotlight uses; it execs in place, so signals reach the
// program). Elsewhere: the lowest normal scheduling priority.
const { spawn } = require("node:child_process");
const os = require("node:os");
function spawnBackground(binary, args, options) {
  if (process.platform === "darwin")
    return spawn("/usr/sbin/taskpolicy", ["-b", binary, ...args], options);
  const child = spawn(binary, args, options);
  if (child.pid)
    try {
      os.setPriority(child.pid, os.constants.priority.PRIORITY_LOW);
    } catch {}
  return child;
}
module.exports = { spawnBackground };
