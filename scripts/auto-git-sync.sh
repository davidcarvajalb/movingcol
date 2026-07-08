#!/usr/bin/env bash
set -u

REPO_DIR="${REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
INTERVAL_SECONDS="${1:-300}"
LOG_FILE="${LOG_FILE:-/tmp/movingcol-auto-git-sync.log}"
LOCK_DIR="${LOCK_DIR:-/tmp/movingcol-auto-git-sync.lock}"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S %z')" "$*" | tee -a "$LOG_FILE"
}

cleanup() {
  rmdir "$LOCK_DIR" 2>/dev/null || true
}

sync_once() {
  cd "$REPO_DIR" || {
    log "Cannot cd into repo: $REPO_DIR"
    return 1
  }

  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    log "Not a git work tree: $REPO_DIR"
    return 1
  fi

  if [ -d .git/rebase-merge ] || [ -d .git/rebase-apply ] || [ -f .git/MERGE_HEAD ]; then
    log "Repository is in a merge/rebase state; skipping this cycle."
    return 1
  fi

  if [ -n "$(git status --porcelain)" ]; then
    log "Changes detected; staging and committing."
    git add -A

    if git diff --cached --quiet; then
      log "No staged changes after git add."
    else
      git commit -m "chore(auto): sync local changes"
    fi
  else
    log "No local changes."
  fi

  local branch
  branch="$(git branch --show-current)"
  if [ -z "$branch" ]; then
    log "Detached HEAD; skipping pull/push."
    return 1
  fi

  if ! git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
    log "Branch $branch has no upstream; skipping pull/push."
    return 1
  fi

  log "Fetching and rebasing $branch."
  git fetch --prune

  if ! git pull --rebase --autostash; then
    log "Rebase failed; aborting rebase and leaving local commits intact."
    git rebase --abort >/dev/null 2>&1 || true
    return 1
  fi

  local ahead
  ahead="$(git rev-list --count '@{u}..HEAD')"
  if [ "$ahead" -gt 0 ]; then
    log "Pushing $ahead commit(s)."
    git push
  else
    log "Nothing to push."
  fi
}

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  log "Another auto-git-sync process is already running."
  exit 0
fi
trap cleanup EXIT

log "Starting auto git sync for $REPO_DIR every ${INTERVAL_SECONDS}s."

while true; do
  sync_once || true
  sleep "$INTERVAL_SECONDS"
done
