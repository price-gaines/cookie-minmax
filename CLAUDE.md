# Cookie MinMax — Project Instructions

A native-feeling Cookie Clicker mod for min/max automation. Single hosted JS file loaded
via `Game.LoadMod(...)`. Inspired by FrozenCookies + ACABM (both MIT; clean-room, no copied code).

**Owner/GitHub:** `price-gaines`. Repo is/will be **public**: `price-gaines/cookie-minmax`.
Design spec: `docs/superpowers/specs/2026-06-25-cookie-clicker-mod-design.md` (read it first).

## Architecture (do not violate)

- Single file `src/minmax.js`; `Game.registerMod('minmax', {init,save,load})`.
- ONE `Game.registerHook('logic', tick)` scheduler drives all modules (no setInterval, no DOM-click simulation — that path caps at ~15/sec).
- UI via a **safe wrapper of `Game.UpdateMenu`**: call the ORIGINAL, then append our collapsible section to `#menu` when `Game.onMenu=='prefs'`.
- **Add-only. Never replace native game logic.** Wrapping-with-passthrough is allowed; reimplementing a native (what killed FrozenCookies via ReplaceNative.js) is not.
- Settings persist via the mod's own `save()`/`load()` (game writes them into its save string).

## Verified runtime facts (live, Cookie Clicker v2.058)

- `Game.ClickCookie()` self-throttles: success branch skipped when `now - Game.lastClick < 20ms`; `lastClick` set only on a successful click → looping it tops out ~50/sec (the ACABM ceiling).
- **Autoclick design (verified):** per tick `n = round(targetCps / Game.fps)`. Fire ONE real `ClickCookie()` after `Game.lastClick=0` (fires the `click` hook + one particle/sound), then BULK the rest: `Game.Earn(cpc*r); Game.handmadeCookies += cpc*r; Game.cookieClicks += r;` where `cpc = Game.computedMouseCps`, `r = n-1`.
  - Method A (lastClick reset + real ClickCookie, particles/sound off) measured **2.08M clicks/sec** and registers fully.
  - `Game.Earn()` ALONE does NOT register clicks — it misses `handmadeCookies` and `cookieClicks` (so click achievements wouldn't advance). Always bump all three.
- No native Options-menu hook (`Game.customOptionsMenu` undefined). CCSE provides one but is NOT guaranteed loaded → use the UpdateMenu wrapper.
- Hooks available: `logic, draw, reset, reincarnate, ticker, tickerFinal, cps, cpsMult, cookiesPerClick, click, create, check`. `shimmer.prototype.pop` is a function. 20 buildings.
- Payback: marginal CpS via toggle-on → recompute `Game.cookiesPs` → diff → revert. `PP = max(price - usableBank, 0)/cps + price/Δcps`; lowest PP wins. Bank protection: reserve cookies for Lucky!/Frenzy before spending.

## Live-testing protocol

Probe/test in a Chrome tab via the Claude-in-Chrome MCP, NOT the user's primary play tab.
A fresh `https://orteil.dashnet.org/cookieclicker/` load shares the same-origin save (localStorage).
**Immediately set `Game.prefs.autosave=0`** in the test tab so it can never overwrite the real save,
and snapshot/restore any state you mutate while probing.

## Ponytail mode is active

Lazy senior dev: reuse before building, stdlib/native first, shortest working diff, YAGNI,
mark deliberate simplifications with `// ponytail:` comments, leave one runnable check for
non-trivial logic.
