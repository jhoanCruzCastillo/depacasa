"""
Compares data-id values from the cissac site with and without navigator.webdriver stealth.
If reverting stealth restores data-id=5442a9d (same as user's Chrome), that confirms the fix.
"""
import asyncio
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeoutError

URL = "https://cissacperu.com/proyectos-en-venta/condominio-casaparq-monterrico-surco/"
FRAGMENTS = ["Casaparq", "condominio", "Surco"]


async def load_page(pw, with_webdriver_false: bool):
    label = "WITH stealth (webdriver=false)" if with_webdriver_false else "WITHOUT stealth (webdriver=true default)"
    print(f"\n{'='*60}")
    print(f"Test: {label}")
    print("="*60)

    browser = await pw.chromium.launch(
        headless=True,
        args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    )
    ctx = await browser.new_context(
        viewport={"width": 1280, "height": 720},
        user_agent=(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ),
    )
    if with_webdriver_false:
        await ctx.add_init_script("Object.defineProperty(navigator,'webdriver',{get:()=>false});")

    page = await ctx.new_page()
    await page.goto(URL, wait_until="domcontentloaded", timeout=30_000)
    try:
        await page.wait_for_load_state("load", timeout=8_000)
    except PlaywrightTimeoutError:
        pass

    webdriver_val = await page.evaluate("() => navigator.webdriver")
    print(f"navigator.webdriver = {webdriver_val}")

    widgets = await page.evaluate("() => document.querySelectorAll('.elementor-widget').length")
    print(f"Elementor widgets: {widgets}")

    # Find description paragraph and its ancestor data-id
    result = await page.evaluate(
        """(frags) => {
            const els = Array.from(document.querySelectorAll('p')).filter(e => {
                const t = (e.innerText || e.textContent || '').trim();
                return t.length > 80 && frags.every(f => t.includes(f));
            });
            if (!els.length) return { found: false };
            const el = els[0];
            let anc = el;
            let dataId = null;
            while (anc && anc !== document.body) {
                dataId = anc.getAttribute('data-id');
                if (dataId) break;
                anc = anc.parentElement;
            }
            return {
                found: true,
                dataId,
                text: (el.innerText || el.textContent || '').trim().slice(0, 80),
            };
        }""",
        FRAGMENTS,
    )

    if result["found"]:
        print(f"Description paragraph found!")
        print(f"  data-id of ancestor: {result['dataId']}")
        print(f"  text: {repr(result['text'])}")
    else:
        print("Description paragraph NOT found with those fragments")

    # Show ALL data-ids present on the page
    all_ids = await page.evaluate(
        "() => [...new Set(Array.from(document.querySelectorAll('[data-id]')).map(e => e.getAttribute('data-id')))].slice(0, 20)"
    )
    print(f"  All data-ids (first 20): {all_ids}")

    await browser.close()
    return result.get("dataId")


async def main():
    async with async_playwright() as pw:
        id_no_stealth = await load_page(pw, with_webdriver_false=False)
        id_with_stealth = await load_page(pw, with_webdriver_false=True)

    print("\n" + "="*60)
    print("SUMMARY:")
    print(f"  Without stealth (webdriver=true):  data-id = {id_no_stealth}")
    print(f"  With stealth (webdriver=false):    data-id = {id_with_stealth}")
    print(f"  User's Chrome shows:               data-id = 5442a9d")
    if id_no_stealth == "5442a9d":
        print("  ✓ Without stealth matches Chrome! => REVERT stealth")
    elif id_with_stealth == "5442a9d":
        print("  ✓ With stealth matches Chrome!")
    else:
        print("  ✗ Neither matches Chrome. Site serves different content to Playwright.")
        print("    Need text-based selector strategy.")


asyncio.run(main())
