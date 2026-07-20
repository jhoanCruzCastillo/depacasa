"""
Finds selectors for the description that DON'T use data-id,
so they work in both Playwright and real Chrome (which serves different data-ids).
"""
import asyncio
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeoutError

URL = "https://cissacperu.com/proyectos-en-venta/condominio-casaparq-monterrico-surco/"
FRAGMENTS = ["Casaparq", "condominio", "Surco"]


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
        await page.goto(URL, wait_until="domcontentloaded", timeout=30_000)
        try:
            await page.wait_for_load_state("load", timeout=8_000)
        except PlaywrightTimeoutError:
            pass

        # ─── 1. Check generic text-editor count ───────────────────────────────
        counts = await page.evaluate("""
            () => {
                const sel1 = '.elementor-widget-text-editor p';
                const sel2 = '.elementor-text-editor p';
                const sel3 = 'div.elementor-widget-text-editor > div > div > p';
                return {
                    widget_text_editor_p: document.querySelectorAll(sel1).length,
                    text_editor_p: document.querySelectorAll(sel2).length,
                    deep_p: document.querySelectorAll(sel3).length,
                };
            }
        """)
        print("=== Generic text-editor selector counts ===")
        for k, v in counts.items():
            print(f"  {k}: {v}")

        # ─── 2. Build a path WITHOUT any data-id-containing classes ───────────
        result = await page.evaluate(
            """(frags) => {
                const descP = Array.from(document.querySelectorAll('p')).find(e => {
                    const t = (e.innerText || e.textContent || '').trim();
                    return t.length > 80 && frags.every(f => t.includes(f));
                });
                if (!descP) return { found: false };

                // Walk up collecting classes that do NOT encode element IDs
                // (i.e., skip classes matching /elementor-element-[a-z0-9]+/)
                const ID_CLS = /^elementor-element-[a-z0-9]+$/;
                const cleanClasses = (el) =>
                    (el.className || '').toString().trim().split(/\s+/)
                        .filter(c => c && !ID_CLS.test(c));

                // Collect ancestors up to 6 levels, skipping ID-encoded classes
                const parts = ['p'];
                let cur = descP.parentElement;
                let attempts = 0;
                while (cur && cur !== document.body && attempts < 8) {
                    const cls = cleanClasses(cur);
                    if (cls.length) {
                        const part = cur.tagName.toLowerCase() + '.' + cls.slice(0, 2).join('.');
                        parts.unshift(part);
                        const testSel = parts.join(' ');
                        try {
                            const cnt = document.querySelectorAll(testSel).length;
                            if (cnt === 1) return { found: true, selector: testSel, count: cnt };
                            if (cnt === 0) { parts.shift(); break; }
                        } catch(_) {}
                    }
                    cur = cur.parentElement;
                    attempts++;
                }
                return { found: true, selector: parts.join(' '), count: document.querySelectorAll(parts.join(' ')).length };
            }""",
            FRAGMENTS,
        )
        print("\n=== No-data-id path for description ===")
        print(f"  found: {result.get('found')}")
        print(f"  selector: {result.get('selector')}")
        print(f"  count: {result.get('count')}")

        # ─── 3. Test XPath text content approach ──────────────────────────────
        xpath_result = await page.evaluate(
            """(frags) => {
                const descP = Array.from(document.querySelectorAll('p')).find(e => {
                    const t = (e.innerText || e.textContent || '').trim();
                    return t.length > 80 && frags.every(f => t.includes(f));
                });
                if (!descP) return { found: false };
                const anchor = (descP.innerText || descP.textContent || '').trim().slice(0, 30);
                return { found: true, anchor, text: (descP.innerText||'').trim().slice(0, 100) };
            }""",
            FRAGMENTS,
        )
        print("\n=== Text anchor ===")
        print(f"  anchor: {repr(xpath_result.get('anchor'))}")
        print(f"  full text start: {repr(xpath_result.get('text'))}")

        # ─── 4. Test :has-text pseudo or attribute-only path ──────────────────
        # Find grandparent with unique class combination (no element IDs)
        unique_result = await page.evaluate(
            """(frags) => {
                const ID_CLS = /^elementor-element-[a-z0-9]+$/;
                const descP = Array.from(document.querySelectorAll('p')).find(e => {
                    const t = (e.innerText || e.textContent || '').trim();
                    return t.length > 80 && frags.every(f => t.includes(f));
                });
                if (!descP) return { found: false, candidates: [] };
                // Walk up, for each ancestor try building selector from stable classes only
                const results = [];
                let cur = descP.parentElement;
                let accumulated = ['p'];
                while (cur && cur !== document.body) {
                    const cls = (cur.className || '').toString().trim().split(/\s+/)
                        .filter(c => c && !ID_CLS.test(c));
                    if (cls.length >= 1) {
                        const part = cur.tagName.toLowerCase() + '.' + cls.slice(0, 3).join('.');
                        const testParts = [part, ...accumulated];
                        const testSel = testParts.join(' ');
                        try {
                            const cnt = document.querySelectorAll(testSel).length;
                            results.push({ sel: testSel, cnt });
                            if (cnt === 1) {
                                return { found: true, selector: testSel, count: cnt };
                            }
                        } catch(_) {}
                        accumulated = testParts;
                    }
                    cur = cur.parentElement;
                }
                return { found: false, candidates: results.slice(0, 8) };
            }""",
            FRAGMENTS,
        )
        print("\n=== Bottom-up path (no element IDs) ===")
        if unique_result.get("found"):
            print(f"  UNIQUE selector: {unique_result['selector']}  count={unique_result['count']}")
        else:
            print("  No unique path found. Candidates:")
            for c in unique_result.get("candidates", []):
                print(f"    {c['cnt']:3}  {c['sel']}")

        await browser.close()


asyncio.run(main())
