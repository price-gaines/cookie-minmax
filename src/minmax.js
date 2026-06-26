// Cookie MinMax — native min/max automation mod for Cookie Clicker.
// Load via: Game.LoadMod("<hosted-url>/minmax.js")
// Design + verified runtime facts: docs/superpowers/specs/2026-06-25-cookie-clicker-mod-design.md
//
// Hard rule: ADD-ONLY. We register hooks, wrap Game.UpdateMenu with passthrough, and call
// public Game APIs. We never replace native game *logic* (that is what killed FrozenCookies).

(function () {
	'use strict';

	var VERSION = '0.7.6';
	var MOD_ID = 'IIHKH';

	// ---- settings (persisted via mod save/load) -----------------------------
	// Defaults. load() deep-merges the saved object over these.
	var settings = {
		master: true,
		click:    { on: false, value: 1, unit: 'none' },   // value 1-999 * unit
		// autobuy: patient=false drains every affordable item in payback order each tick
		// (fast); patient=true saves up for the single best-payback item (FrozenCookies style).
		autobuy:  { on: false, protect: true, buildings: true, upgrades: true, patient: false, maxBuys: 200, rate: 2, bulk: 1 },
		golden:   { on: false, popWrath: false, popReindeer: true },
		wrink:    { on: false, keepShiny: true, keepCount: 0 },
		lump:     { on: false },
		fortune:  { on: false },
		dragon:   { on: false },
		// grimoire: auto-cast a spell at full magic. Default 'conjure baked goods'
		// (free cookies, no backfire). Other spells can backfire — opt in knowingly.
		grimoire: { on: false, spell: 'conjure baked goods' },
		garden:   { on: false },
	};

	var UNIT = { none: 1, K: 1e3, M: 1e6, B: 1e9, T: 1e12 };

	function targetCps() {
		var v = Math.max(0, Math.min(999, parseInt(settings.click.value) || 0));
		return v * (UNIT[settings.click.unit] || 1);
	}

	// ---- modules -------------------------------------------------------------
	// Each: {id, label, interval (logic frames between ticks), tick(), menu()}.
	// Game.fps is 30, so interval 30 ~= once/sec, 150 ~= once/5s.

	var clickAcc = 0; // fractional-click accumulator for sub-fps target rates

	var modules = [
		{
			id: 'click', label: 'Auto-Click', interval: 1,
			tick: function () {
				var target = targetCps();
				if (target <= 0) return;
				clickAcc += target / Game.fps;
				var n = Math.floor(clickAcc);
				if (n < 1) return;
				clickAcc -= n;
				// One REAL click: bypass the ~50/sec throttle (lastClick guard) so it
				// registers, and fire the click mod-hook + a single particle/sound.
				Game.lastClick = 0;
				Game.ClickCookie();
				// Bulk the remainder: registers count + clicking stat + click achievements
				// without per-click visual/sound. (Earn alone would miss the two counters.)
				if (n > 1) {
					var cpc = Game.computedMouseCps, r = n - 1;
					Game.Earn(cpc * r);
					Game.handmadeCookies += cpc * r;
					Game.cookieClicks += r;
				}
			},
			menu: function () {
				return row('click',
					'Click rate: ' +
					numField('click.value', settings.click.value) +
					unitSelect('click.unit', settings.click.unit) +
					' = ' + Beautify(targetCps()) + '/sec target');
			},
		},

		{
			id: 'golden', label: 'Auto Golden Cookies', interval: 3,
			tick: function () {
				for (var i = Game.shimmers.length - 1; i >= 0; i--) {
					var s = Game.shimmers[i];
					if (!s) continue;
					if (s.type === 'golden' && s.wrath && !settings.golden.popWrath) continue;
					if (s.type === 'reindeer' && !settings.golden.popReindeer) continue;
					s.pop();
				}
			},
			menu: function () {
				return row('golden', 'Pop golden cookies' +
					check('golden.popWrath', settings.golden.popWrath, 'incl. wrath') +
					check('golden.popReindeer', settings.golden.popReindeer, 'incl. reindeer'));
			},
		},

		{
			id: 'wrink', label: 'Auto Wrinklers', interval: 150,
			tick: function () {
				var list = [];
				for (var i in Game.wrinklers) {
					var w = Game.wrinklers[i];
					if (w && w.phase > 0 && w.hp > 0) list.push(w);
				}
				if (settings.wrink.keepShiny) list = list.filter(function (w) { return w.type !== 1; });
				var keep = Math.max(0, parseInt(settings.wrink.keepCount) || 0);
				for (var j = 0; j < list.length - keep; j++) list[j].hp = -10; // game collects on next update
			},
			menu: function () {
				return row('wrink', 'Pop wrinklers' +
					check('wrink.keepShiny', settings.wrink.keepShiny, 'keep shiny') +
					' keep ' + numField('wrink.keepCount', settings.wrink.keepCount, 2));
			},
		},

		{
			id: 'lump', label: 'Auto Sugar Lump', interval: 150,
			req: 'sugar lumps unlocked',
			avail: function () { return !!(Game.canLumps && Game.canLumps()); },
			tick: function () {
				if (Game.canLumps && Game.canLumps() &&
					(Date.now() - Game.lumpT) >= Game.lumpRipeAge) {
					Game.clickLump(); // guaranteed harvest once ripe
				}
			},
			menu: function () { return row('lump', 'Harvest sugar lump when ripe'); },
		},

		{
			id: 'fortune', label: 'Auto Fortune', interval: 15,
			tick: function () {
				if (Game.TickerEffect && Game.TickerEffect.type === 'fortune' && Game.tickerL) {
					// Trigger the game's own ticker click handler (add-only).
					Game.tickerL.dispatchEvent(new MouseEvent('click', { bubbles: true }));
				}
			},
			menu: function () { return row('fortune', 'Click news-ticker fortunes'); },
		},

		{
			id: 'dragon', label: 'Auto Pet Dragon', interval: 30,
			req: "'Pet the dragon' heavenly upgrade",
			avail: function () { return !!Game.Has('Pet the dragon'); },
			tick: function () {
				// ponytail: only pets while the dragon panel is open (drop logic requires it).
				// Auto-opening the special menu would hijack the user's UI; left as upgrade path.
				if (Game.specialTab === 'dragon' && Game.dragonLevel >= 4 &&
					Game.Has('Pet the dragon')) Game.ClickSpecialPic();
			},
			menu: function () { return row('dragon', 'Pet Krumblor (dragon panel open)'); },
		},

		{
			id: 'autobuy', label: 'Auto-Buy (payback)',
			// User-adjustable speed: rate = evaluations/sec. Each eval runs the
			// expensive marginal-CpS pass, so higher = more reactive, more CPU.
			interval: function () { return Math.max(1, Math.round(Game.fps / (settings.autobuy.rate || 2))); },
			tick: function () { autoBuyTick(); },
			menu: function () {
				var s = settings.autobuy;
				return row('autobuy', 'Buy by payback period' +
					check('autobuy.buildings', s.buildings, 'buildings') + bulkSelect('autobuy.bulk', s.bulk) +
					check('autobuy.upgrades', s.upgrades, 'upgrades') +
					check('autobuy.protect', s.protect, 'protect Lucky!/Frenzy bank') +
					check('autobuy.patient', s.patient, s.patient ? 'patient (save for best)' : 'fast (drain affordable)') +
					' speed ' + numField('autobuy.rate', s.rate, 2) + '/sec') +
					'<div class="listing" style="padding-left:18px;opacity:.85;" id="minmaxNext">' + nextReadout() + '</div>';
			},
		},

		{
			id: 'grimoire', label: 'Auto Grimoire', interval: 30,
			req: 'Wizard Tower Lvl 1',
			avail: function () {
				var w = Game.Objects['Wizard tower'];
				return !!(w && w.minigameLoaded);
			},
			tick: function () {
				var M = Game.Objects['Wizard tower'].minigame;
				var spell = M.spells[settings.grimoire.spell];
				if (!spell) return;
				// cost = max(costMin, magicM*costPercent). Only cast at full magic:
				// maximizes value per cast and guarantees affordability.
				var cost = Math.max(spell.costMin, M.magicM * spell.costPercent);
				if (M.magic >= M.magicM && M.magic >= cost) M.castSpell(spell);
			},
			menu: function () {
				return row('grimoire', 'Cast at full magic: ' +
					spellSelect('grimoire.spell', settings.grimoire.spell));
			},
		},

		{
			id: 'garden', label: 'Auto Garden', interval: 30,
			req: 'Farm Lvl 1',
			avail: function () {
				var f = Game.Objects['Farm'];
				return !!(f && f.minigameLoaded);
			},
			tick: function () {
				// Native harvestAll(type, mature, mortal): 0=all types, mature-only,
				// mortal-only -> harvests ripe non-immortal plants, leaves immortals
				// and still-growing tiles. Add-only; prevents decay-death losses.
				Game.Objects['Farm'].minigame.harvestAll(0, 1, 1);
			},
			menu: function () { return row('garden', 'Harvest mature plants (keeps immortals)'); },
		},
	];

	// ---- payback engine ------------------------------------------------------
	// Marginal CpS by toggle-on -> recompute Game.cookiesPs -> diff -> revert.
	// Handles multiplier and multi-building upgrades that price/storedTotalCps misses.

	function recalcPs() { Game.CalculateGains(); return Game.cookiesPs; }

	function marginalBuilding(obj, base, n) {
		obj.amount += n; var p = recalcPs();
		obj.amount -= n; recalcPs();
		return p - base;
	}
	function marginalUpgrade(u, base) {
		var b = u.bought, un = u.unlocked;
		u.bought = 1; u.unlocked = 1; var p = recalcPs();
		u.bought = b; u.unlocked = un; recalcPs();
		return p - base;
	}

	// Frenzy-aware Lucky! bank reserve (community-tuned: cps*1200, *7 outside Frenzy so a
	// future Frenzy+Lucky pays its cap). No point reserving without the "Get lucky" upgrade.
	function luckyReserve() {
		if (!settings.autobuy.protect || !Game.Has('Get lucky')) return 0;
		var mult = Game.hasBuff('Frenzy') ? 1 : 7;
		return mult * Game.cookiesPs * 1200;
	}

	var SKIP_POOLS = { toggle: 1, debug: 1, prestige: 1 };

	// PP = max(price - usableBank, 0)/cps + price/dcps ; lower is better.
	function pp(price, dcps, cps, usableBank) {
		if (dcps <= 0) return Infinity;
		return Math.max(price - usableBank, 0) / cps + price / dcps;
	}

	// Rank every candidate once (the expensive marginal-cps pass), then drain cheaply.
	function rankItems(cps, usable, base) {
		var items = [], i, s = settings.autobuy, n = s.bulk || 1;
		// Buildings: evaluate + price the chosen bulk size (1/10/100) as a unit.
		if (s.buildings) for (i = 0; i < Game.ObjectsById.length; i++) {
			var o = Game.ObjectsById[i]; if (!o || o.locked) continue;
			var d = marginalBuilding(o, base, n);
			items.push({ pp: pp(o.getSumPrice(n), d, cps, usable), obj: o, isBld: true, n: n });
		}
		if (s.upgrades) for (i = 0; i < Game.UpgradesInStore.length; i++) {
			var u = Game.UpgradesInStore[i]; if (!u || SKIP_POOLS[u.pool]) continue;
			var du = marginalUpgrade(u, base);
			items.push({ pp: pp(u.getPrice(), du, cps, usable), obj: u, isBld: false, n: 1 });
		}
		items.sort(function (a, b) { return a.pp - b.pp; });
		return items;
	}

	function autoBuyTick() {
		var cps = Game.cookiesPs;
		if (cps <= 0) return;
		var base = recalcPs();
		var reserve = luckyReserve();
		var ranked = rankItems(cps, Math.max(0, Game.cookies - reserve), base);
		var bought = 0, max = settings.autobuy.maxBuys, patient = settings.autobuy.patient;

		// Walk best-payback first. Fast mode (default): buy every item affordable now -> drains
		// the cheap backlog in one tick instead of one buy/sec. Patient mode: only the single
		// best item, saving up for it (skips cheaper-but-worse buys).
		for (var i = 0; i < ranked.length && bought < max; i++) {
			var it = ranked[i];
			if (it.pp === Infinity) break; // no positive-CpS items left
			// Re-price each pass: building prices climb as we buy. Buildings buy in
			// the chosen bulk size (getSumPrice(n) -> buy(n)); upgrades are one-shot.
			while (bought < max &&
				(it.isBld ? it.obj.getSumPrice(it.n) : it.obj.getPrice()) <= Game.cookies - reserve) {
				it.obj.buy(it.isBld ? it.n : 1); bought += it.isBld ? it.n : 1;
				if (!it.isBld) break;
			}
			if (patient) break;                       // saved for the best; stop
		}
	}

	// ---- "next buy" readout (what auto-buy targets next + ETA) ----------------
	// Ranking calls Game.CalculateGains() per candidate — that belongs in the LOGIC
	// loop, never the draw loop (calling it mid-render corrupts the menu). So the
	// expensive pass runs from onLogic (throttled ~0.8s) and just caches the top
	// pick; the readout + ETA are then cheap, side-effect-free string building.
	var _next = { t: 0, top: null };
	function refreshNextTarget() {
		var now = Date.now();
		if (now - _next.t < 800) return;
		_next.t = now;
		var cps = Game.cookiesPs;
		if (cps <= 0) { _next.top = null; return; }
		var base = recalcPs();
		var ranked = rankItems(cps, Math.max(0, Game.cookies - luckyReserve()), base);
		_next.top = (ranked.length && ranked[0].pp !== Infinity) ? ranked[0] : null;
	}
	function fmtTime(s) {
		if (s <= 0) return 'now';
		if (s < 60) return Math.ceil(s) + 's';
		if (s < 3600) return Math.floor(s / 60) + 'm ' + Math.ceil(s % 60) + 's';
		if (s < 86400) return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
		return Math.floor(s / 86400) + 'd ' + Math.floor((s % 86400) / 3600) + 'h';
	}
	function nextReadout() {
		var it = _next.top;          // pure display: read the cached pick, no ranking here
		if (!it) return 'next: <span style="opacity:.6;">nothing worth buying</span>';
		var price = it.isBld ? it.obj.getSumPrice(it.n) : it.obj.getPrice();
		var name = it.isBld ? (it.obj.name + (it.n > 1 ? ' ×' + it.n : '')) : (it.obj.name + ' (upgrade)');
		var need = price + luckyReserve() - Game.cookies;
		var eta = (Game.cookiesPs > 0) ? fmtTime(need / Game.cookiesPs) : '—';
		return 'next: <b>' + name + '</b> — ' + Beautify(price) + ' in ' + eta;
	}
	// Live countdown: the menu is built once, so refresh just this line each frame.
	function onDraw() {
		if (Game.onMenu !== 'prefs') return;
		try {
			var el = document.getElementById('minmaxNext');
			if (el) el.innerHTML = nextReadout();   // cheap, side-effect-free
		} catch (e) {}
	}

	// ---- scheduler -----------------------------------------------------------
	var frame = 0;
	function onLogic() {
		// Keep the auto-buy readout fresh even when automation is off — runs in the
		// logic loop so CalculateGains is called where it's safe (throttled inside).
		if (Game.onMenu === 'prefs') { try { refreshNextTarget(); } catch (e) {} }
		if (!settings.master) return;
		frame++;
		for (var i = 0; i < modules.length; i++) {
			var m = modules[i];
			if (!settings[m.id] || !settings[m.id].on) continue;
			if (m.avail && !m.avail()) continue; // prerequisite not unlocked in this save
			var iv = (typeof m.interval === 'function') ? m.interval() : m.interval; // dynamic (autobuy speed)
			if (frame % (iv < 1 ? 1 : iv) !== 0) continue;
			try { m.tick(); } catch (e) { console.error('[MinMax] ' + m.id + ' tick:', e); }
		}
	}

	// ---- menu UI (safe wrapper of Game.UpdateMenu) ---------------------------
	function getSetting(path) {
		var p = path.split('.'), o = settings;
		for (var i = 0; i < p.length - 1; i++) o = o[p[i]];
		return { obj: o, key: p[p.length - 1] };
	}

	// Public surface for inline onclick/onchange handlers (run in global scope).
	window.MinMax = {
		version: VERSION,
		settings: settings,
		toggle: function (id) {
			var m = modById(id);
			if (m && m.avail && !m.avail()) return; // can't enable a locked module
			settings[id].on = !settings[id].on; Game.UpdateMenu();
		},
		set: function (path, val) {
			var s = getSetting(path), cur = s.obj[s.key];
			s.obj[s.key] = (typeof cur === 'boolean') ? !cur :
				(typeof cur === 'number') ? (parseFloat(val) || 0) : val;
			Game.UpdateMenu();
		},
		// Manual-only ascension. NEVER scheduled — fires solely from the menu
		// button. Game.Ascend() pops the game's own confirm screen; the user
		// commits the destructive reset there, not us.
		ascend: function () { if (typeof Game.Ascend === 'function') Game.Ascend(); },
		_test: selfTest,
	};

	function onoff(on) { return on ? 'ON' : 'OFF'; }
	function modById(id) {
		for (var i = 0; i < modules.length; i++) if (modules[i].id === id) return modules[i];
		return null;
	}
	function row(id, body) {
		var m = modById(id);
		if (m && m.avail && !m.avail()) // prerequisite not unlocked: grey out, no toggle
			return '<div class="listing"><a class="option off" style="opacity:.45;cursor:default;">[—] ' +
				m.label + '</a> <span style="opacity:.55;">(requires ' + (m.req || 'unlock') + ')</span></div>';
		var on = settings[id] && settings[id].on;
		return '<div class="listing"><a class="option' + (on ? '' : ' off') +
			'" ' + Game.clickStr + '="MinMax.toggle(\'' + id + '\');">[' + onoff(on) +
			'] ' + (m ? m.label : id) + '</a> ' + body + '</div>';
	}
	function numField(path, val, size) {
		size = size || 3;
		return '<input type="text" style="width:' + (size * 12) + 'px;text-align:center;" value="' +
			val + '" onchange="MinMax.set(\'' + path + '\',this.value);" ' +
			'onkeyup="if(event.key===\'Enter\')this.blur();"/>';
	}
	function unitSelect(path, val) {
		var opts = ['none', 'K', 'M', 'B', 'T'], s = '<select onchange="MinMax.set(\'' + path + '\',this.value);">';
		for (var i = 0; i < opts.length; i++)
			s += '<option value="' + opts[i] + '"' + (opts[i] === val ? ' selected' : '') + '>' +
				(opts[i] === 'none' ? '×1' : '×' + opts[i]) + '</option>';
		return s + '</select>';
	}
	// building bulk-size dropdown: 1x / 10x / 100x (value is numeric).
	function bulkSelect(path, val) {
		var opts = [1, 10, 100], s = '<select onchange="MinMax.set(\'' + path + '\',this.value);">';
		for (var i = 0; i < opts.length; i++)
			s += '<option value="' + opts[i] + '"' + (opts[i] === val ? ' selected' : '') + '>' +
				opts[i] + '×</option>';
		return s + '</select>';
	}
	// spell dropdown — only rendered when the Grimoire is loaded (module avail() gates it).
	function spellSelect(path, val) {
		var w = Game.Objects['Wizard tower'];
		var M = w && w.minigame;
		// Grimoire minigame may not be loaded (other mods / not yet built); don't crash the menu.
		if (!M || !M.spells) return '<span style="opacity:.6;">Grimoire not loaded</span>';
		var s = '<select onchange="MinMax.set(\'' + path + '\',this.value);">';
		for (var k in M.spells)
			s += '<option value="' + k + '"' + (k === val ? ' selected' : '') + '>' + M.spells[k].name + '</option>';
		return s + '</select>';
	}
	function check(path, val, label) {
		return ' <a class="option' + (val ? '' : ' off') + '" ' + Game.clickStr +
			'="MinMax.set(\'' + path + '\');">[' + (val ? '✓' : '✗') + '] ' + label + '</a>';
	}

	function buildMenu() {
		var menu = document.getElementById('menu');
		if (!menu || document.getElementById('minmaxMenu')) return;
		var html = '<div class="subsection" id="minmaxMenu"><div class="title">' +
			'IdlerIHardlyKnowHer v' + VERSION + '</div>' +
			'<div class="listing"><a class="option' + (settings.master ? '' : ' off') + '" ' +
			Game.clickStr + '="MinMax.toggle(\'master\');">[' + onoff(settings.master) +
			'] Master switch</a></div>';
		// Per-module guard: one bad menu() can never blank the whole section again.
		for (var i = 0; i < modules.length; i++) {
			try { html += modules[i].menu(); }
			catch (e) { console.log('[MinMax] module menu (' + modules[i].id + '): ' + e); }
		}
		// Manual ascend button (not a scheduled module). Shows projected prestige gain.
		var gain = Math.floor(Game.HowMuchPrestige(Game.cookiesReset + Game.cookiesEarned) - Game.prestige);
		html += '<div class="listing"><a class="option" ' + Game.clickStr +
			'="MinMax.ascend();">[ASCEND NOW]</a> <span style="opacity:.7;">manual reset — +' +
			Beautify(Math.max(0, gain)) + ' prestige (game asks you to confirm)</span></div>';
		html += '</div>';
		menu.insertAdjacentHTML('beforeend', html);
	}
	// master isn't a module; give it a {on} shape so toggle() works.
	settings.master = settings.master; // (already boolean) — wrap for toggle:
	(function () {
		var v = settings.master;
		Object.defineProperty(settings, 'master', {
			get: function () { return v; }, set: function (x) { v = x; }, enumerable: true,
		});
	})();
	// allow MinMax.toggle('master')
	var _toggle = window.MinMax.toggle;
	window.MinMax.toggle = function (id) {
		if (id === 'master') { settings.master = !settings.master; Game.UpdateMenu(); return; }
		_toggle(id);
	};

	function wrapMenu() {
		if (Game.UpdateMenu._minmax) return;
		var orig = Game.UpdateMenu;
		Game.UpdateMenu = function () {
			orig.apply(this, arguments);
			try { if (Game.onMenu === 'prefs') buildMenu(); }
			catch (e) { console.error('[MinMax] menu:', e); }
		};
		Game.UpdateMenu._minmax = true;
	}

	// ---- self-check (runnable: MinMax._test()) -------------------------------
	function selfTest() {
		function assert(c, m) { if (!c) throw new Error('selfTest: ' + m); }
		// PP ordering: cheaper-per-cps wins; bank covers price -> first term 0.
		assert(pp(100, 10, 1, 0) > pp(100, 20, 1, 0), 'higher dcps should be better');
		assert(pp(100, 10, 1, 1000) < pp(100, 10, 1, 0), 'bank coverage lowers PP');
		assert(pp(100, 0, 1, 0) === Infinity, 'zero dcps -> Infinity');
		// unit resolution
		var sv = settings.click.value, su = settings.click.unit;
		settings.click.value = 50; settings.click.unit = 'M';
		assert(targetCps() === 50e6, 'unit math 50M');
		settings.click.value = 999; settings.click.unit = 'B';
		assert(targetCps() === 999e9, 'unit math 999B');
		settings.click.value = sv; settings.click.unit = su;
		var pr = settings.autobuy.protect; settings.autobuy.protect = false;
		assert(luckyReserve() === 0, 'protect off -> no reserve'); settings.autobuy.protect = pr;
		assert(fmtTime(0) === 'now' && fmtTime(45) === '45s' && fmtTime(90).indexOf('1m') === 0, 'fmtTime');
		console.log('[MinMax] selfTest OK');
		return true;
	}

	// ---- register ------------------------------------------------------------
	Game.registerMod(MOD_ID, {
		name: 'IdlerIHardlyKnowHer',
		init: function () {
			wrapMenu();
			Game.registerHook('logic', onLogic);
			Game.registerHook('draw', onDraw);
			selfTest();
			console.log('[MinMax] v' + VERSION + ' loaded.');
		},
		save: function () { return JSON.stringify(settings); },
		load: function (str) {
			try {
				var s = JSON.parse(str);
				for (var k in s) if (settings[k] && typeof settings[k] === 'object')
					for (var j in s[k]) settings[k][j] = s[k][j];
				else if (k in settings) settings[k] = s[k];
			} catch (e) { console.error('[MinMax] load:', e); }
		},
	});
})();
