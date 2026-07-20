"""Inspect Cerro Colorado page to see what Playwright actually renders."""
import asyncio
from playwright.async_api import async_playwright, TimeoutError as PTE

URL = "https://cissacperu.com/proyectos-en-venta/casaparq-cerro-colorado-arequipa/"


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True, args=["--no-sandbox"])
        ctx = await browser.new_context(
            viewport={"width": 1280, "height": 720},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        )
        page = await ctx.new_page()
        await page.goto(URL, wait_until="domcontentloaded", timeout=30_000)
        try:
            await page.wait_for_load_state("load", timeout=10_000)
        except PTE:
            pass
        for sel in ["#orni_gdpr_cookie_info_bar .orni-gdpr-infobar-allow-all", ".orni-gdpr-infobar-allow-all"]:
            try:
                await page.click(sel, timeout=2_000)
                try:
                    await page.wait_for_load_state("domcontentloaded", timeout=5_000)
                    await page.wait_for_load_state("load", timeout=8_000)
                except PTE:
                    pass
                await page.wait_for_timeout(800)
                print(f"  Dismissed cookie banner via: {sel}")
                break
            except Exception:
                pass

        paras = await page.evaluate("""
            () => Array.from(document.querySelectorAll('p'))
                .map(p => (p.innerText || p.textContent || '').trim().slice(0, 130))
                .filter(t => t.length > 30)
                .slice(0, 20)
        """)
        print(f"=== Paragraphs ({len(paras)}) ===")
        for i, t in enumerate(paras):
            print(f"  [{i}] {repr(t)}")

        widget_count = await page.evaluate(
            "() => document.querySelectorAll('.elementor-widget-text-editor p').length"
        )
        print(f"\nelementor-widget-text-editor p count: {widget_count}")

        ids = await page.evaluate("""
            () => Array.from(document.querySelectorAll('[data-id]'))
                .filter(e => (e.innerText || e.textContent || '').trim().length > 50)
                .map(e => ({ id: e.getAttribute('data-id'), text: (e.innerText || e.textContent || '').trim().slice(0, 90) }))
                .slice(0, 10)
        """)
        print(f"\n=== data-ids with text ===")
        for d in ids:
            print(f"  {d['id']}: {repr(d['text'])}")

        # Check body text start
        body = await page.evaluate("() => (document.body.innerText || '').trim().slice(0, 400)")
        print(f"\n=== Body text start ===\n{repr(body[:300])}")

        await browser.close()


asyncio.run(main())
