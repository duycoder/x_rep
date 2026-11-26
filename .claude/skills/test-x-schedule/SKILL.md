---
name: test-x-schedule
description: Test the extension's "schedule post on X" feature end to end in the user's real Brave browser (connect over CDP, reload the extension, check the Schedule dialog picks the next free slot, Confirm, verify text) without scheduling anything. Use when asked to test scheduling / hẹn giờ, or after changing content.js nextSlot/runScheduled, fbsave.js sched button, or xhook.js SCHED_RE.
---

# Test hẹn giờ đăng trên X

The user browses in **Brave**, not Edge or Chrome. Edge on port 9222 is a separate Google Flow automation profile: never use it for this.

## Run

```bash
node scripts/test-schedule.mjs --restart
```

- Connects to Brave on CDP port 9223 (`XCS_CDP_PORT` overrides).
- If Brave is open without that port, `--restart` closes and reopens it (tabs restore). **Ask the user before passing `--restart`** if they may be in the middle of something; without it the script asks y/N in a TTY, or exits.
- Finds the extension by its unpacked ID (sha256 of the folder path, UTF-16LE), reloads it so the current files run.
- Writes `schedPending` (same as the ⏰ button on Facebook), opens x.com/home, compares the dialog's selects with `nextSlot()` from storage (`schedList`, `schedGapMin`), clicks **Confirm only**, checks the test text survived and the button reads Schedule, then closes the tab (`--keep` leaves it open).
- Exit 0 = all checks passed. A screenshot path is printed; read it when something fails.

## Rules

- Never click **Schedule** / **Post**: that publishes to the user's real account (@MrdDailyX).
- If the script reports "chưa đăng nhập X" or the extension is missing, tell the user; don't log in or install for them.
- When X changes its UI and a check fails, compare the screenshot with the selectors in `content.js` (`scheduleSelects`, `runScheduled`) before changing the test.

The user double-clicks `scripts/test-schedule.bat` for the same thing without Claude.
