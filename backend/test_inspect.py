"""Quick page inspector to see what headless Playwright actually renders."""
import asyncio
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeoutError

STEALTH = """
Object.defineProperty(navigator, 'webdriver', { get: () => false });
if (!window.chrome) window.chrome = {};
if (!window.chrome.runtime) window.chrome.runtime = {};
Object.defineProperty(navigator, 'languages', { get: () => ['es-ES', 'es', 'en-US', 'en'] });
"""

URL = "https://cissacperu.com/proyectos-en-venta/condominio-casaparq-monterrico-surco/"


async def main():
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
        await ctx.add_init_script(STEALTH)
        page = await ctx.new_page()
        await page.goto(URL, wait_until="domcontentloaded", timeout=30_000)
        try:
            await page.wait_for_load_state("networkidle", timeout=12_000)
        except PlaywrightTimeoutError:
            pass
        try:
            await page.wait_for_function(
                "() => !document.querySelector('.elementor-loading, .elementor-invisible')",
                timeout=4_000,
            )
        except PlaywrightTimeoutError:
            pass

        print("Title:", await page.title())
        print()

        paras = await page.evaluate("""
            () => Array.from(document.querySelectorAll('p'))
                .map(p => (p.innerText || p.textContent || '').trim().slice(0, 120))
                .filter(t => t.length > 30)
                .slice(0, 20)
        """)
        print(f"=== Paragraphs ({len(paras)}) ===")
        for i, t in enumerate(paras):
            print(f"  [{i}] {repr(t)}")

        print()
        data_ids = await page.evaluate("""
            () => Array.from(document.querySelectorAll('[data-id]')).slice(0, 15)
                .map(e => ({
                    tag: e.tagName,
                    id: e.getAttribute('data-id'),
                    cls: (e.className || '').split(' ').slice(0, 3).join(' '),
                    text: (e.innerText || '').trim().slice(0, 80)
                }))
        """)
        print(f"=== Elements with data-id ({len(data_ids)}) ===")
        for d in data_ids:
            print(f"  <{d['tag']}> data-id={d['id']}  cls={d['cls']}")
            if d["text"]:
                print(f"    text: {repr(d['text'][:70])}")

        # Check webdriver flag
        webdriver_val = await page.evaluate("() => navigator.webdriver")
        print(f"\nnavigator.webdriver = {webdriver_val}")

        # Check if any Elementor widgets exist
        widget_count = await page.evaluate(
            "() => document.querySelectorAll('.elementor-widget').length"
        )
        print(f"Elementor widgets on page: {widget_count}")

        # Full body text (first 500 chars) to check redirect / bot page
        body_text = await page.evaluate(
            "() => (document.body.innerText || '').trim().slice(0, 500)"
        )
        print(f"\nBody text start: {repr(body_text[:300])}")

        await browser.close()


asyncio.run(main())
