#!/usr/bin/env bash
# Run the hand-off checks on this worktree's own Boat sandbox instead of this computer.
#
#   scripts/boat-check.sh            the hand-off checks (what CI's test.yml runs; no key, no live calls)
#   scripts/boat-check.sh -- CMD...  run CMD in a fresh copy of the worktree instead
#   scripts/boat-check.sh --save     the hand-off checks, then save the sandbox as the warm
#                                    snapshot (jev-lab-warm) that new sandboxes start from
#   scripts/boat-check.sh --status   print this worktree's sandbox and its state (no start)
#   scripts/boat-check.sh --done     delete this worktree's sandbox; run it when your work ends
#
# Each worktree gets one long-lived sandbox, created on first use from jev-lab-warm (or cold
# when that snapshot isn't ready) and reused by every later check, so a check costs no
# sandbox start. Its id is kept in this worktree's git directory and never shared: another
# worktree or agent gets its own. Every check pushes the worktree (tracked and untracked,
# non-ignored files) into a fresh directory and runs there with `boat exec --timeout 0`.
# The sandbox stops by itself after JEV_BOAT_IDLE seconds without a check (default 2700);
# the next check resumes it, which costs one start. When the account's included starts are
# used up it stops instead of paying for an extra one (JEV_BOAT_PAID_START=1 allows that).
# Overrides: JEV_BOAT_SNAPSHOT, JEV_BOAT_TYPE (default: default) and JEV_BOAT_IDLE.
# See CONTRIBUTING.md#checks-on-boat.
main() {
set -euo pipefail
export BOAT_NO_UPDATE=1
snapshot=${JEV_BOAT_SNAPSHOT:-jev-lab-warm}
type=${JEV_BOAT_TYPE:-default}
idle=${JEV_BOAT_IDLE:-2700}
max_run=1800 # the auto-stop deadline during a check is idle + this, so a slow check isn't cut off
mode=checks cmd=""
while [ $# -gt 0 ]; do
    case "$1" in
        --save) mode=save ;;
        --status) mode=status ;;
        --done) mode=done ;;
        --) shift
            [ $# -gt 0 ] || { echo "boat-check: -- needs a command" >&2; exit 2; }
            if [ $# -eq 1 ]; then cmd=$1; else cmd=$(printf '%q ' "$@"); fi
            [ -n "$cmd" ] || { echo "boat-check: -- needs a command" >&2; exit 2; }
            mode=custom
            break ;;
        -h|--help) awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; exit 0 ;;
        *) echo "boat-check: unknown option $1 (try --help)" >&2; exit 2 ;;
    esac
    shift
done
case "$idle" in ''|*[!0-9]*) echo "boat-check: JEV_BOAT_IDLE must be a number of seconds" >&2; exit 2 ;; esac
for tool in boat jq git base64; do
    command -v "$tool" >/dev/null || { echo "boat-check: $tool is not installed" >&2; exit 2; }
done
root=$(git rev-parse --show-toplevel)
cd "$root"
gitdir=$(git rev-parse --absolute-git-dir) # per worktree, never pushed or committed
statefile="$gitdir/jev-lab-boat-sandbox"
name="jev-lab-check-$(basename "$root")"

if [ "$mode" = status ]; then
    id=$(cat "$statefile" 2>/dev/null || true)
    if [ -z "$id" ]; then echo "boat-check: this worktree has no sandbox"; exit 0; fi
    state=$(sandbox_state "$id") || exit 1
    echo "boat-check: $id ($state)"
    exit 0
fi

# One boat-check at a time per worktree: they share its sandbox. The lock is a symlink whose
# target is the holder's pid, so it is created with its owner in one atomic step.
lock="$gitdir/jev-lab-boat-lock"
busy() {
    echo "boat-check: another boat-check${1:+ (pid $1)} is using this worktree's sandbox; wait for it" >&2
    exit 2
}
if ! ln -s "$$" "$lock" 2>/dev/null; then
    other=$(readlink "$lock" 2>/dev/null || true)
    case "$other" in '' | *[!0-9]*) busy ;; esac
    ! kill -0 "$other" 2>/dev/null || busy "$other"
    # Its holder is gone. Take the lock over by renaming it, which only one process can do,
    # and only if the link renamed is still that stale one; put back a link that isn't.
    stale="$lock.stale.$$"
    mv "$lock" "$stale" 2>/dev/null || busy
    if [ "$(readlink "$stale" 2>/dev/null || true)" != "$other" ]; then
        ln -s "$(readlink "$stale")" "$lock" 2>/dev/null || true
        rm -f "$stale"
        busy
    fi
    rm -f "$stale"
    ln -s "$$" "$lock" 2>/dev/null || busy
fi
id=$(cat "$statefile" 2>/dev/null || true)
ran=0
cleanup() {
    set +e
    # Restart the idle timer from now, so the sandbox stops JEV_BOAT_IDLE seconds after the
    # last check rather than in the middle of the next one.
    if [ "$ran" = 1 ] && [ -n "$id" ]; then
        boat extend "$id" --ttl "$idle" --json >/dev/null 2>&1 ||
            echo "boat-check: couldn't reset the auto-stop timer of $id: boat extend $id --ttl $idle" >&2
    fi
    [ "$(readlink "$lock" 2>/dev/null || true)" != "$$" ] || rm -f "$lock"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

case "$mode" in
    done)
        if [ -z "$id" ]; then echo "boat-check: this worktree has no sandbox"; exit 0; fi
        out=$(boat delete "$id" --yes --json 2>&1) || [ "$(error_code "$out")" = not_found ] || {
            echo "boat-check: couldn't delete $id: boat delete $id --yes" >&2
            exit 1
        }
        rm -f "$statefile"
        echo "boat-check: deleted $id"
        exit 0 ;;
esac

# Saved Workbench tests and pictures are pushed as they are in the worktree and may hold real
# inputs (AGENTS.md), so anything there that isn't committed (untracked, staged or modified)
# stops the run. Committed ones are meant to be public.
uncommitted=$(git status --porcelain --untracked-files=all -- data/workbench)
if [ -n "$uncommitted" ]; then
    echo "boat-check: uncommitted files under data/workbench/ would be copied to Boat:" >&2
    echo "$uncommitted" | sed 's/^/  /' >&2
    echo "boat-check: commit them if they are fictional fixtures, or move them out of the worktree" >&2
    exit 2
fi

ensure_sandbox
ran=1
boat extend "$id" --ttl "$((idle + max_run))" --json >/dev/null

run="/home/user/jev-lab-runs/$(date -u +%Y%m%dT%H%M%SZ)-$$"
echo "boat-check: pushing $(basename "$root") to $id:$run" >&2
boat push "$id" . --to "$run" --json >/dev/null

if [ "$mode" = custom ]; then
    body=$(remote_setup)$'\n'"(
:
$cmd
)"
else
    body=$(remote_setup)$'\n'$(remote_checks)
fi
script="run=$(printf '%q' "$run")"$'\n'"$body"
b64=$(printf '%s' "$script" | base64 | tr -d '\n')
# Decode to a file first: a script read from stdin would lose lines to any step that reads stdin.
# --json and jq print the output the same way whether or not this runs in a terminal (stdout
# and stderr merged in order); boat exec still exits with the remote command's status.
set +e
boat exec "$id" --timeout 0 --json "f=\$(mktemp) && printf %s $b64 | base64 -d >\"\$f\" && bash \"\$f\"; s=\$?; rm -f \"\$f\"; exit \$s" |
    jq --unbuffered -j 'select(.type == "stdout" or .type == "stderr") | .data'
status=${PIPESTATUS[0]}
set -e
[ "$status" = 0 ] || exit "$status"
[ "$mode" = save ] || exit 0
save_snapshot
}

# Prints the sandbox's API state (ready, idle, running, archiving, archived, provisioning, ...),
# or "gone" when Boat no longer has it. Fails on any other error.
sandbox_state() {
    local out code
    if out=$(boat info "$1" --json 2>&1); then
        printf '%s\n' "$out" | jq -r '(.sandbox // .) | .state // "unknown"' 2>/dev/null || echo unknown
        return 0
    fi
    code=$(error_code "$out")
    case "$code" in
        not_found | snapshot_data_expired) echo gone ;;
        *) echo "boat-check: boat info $1 failed: $out" >&2; return 1 ;;
    esac
}

# The `code` of the JSON error line a failed boat command prints last.
error_code() { printf '%s\n' "$1" | tail -n 1 | jq -r '.code // empty' 2>/dev/null || true; }

# Creating or resuming a sandbox uses one of the account's starts, shared by every project. Once
# the included ones are used up, Boat either refuses or (with extra starts on) bills each start.
need_start() {
    local full
    full=$(boat limits --json 2>/dev/null | jq -r '.startWindowFull.short // empty' 2>/dev/null || true)
    [ -n "$full" ] || return 0
    if [ "${JEV_BOAT_PAID_START:-0}" = 1 ]; then
        echo "boat-check: no included starts are left; $1 uses a paid extra start (JEV_BOAT_PAID_START=1)" >&2
        return 0
    fi
    echo "boat-check: $1 needs a sandbox start, and the included ones are used up:" >&2
    printf '%s\n' "$full" | sed 's/^/  /' >&2
    echo "boat-check: try again later; JEV_BOAT_PAID_START=1 pays for an extra start if the account allows them" >&2
    exit 3
}

wait_state() { # wait_state ID: until the sandbox leaves a transitional state; prints the state
    local s deadline=$((SECONDS + 300))
    while :; do
        s=$(sandbox_state "$1") || return 1
        case "$s" in provisioning | provisioned | cloning | archiving) ;; *) echo "$s"; return 0 ;; esac
        [ "$SECONDS" -lt "$deadline" ] || { echo "$s"; return 0; }
        sleep 5
    done
}

# boat_start CMD...: a sandbox start (new or resume) with --fail-fast, retried for about a minute
# while Boat has no ready machine; a start refused that way doesn't count against the limits.
boat_start() {
    local out attempt=1
    while :; do
        if out=$("$@" --fail-fast --json 2>&1); then
            printf '%s\n' "$out"
            return 0
        fi
        if [ "$(error_code "$out")" != no_ready_machine ] || [ "$attempt" -ge 6 ]; then
            printf '%s\n' "$out"
            return 1
        fi
        echo "boat-check: Boat has no ready machine; retrying in 10 s ($attempt/5)" >&2
        attempt=$((attempt + 1))
        sleep 10
    done
}

ensure_sandbox() {
    local s out from=()
    if [ -n "$id" ]; then
        s=$(wait_state "$id") || exit 1
        case "$s" in
            ready | idle | running) return 0 ;;
            archived | error)
                need_start "resuming $id"
                echo "boat-check: resuming $id" >&2
                out=$(boat_start boat resume "$id" --ttl "$((idle + max_run))") || {
                    echo "boat-check: resuming $id failed:" >&2
                    printf '%s\n' "$out" | tail -n 5 >&2
                    exit 1
                }
                return 0 ;;
            gone)
                echo "boat-check: $id is gone; creating a new sandbox" >&2
                rm -f "$statefile"
                id="" ;;
            *)
                echo "boat-check: $id is $s; try again, or boat delete $id --yes and rm $statefile" >&2
                exit 1 ;;
        esac
    fi
    need_start "creating this worktree's sandbox"
    if boat snapshots --json 2>/dev/null | jq -e --arg n "$snapshot" '.named[]? | select(.name == $n and .status == "ready")' >/dev/null; then
        from=(--from "$snapshot")
        echo "boat-check: creating $name from $snapshot" >&2
    else
        echo "boat-check: no ready $snapshot snapshot, so this sandbox starts cold; --save makes one" >&2
    fi
    # --no-env: no GitHub token, agent logins or API keys (the offline checks need none, and so can
    # make no paid call), so the sandbox can also become the shared snapshot.
    out=$(boat_start boat new --no-env --type "$type" --ttl "$((idle + max_run))" --name "$name" ${from[@]+"${from[@]}"}) || true
    # || true: output that isn't JSON (an auth or network error) must still reach the report below.
    id=$(printf '%s\n' "$out" | jq -r 'select(.event == "ready") | .id // empty' 2>/dev/null | head -n 1) || true
    if [ -z "$id" ]; then
        local any
        any=$(printf '%s\n' "$out" | jq -r '.id // empty' 2>/dev/null | head -n 1) || true
        [ -z "$any" ] || echo "$any" >"$statefile"
        echo "boat-check: creating the sandbox failed:" >&2
        printf '%s\n' "$out" | tail -n 5 >&2
        exit 1
    fi
    echo "$id" >"$statefile"
    echo "boat-check: created $id" >&2
}

# Installs what the sandbox lacks: a no-op on the warm snapshot apart from relinking. Shared
# state lives in ~/.jev-lab (Python venv, Biome) and uv's own caches, so a fresh checkout
# reuses it; each run deletes the checkouts of earlier runs.
remote_setup() {
    cat <<'EOF'
set -euo pipefail
export PATH="$HOME/.local/bin:$HOME/.local/node/bin:$PATH"
export UV_PROJECT_ENVIRONMENT="$HOME/.jev-lab/venv" UV_LINK_MODE=copy NO_COLOR=1
deps="$HOME/.jev-lab"
mkdir -p "$deps"
find "$HOME/jev-lab-runs" -mindepth 1 -maxdepth 1 ! -path "$run" -exec rm -rf {} +
if ! command -v uv >/dev/null; then
    curl -LsSf https://astral.sh/uv/install.sh | env UV_NO_MODIFY_PATH=1 sh >/dev/null
fi
# CI runs Node 22.
if [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" != 22 ]; then
    case "$(uname -m)" in x86_64) arch=x64 ;; aarch64 | arm64) arch=arm64 ;; *) echo "unsupported CPU $(uname -m)" >&2; exit 2 ;; esac
    base=https://nodejs.org/dist/latest-v22.x
    tmp=$(mktemp -d)
    curl -fsSL "$base/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
    file=$(awk -v want="linux-$arch.tar.xz" 'substr($2, length($2) - length(want) + 1) == want { print $2; exit }' "$tmp/SHASUMS256.txt")
    curl -fsSL "$base/$file" -o "$tmp/$file"
    (cd "$tmp" && grep "  $file\$" SHASUMS256.txt | sha256sum -c --quiet)
    rm -rf "$HOME/.local/node" && mkdir -p "$HOME/.local/node"
    tar -xJf "$tmp/$file" --strip-components=1 -C "$HOME/.local/node"
    rm -rf "$tmp"
fi
uv python install 3.9 --quiet # the stdlib-fallback tests (AGENTS.md)
cd "$run"
uv sync --locked --quiet
if [ ! -d "$deps/node/node_modules" ] || ! cmp -s package-lock.json "$deps/node/package-lock.json"; then
    rm -rf "$deps/node" && mkdir -p "$deps/node"
    cp package.json package-lock.json "$deps/node/"
    (cd "$deps/node" && npm ci --no-audit --no-fund --loglevel=error)
fi
# Biome reads .gitignore through git, and the sample-picture check diffs against the index.
git -c init.defaultBranch=main init -q && git add -A
ln -sfn "$deps/node/node_modules" node_modules
echo "boat-check: $(uv run --locked python --version), Node $(node --version), $(nproc) vCPUs" >&2
EOF
}

# The jobs of .github/workflows/test.yml, all run even when one fails.
remote_checks() {
    cat <<'EOF'
failed=()
check() {
    local label=$1
    shift
    printf '\n::: %s\n' "$label" >&2
    if ! (eval "$*"); then failed+=("$label"); fi
}
check "Ruff" 'uv run --locked ruff check && uv run --locked ruff format --check'
check "Biome" 'npm run --silent lint -- --colors=off --diagnostic-level=error'
check "JavaScript syntax" 'for file in $(find static/js -name "*.js" | sort); do node --input-type=module --check <"$file" || exit 1; done'
check "JavaScript tests" 'node --test --test-reporter=dot tests/js/*.test.mjs tests/js/lab/*.test.mjs'
check "Python tests (locked SDK)" 'uv run --locked python -m unittest discover tests'
check "Python 3.9 (stdlib fallback)" 'uv run --no-project --python 3.9 python -m unittest discover tests'
check "Sample pictures" 'python3 scripts/draw_samples.py && git add --intent-to-add static/img/samples && git diff --exit-code --stat static/img/samples'
if [ ${#failed[@]} -gt 0 ]; then
    printf 'boat-check: FAILED: %s\n' "${failed[@]}" >&2
    exit 1
fi
echo "boat-check: all hand-off checks passed" >&2
EOF
}

# Refresh the warm snapshot from this sandbox once the checks passed: drop the checkouts so it
# keeps only the toolchain, uv's caches and Python 3.9, the venv and Biome, then wait for this
# save (a new snapshotId under the name) to read ready.
save_snapshot() {
    local old state="" deadline=$((SECONDS + 600))
    boat exec "$id" --timeout 120 'rm -rf "$HOME/jev-lab-runs" && sync' >/dev/null
    old=$(boat snapshots --json 2>/dev/null | jq -r --arg n "$snapshot" '[.named[]? | select(.name == $n) | .snapshotId][0] // ""' || true)
    echo "boat-check: saving $id as $snapshot" >&2
    boat snapshot "$id" "$snapshot" --json >/dev/null || { echo "boat-check: saving $snapshot failed" >&2; exit 1; }
    while :; do # poll once more after the deadline before giving up
        state=$(boat snapshots --json 2>/dev/null | jq -r --arg n "$snapshot" --arg old "$old" \
            '[.named[]? | select(.name == $n and .snapshotId != $old) | .status][0] // ""' || true)
        case "$state" in ready | failed) break ;; esac
        [ "$SECONDS" -lt "$deadline" ] || break
        sleep 5
    done
    case "$state" in
        ready) echo "boat-check: saved $snapshot" >&2 ;;
        failed) echo "boat-check: saving $snapshot failed (boat snapshots shows why)" >&2; exit 1 ;;
        *) echo "boat-check: $snapshot isn't ready after about 10 minutes; check boat snapshots" >&2; exit 1 ;;
    esac
}

main "$@"; exit
