# Cookie MinMax — Design Spec

**Date:** 2026-06-25
**Status:** Approved (user delegated; design verified against live game source + runtime, Cookie Clicker v2.058)
**Repo:** `price-gaines/cookie-minmax` (public)

## Goal

A native-feeling Cookie Clicker mod that automates min/max play: autoclick the big
cookie at a chosen rate, auto-buy by payback period, auto-collect golden cookies and
wrinklers, plus sugar lumps, fortunes, dragon petting, minigames, and ascension —
each independently toggleable from the game's Options menu.

Inspired by FrozenCookies (FC) and ACABM, clean-room reimplemented. Both reference
mods are MIT; no code is copied.

## Loading

Single hosted file loaded via `Game.LoadMod("<jsDelivr/Pages URL>")` — bookmarklet or
Cookie Clicker Mod Manager. The file calls `Game.registerMod('minmax', {init,save,load})`.
Dev iteration loads a local copy from the console; shipping uses the committed URL.

## Architecture

```
src/minmax.js   (single file)
├─ framework
│  ├─ scheduler  — ONE Game.registerHook('logic', tick) loop (~30 fps).
│  │              Each module exposes tick(); scheduler calls them with per-module interval gating.
│  ├─ settings   — plain object; save() => JSON.stringify, load(str) => merge. Game persists it.
│  └─ ui         — safe wrapper of Game.UpdateMenu: calls the ORIGINAL, then appends our
│                  collapsible section to #menu when Game.onMenu=='prefs'.
└─ modules[]     — each {id, label, default settings, tick(), menu()}; off by default.
```

### Hard rule: add-only, never reimplement native logic

Behavior comes only from `registerHook`, the `UpdateMenu` wrapper (which **calls through**
to the original — it does not replace its logic), and direct API calls. We never swap a
native game function for a reimplementation. FC died because it *replaced*
`Game.UpdateWrinklers` et al. via ReplaceNative.js, and a later game version broke the
replacement. Wrapping-with-passthrough is safe; reimplementation is not.

### One scheduler, not N timers

A single `logic` hook drives every module. No `setInterval`, no DOM event simulation —
that DOM/timer path is exactly what capped ACABM at ~15/sec.

## Verified runtime facts (live, v2.058)

- `Game.ClickCookie()` self-throttles: the success branch is skipped when
  `now - Game.lastClick < 20ms`, and `lastClick` is set only on a successful click.
  Looping it therefore tops out ~50/sec → the ACABM ceiling.
- **Throttle bypass A:** set `Game.lastClick = 0` before each `ClickCookie()` → every call
  registers. Measured **2.08M clicks/sec** with particles/numbers/sound disabled. Fires the
  `click` mod-hook and full click semantics. Per-click particle/sound is the freeze source.
- **Bulk path B:** `Game.Earn(cpc*n); Game.handmadeCookies += cpc*n; Game.cookieClicks += n`
  — registers click *count*, the clicking stat, and click achievements. 1,000,000 in <1ms.
  Does not fire the `click` hook or any visual. (`Game.Earn()` alone is insufficient: it
  misses `handmadeCookies` and `cookieClicks`, so click achievements wouldn't advance.)
- No native Options-menu mod hook exists (`Game.customOptionsMenu` undefined). CCSE provides
  one but is not guaranteed loaded → we use the `UpdateMenu` wrapper instead.
- `Game.modHooksNames = [logic, draw, reset, reincarnate, ticker, tickerFinal, cps, cpsMult,
  cookiesPerClick, click, create, check]`. `shimmer.prototype.pop` present. 20 buildings.

## Modules (v1 = full FC/ACABM set)

| Module | Behavior |
|---|---|
| Auto-Click | Per tick: `n = round(targetCps / Game.fps)`. Fire **one** real `ClickCookie()` (lastClick reset) for the click hook + a single particle/sound, then **bulk** the remaining `n-1` (path B). Rate UI = 3-digit field × unit dropdown (as-written / K / M / B), up to 999B. |
| Auto-Buy | Payback-period ranking. Marginal CpS via toggle-on → recompute `Game.cookiesPs` → diff → revert (handles multiplier and multi-building upgrades). `PP = max(price - usableBank, 0)/cps + price/Δcps`; buy lowest PP when affordable. Bulk 1/10/100. |
| Golden Cookies | Auto `shimmer.pop()`; options: pop all / skip wrath / click-combo aware. |
| Wrinklers | Auto-pop; keep N / keep shiny options. |
| Sugar Lumps | Auto-harvest when ripe. |
| Fortune | Auto-click news-ticker fortunes. |
| Dragon (Krumblor) | Auto-pet for drops. |
| Minigames | Garden (auto-harvest/plant), Stock (buy-low/sell-high), Pantheon (swap gods), Grimoire (auto-cast). |
| Ascend | Auto-ascend at a cookie/prestige threshold; auto-spend heavenly chips by configurable order. |

### Bank protection

Auto-Buy must not drain cookies needed for Lucky! / Frenzy multipliers. Compute a reserve
( `usableBank = max(0, Game.cookies - luckyReserve)` ) and feed that into the PP `bank` term.

## Persistence

Settings live in the mod's `save()`/`load()`. No external storage. Each module's enabled
flag + parameters round-trip through the game's own save string.

## Testing

Each non-trivial unit (payback ranking, autoclick math, bank reserve) gets one runnable
assertion-style self-check. Integration tested by loading `minmax.js` into a live game tab
with autosave disabled, verifying the Options section renders and each toggle behaves.

## Out of scope (v1)

Cloud sync of settings, multi-profile presets, mobile/Steam builds, server features.
