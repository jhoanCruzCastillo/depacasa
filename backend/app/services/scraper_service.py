"""Service for web scraping using Playwright"""

import logging
from typing import Dict, Any, List
from uuid import UUID

logger = logging.getLogger(__name__)


class ScraperService:
    """Web scraping service using Playwright"""

    async def scrape_url(
        self,
        url: str,
        selectors: Dict[str, List[str]],
        wait_for_selector: str = None,
        timeout: int = 30000,
    ) -> Dict[str, Any]:
        """
        Scrape a URL using CSS selectors
        
        Args:
            url: URL to scrape
            selectors: Dict with field names and their CSS selector chains
            wait_for_selector: Optional selector to wait for before scraping
            timeout: Timeout in milliseconds
            
        Returns:
            Dictionary with extracted data
        """
        try:
            from playwright.async_api import async_playwright
            
            async with async_playwright() as p:
                browser = await p.chromium.launch()
                page = await browser.new_page()
                
                await page.goto(url, wait_until="networkidle", timeout=timeout)
                
                if wait_for_selector:
                    await page.wait_for_selector(wait_for_selector, timeout=timeout)
                
                data = {}
                for field_name, selector_chain in selectors.items():
                    data[field_name] = await self._extract_field(page, selector_chain)
                
                await browser.close()
                return data
        except Exception as e:
            logger.error(f"Error scraping {url}: {e}")
            return {"error": str(e)}

    async def _extract_field(self, page, selector_chain: List[str]) -> Any:
        """Extract a field using a chain of selectors"""
        try:
            current_elements = await page.query_selector_all("*")
            
            for selector in selector_chain:
                matching = []
                for elem in current_elements:
                    if await self._matches_selector(elem, selector):
                        matching.append(elem)
                
                if not matching:
                    return None
                
                current_elements = matching
            
            if current_elements:
                return await current_elements[0].text_content()
            return None
        except Exception as e:
            logger.error(f"Error extracting field with selectors {selector_chain}: {e}")
            return None

    async def _matches_selector(self, element, selector: str) -> bool:
        """Check if element matches CSS selector"""
        try:
            return await element.evaluate(
                f"""(elem) => elem.matches('{selector}')"""
            )
        except:
            return False

    async def scrape_recursively(
        self,
        start_url: str,
        url_nodes: List[Dict],
        selectors: Dict[str, List[str]],
    ) -> List[Dict[str, Any]]:
        """
        Scrape recursively through URL tree (padre -> hijo -> nieta)
        
        Args:
            start_url: Starting URL
            url_nodes: List of URL node configurations
            selectors: Field selectors
            
        Returns:
            List of scraped records
        """
        records = []
        
        try:
            from playwright.async_api import async_playwright
            
            async with async_playwright() as p:
                browser = await p.chromium.launch()
                records = await self._scrape_recursive_helper(
                    browser, start_url, url_nodes, selectors, 0, records
                )
                await browser.close()
            
            return records
        except Exception as e:
            logger.error(f"Error in recursive scraping: {e}")
            return records

    async def _scrape_recursive_helper(
        self,
        browser,
        url: str,
        url_nodes: List[Dict],
        selectors: Dict,
        depth: int,
        records: List,
        max_depth: int = 5,
    ) -> List:
        """Recursive helper for scraping"""
        if depth > max_depth:
            return records
        
        try:
            page = await browser.new_page()
            await page.goto(url, wait_until="networkidle")
            
            # Extract data at this level
            data = {}
            for field_name, selector_chain in selectors.items():
                data[field_name] = await self._extract_field(page, selector_chain)
            
            records.append({"url": url, "data": data})
            
            # Find child URLs
            if depth < len(url_nodes):
                current_node = url_nodes[depth]
                child_selector = current_node.get("selector")
                
                if child_selector:
                    child_urls = await page.evaluate(
                        f"""() => {{
                            return Array.from(document.querySelectorAll('{child_selector}'))
                                .map(el => el.href || el.getAttribute('href'))
                                .filter(url => url);
                        }}"""
                    )
                    
                    for child_url in child_urls:
                        full_url = self._normalize_url(url, child_url)
                        records = await self._scrape_recursive_helper(
                            browser, full_url, url_nodes, selectors, depth + 1, records, max_depth
                        )
            
            await page.close()
        except Exception as e:
            logger.error(f"Error in recursive helper at {url}: {e}")
        
        return records

    @staticmethod
    def _normalize_url(base_url: str, relative_url: str) -> str:
        """Normalize relative URLs to absolute"""
        from urllib.parse import urljoin
        return urljoin(base_url, relative_url)
