"""
Controlled test: extract description selector from the Cerro Colorado detail page.
Target text: 'Primer condominio Mivivienda con sistema eco amigable en Arequipa...'
Compares Playwright's data-id vs CSS inline styles in Chrome's HTML (which also shows 8ab0bf4).
"""
import asyncio
import re as _re
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeoutError

URL = "https://cissacperu.com/proyectos-en-venta/casaparq-cerro-colorado-arequipa/"
FRAGMENTS = ["Mivivienda", "eco amigable", "Arequipa"]

_REFINE_JS = r"""
({cx, cy}) => {
    const esc = v => (window.CSS && CSS.escape) ? CSS.escape(v) : v;
    const INLINE = new Set([
        'SPAN','STRONG','EM','B','I','A','SMALL','BIG','ABBR',
        'CITE','CODE','MARK','Q','S','SUB','SUP','U','VAR','WBR',
    ]);
    const skipInline = (el) => {
        while (el && INLINE.has(el.tagName)) el = el.parentElement;
        return el;
    };

    const ID_CLS = /^elementor-element-[a-z0-9]+$/;
    const stableClasses = (el) =>
        (el.className || '').toString().trim().split(/\s+/)
            .filter(c => c && !ID_CLS.test(c));

    const buildPath = (startEl) => {
        const parts = [];
        let cur = startEl;
        let bestSel = null;
        let bestCount = Infinity;
        while (cur && cur !== document.body) {
            if (cur.id) {
                try {
                    const idS = '#' + esc(cur.id);
                    if (document.querySelectorAll(idS).length === 1) {
                        if (!parts.length) return idS;
                        const combo = idS + ' ' + parts.join(' ');
                        const cnt = document.querySelectorAll(combo).length;
                        if (cnt === 1) return combo;
                        return idS;
                    }
                } catch(_) {}
            }
            let part = cur.tagName.toLowerCase();
            const cls = stableClasses(cur);
            if (cls.length) part += '.' + cls.slice(0, 2).map(esc).join('.');
            parts.unshift(part);
            const testSel = parts.join(' ');
            try {
                const cnt = document.querySelectorAll(testSel).length;
                if (cnt === 1) return testSel;
                if (cnt === 0) { parts.shift(); break; }
                if (cnt < bestCount) { bestCount = cnt; bestSel = testSel; }
            } catch(_) { break; }
            if (parts.length >= 10) break;
            cur = cur.parentElement;
        }
        return bestSel || (parts.length ? parts.join(' ') : null);
    };

    const OVERLAY_CLS = /e-page-transition|elementor-loading|elementor-invisible/;
    const stack = document.elementsFromPoint(cx, cy) || [document.elementFromPoint(cx, cy)];
    let el = null;
    for (const candidate of stack) {
        if (!candidate || candidate === document.body || candidate === document.documentElement) continue;
        if (OVERLAY_CLS.test(candidate.className || '')) continue;
        el = candidate;
        break;
    }
    if (!el || el === document.body) return null;
    el = skipInline(el);
    if (!el || el === document.body) return null;

    const ownText = (el.innerText || el.textContent || '').trim();
    if (ownText.length > 40) {
        const needle = ownText.slice(0, 40);
        const candidates = Array.from(
            document.querySelectorAll('p, article, section, h1, h2, h3, h4, h5, h6, div, li')
        ).filter(e => {
            const t = (e.innerText || e.textContent || '').trim();
            return t.startsWith(needle) && e.children.length < 6;
        });
        if (candidates.length >= 1) {
            let target = candidates[0];
            for (const c of candidates) {
                if (target.contains(c) && c !== target) target = c;
            }
            target = skipInline(target);
            if (target && target !== document.body) {
                const result = buildPath(target);
                if (result) return result;
            }
        }
    }
    return buildPath(el);
}
"""


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox"],
        )
        ctx = await browser.new_context(
            viewport={"width": 1280, "height": 720},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        )
        page = await ctx.new_page()

        print(f"Loading {URL} ...")
        await page.goto(URL, wait_until="domcontentloaded", timeout=30_000)
        try:
            await page.wait_for_load_state("load", timeout=10_000)
        except PlaywrightTimeoutError:
            pass

        # Dismiss cookie banner (may trigger navigation)
        for sel in ["#orni_gdpr_cookie_info_bar .orni-gdpr-infobar-allow-all", ".orni-gdpr-infobar-allow-all"]:
            try:
                await page.click(sel, timeout=2_000)
                try:
                    await page.wait_for_load_state("domcontentloaded", timeout=5_000)
                    await page.wait_for_load_state("load", timeout=8_000)
                except PlaywrightTimeoutError:
                    pass
                await page.wait_for_timeout(800)
                print(f"  Dismissed cookie banner via: {sel}")
                break
            except Exception:
                pass

        # ── 1. Find the description paragraph ───────────────────────────────
        desc = await page.evaluate(
            """(frags) => {
                const el = Array.from(document.querySelectorAll('p')).find(e => {
                    const t = (e.innerText || e.textContent || '').trim();
                    return t.length > 80 && frags.every(f => t.includes(f));
                });
                if (!el) return { found: false };
                el.scrollIntoView({ behavior: 'instant', block: 'center' });
                const rect = el.getBoundingClientRect();
                // Walk up to find data-id
                let anc = el, dataId = null;
                while (anc && anc !== document.body) {
                    dataId = anc.getAttribute('data-id');
                    if (dataId) break;
                    anc = anc.parentElement;
                }
                return {
                    found: true,
                    dataId,
                    text: (el.innerText || '').trim().slice(0, 120),
                    cx: Math.round(rect.left + rect.width / 2),
                    cy: Math.round(rect.top + rect.height / 4),
                };
            }""",
            FRAGMENTS,
        )

        if not desc["found"]:
            print("FAIL: description paragraph not found")
            await browser.close()
            return

        print(f"\n[FOUND] data-id={desc['dataId']}")
        print(f"        text: {repr(desc['text'])}")
        print(f"        coords: cx={desc['cx']} cy={desc['cy']}")

        # ── 2. Run _refine_selector at those coords ──────────────────────────
        cx, cy = desc["cx"], max(10, min(desc["cy"], 710))
        sel = await page.evaluate(_REFINE_JS, {"cx": cx, "cy": cy})

        if not sel:
            print("FAIL: _refine_selector returned None")
            await browser.close()
            return

        count = await page.evaluate(
            "(s) => { try { return document.querySelectorAll(s).length; } catch(_) { return -1; } }",
            sel,
        )
        text = await page.evaluate(
            "(s) => { try { const el = document.querySelector(s); return el ? (el.innerText||'').trim().slice(0,120) : ''; } catch(_){ return ''; } }",
            sel,
        )
        has_data_id = "data-id" in sel
        has_elem_cls = bool(_re.search(r'elementor-element-[a-z0-9]+', sel))

        print(f"\n[SELECTOR]  {sel}")
        print(f"  count={count}  has_data_id={has_data_id}  has_elem_cls={has_elem_cls}")
        print(f"  extracted text: {repr(text)}")

        # ── 3. Also test the structural selector from the Monterrico test ───
        monterrico_sel = (
            "div.elementor-element.e-con-full "
            "div.elementor-element.e-con-boxed "
            "div.e-con-inner "
            "div.elementor-element.elementor-widget__width-initial "
            "div.elementor-widget-container p"
        )
        msel_count = await page.evaluate(
            "(s) => { try { return document.querySelectorAll(s).length; } catch(_) { return -1; } }",
            monterrico_sel,
        )
        msel_text = await page.evaluate(
            "(s) => { try { const el = document.querySelector(s); return el ? (el.innerText||'').trim().slice(0,120) : ''; } catch(_){ return ''; } }",
            monterrico_sel,
        )
        print(f"\n[MONTERRICO STRUCTURAL SELECTOR]  count={msel_count}")
        print(f"  {monterrico_sel}")
        print(f"  extracted text: {repr(msel_text)}")

        # ── 4. Summary ───────────────────────────────────────────────────────
        print("\n" + "="*60)
        ok = count == 1 and not has_data_id and not has_elem_cls
        print(f"Algorithm generates stable selector: {'PASS' if ok else 'FAIL'}")
        print(f"Monterrico structural sel works here: {'YES' if msel_count == 1 else f'NO (count={msel_count})'}")

        await browser.close()


asyncio.run(main())
