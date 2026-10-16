# GitHub Copilot's PreToolUse hook on Windows. pre-tool-use.sh approves view
# and script calls and checks pstack agent models, and it is not ported to
# PowerShell. This script makes no decision: it prints nothing and exits 0, so
# each call takes Copilot's normal permission flow, as it does on Windows when
# the POSIX hook prints nothing. Copilot denies a call whose preToolUse hook
# exits non-zero, which is why this script exits 0 on every path.
exit 0
