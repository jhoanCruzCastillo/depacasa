"""
Test: validates _refine_selector algorithm against the real Elementor site.
"""
import asyncio
import sys

from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeoutError

_STEALTH_SCRIPT = """
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    if (!window.chrome) window.chrome = {};
    if (!window.chrome.runtime) window.chrome.runtime = {};
    Object.defineProperty(navigator, 'languages', { get: () => ['es-ES', 'es', 'en-US', 'en'] });
"""

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
    let el = document.elementFromPoint(cx, cy);
    if (!el || !el.tagName || el === document.body) return null;
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

URL = "https://cissacperu.com/proyectos-en-venta/condominio-casaparq-monterrico-surco/"
DESC_FRAGMENTS = ["Casaparq", "condominio", "Surco"]


def has_inline_tag(sel: str) -> bool:
    sel_l = " " + sel.lower() + " "
    for tag in [" span", " strong ", " em ", " b ", " i "]:
        if tag in sel_l:
            return True
    return False


async def run():
    passed = 0
    failed = 0

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=True,
            args=["--disable-blink-features=AutomationControlled", "--no-sandbox",
                  "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        )
        ctx = await browser.new_context(
            viewport={"width": 1280, "height": 720},
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
            ),
            locale="es-ES",
        )
        await ctx.add_init_script(_STEALTH_SCRIPT)
        page = await ctx.new_page()

        print(f"Loading {URL} ...")
        await page.goto(URL, wait_until="domcontentloaded", timeout=30_000)
        try:
            await page.wait_for_load_state("networkidle", timeout=12_000)
        except PlaywrightTimeoutError:
            pass

        # Dismiss cookie/GDPR banner so it doesn't block elementFromPoint
        for selector in [
            "#orni_gdpr_cookie_info_bar .orni-gdpr-infobar-allow-all",
            ".orni-gdpr-infobar-allow-all",
            "#orni_gdpr_cookie_info_bar button",
            "[class*='cookie'] button",
        ]:
            try:
                await page.click(selector, timeout=2_000)
                # Banner click may reload the page — wait for it to settle
                try:
                    await page.wait_for_load_state("domcontentloaded", timeout=5_000)
                    await page.wait_for_load_state("networkidle", timeout=8_000)
                except PlaywrightTimeoutError:
                    pass
                await page.wait_for_timeout(600)
                print(f"  Dismissed cookie banner via: {selector}")
                break
            except Exception:
                pass

        wdriver = await page.evaluate("() => navigator.webdriver")
        widgets = await page.evaluate("() => document.querySelectorAll('.elementor-widget').length")
        print(f"webdriver={wdriver}  Elementor widgets={widgets}\n")

        # ── TEST 1: Find description element, scroll into view, fresh rect ────
        print("=== TEST 1: Locate description paragraph ===")
        desc_info = await page.evaluate(
            """
            (fragments) => {
                const candidates = Array.from(
                    document.querySelectorAll('.elementor-widget-text-editor p, .elementor-text-editor p, p')
                ).filter(el => {
                    const t = (el.innerText || el.textContent || '').trim();
                    return t.length > 80 && fragments.every(f => t.includes(f));
                });
                if (!candidates.length) return { found: false };
                let target = candidates[0];
                for (const c of candidates) if (target.contains(c) && c !== target) target = c;
                // scroll it into view and get fresh viewport rect
                target.scrollIntoView({ behavior: 'instant', block: 'center' });
                const rect = target.getBoundingClientRect();
                let anc = target;
                let dataId = null;
                while (anc && anc !== document.body) {
                    dataId = anc.getAttribute('data-id');
                    if (dataId) break;
                    anc = anc.parentElement;
                }
                return {
                    found: true, tag: target.tagName,
                    text: (target.innerText || target.textContent || '').trim().slice(0, 100),
                    cx: Math.round(rect.left + rect.width / 2),
                    cy: Math.round(rect.top + rect.height / 4),
                    dataId,
                };
            }
            """,
            DESC_FRAGMENTS,
        )
        if not desc_info["found"]:
            print(f"  [FAIL] Description not found — searched for: {DESC_FRAGMENTS}")
            failed += 1
            await browser.close()
            print(f"\nResults: {passed} passed, {failed} failed")
            return failed

        print(f"  [PASS] <{desc_info['tag']}> data-id={desc_info['dataId']}")
        print(f"         text={repr(desc_info['text'][:80])}")
        print(f"         viewport coords after scrollIntoView: cx={desc_info['cx']} cy={desc_info['cy']}")
        passed += 1

        cx, cy = desc_info["cx"], desc_info["cy"]
        cy = max(10, min(cy, 710))

        # Verify elementFromPoint now hits the right element
        raw = await page.evaluate(
            "({cx,cy}) => { const el=document.elementFromPoint(cx,cy); return el?el.tagName:'NONE'; }",
            {"cx": cx, "cy": cy},
        )
        print(f"  elementFromPoint → <{raw}>")

        # ── TEST 2: _refine_selector produces count=1 selector ────────────────
        print("\n=== TEST 2: _refine_selector count and quality ===")
        sel = await page.evaluate(_REFINE_JS, {"cx": cx, "cy": cy})
        if not sel:
            print("  [FAIL] _refine_selector returned None")
            failed += 1
        else:
            count = await page.evaluate(
                "(s) => { try{return document.querySelectorAll(s).length;}catch(_){return -1;} }",
                sel,
            )
            text_preview = await page.evaluate(
                "(s) => { try{const el=document.querySelector(s);return el?(el.innerText||el.textContent||'').trim().slice(0,100):'';}catch(_){return '';} }",
                sel,
            )
            no_inline = not has_inline_tag(sel)
            has_desc_text = any(f in text_preview for f in DESC_FRAGMENTS)
            ok = count == 1 and no_inline
            status = "PASS" if ok else "FAIL"
            if ok:
                passed += 1
            else:
                failed += 1
            print(f"  [{status}] {sel}")
            print(f"         count={count}  no_inline={no_inline}  has_desc_text={has_desc_text}")
            print(f"         text: {repr(text_preview[:80])}")

        # ── TEST 3: count is the same at scroll=0 ─────────────────────────────
        print("\n=== TEST 3: Selector stable regardless of scroll position ===")
        await page.evaluate("window.scrollTo(0, 0)")
        await page.wait_for_timeout(200)
        if sel:
            count3 = await page.evaluate(
                "(s)=>{try{return document.querySelectorAll(s).length;}catch(_){return -1;}}",
                sel,
            )
            ok3 = count3 == 1
            if ok3:
                passed += 1
            else:
                failed += 1
            print(f"  [{'PASS' if ok3 else 'FAIL'}] count={count3} at scroll=0")

        # ── TEST 4: No inline element tags in selector ────────────────────────
        print("\n=== TEST 4: Selector free of inline element tags ===")
        if sel:
            ok4 = not has_inline_tag(sel)
            if ok4:
                passed += 1
            else:
                failed += 1
            print(f"  [{'PASS' if ok4 else 'FAIL'}] {sel}")

        # ── TEST 5: Selector has no data-id / elementor-element-XXXXX classes ──
        print("\n=== TEST 5: Selector stable across Playwright & Chrome (no data-id) ===")
        if sel:
            import re as _re
            has_data_id = 'data-id' in sel
            has_elem_cls = bool(_re.search(r'elementor-element-[a-z0-9]+', sel))
            no_browser_specific = not has_data_id and not has_elem_cls
            ok5 = no_browser_specific and count == 1
            if ok5:
                passed += 1
            else:
                failed += 1
            print(f"  Selector: {sel}")
            print(f"  has_data-id={has_data_id}  has_elem_cls={has_elem_cls}  count={count}")
            print(f"  [{'PASS' if ok5 else 'FAIL'}] no_browser_specific={no_browser_specific}")

        await browser.close()

    print(f"\n{'='*55}")
    print(f"Results: {passed} passed, {failed} failed")
    return failed


if __name__ == "__main__":
    fails = asyncio.run(run())
    sys.exit(fails)
