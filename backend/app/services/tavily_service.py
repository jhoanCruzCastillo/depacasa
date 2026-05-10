"""Service for searching real estate platforms using Tavily API"""

from config import settings
import logging

logger = logging.getLogger(__name__)


class TavilyService:
    """Search for real estate platforms using Tavily API"""

    def __init__(self):
        self.api_key = settings.TAVILY_API_KEY

    async def search_platforms(self, query: str, max_results: int = 10) -> list[dict]:
        """
        Search for real estate platforms
        
        Args:
            query: Search query (e.g., "real estate platforms in Mexico")
            max_results: Maximum number of results
            
        Returns:
            List of platforms with URLs and descriptions
        """
        if not self.api_key:
            logger.warning("Tavily API key not configured")
            return []

        try:
            from tavily import TavilyClient
            
            client = TavilyClient(api_key=self.api_key)
            response = client.search(query, max_results=max_results)
            
            platforms = []
            for result in response.get("results", []):
                platforms.append({
                    "name": result.get("title", ""),
                    "url": result.get("url", ""),
                    "description": result.get("content", ""),
                })
            
            return platforms
        except Exception as e:
            logger.error(f"Error searching platforms with Tavily: {e}")
            return []

    async def verify_url(self, url: str) -> bool:
        """Verify if a URL is reachable"""
        try:
            import httpx
            
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.head(url, follow_redirects=True)
                return response.status_code < 400
        except Exception as e:
            logger.error(f"Error verifying URL {url}: {e}")
            return False
