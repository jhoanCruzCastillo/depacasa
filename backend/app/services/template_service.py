"""Service for managing scraping templates"""

from sqlalchemy.orm import Session
from uuid import UUID
import logging

from app.models import UrlNode, Field, Selector

logger = logging.getLogger(__name__)


class TemplateService:
    """Service for managing scraping templates (UrlNodes, Fields, Selectors)"""

    @staticmethod
    async def create_template(
        db: Session,
        developer_id: UUID,
        template_config: dict,
    ) -> dict:
        """
        Create a complete template from configuration
        
        Args:
            db: Database session
            developer_id: Developer UUID
            template_config: Configuration with url_nodes, fields, selectors
            
        Returns:
            Created template data
        """
        try:
            # Create URL nodes
            url_nodes_map = {}
            for node_config in template_config.get("url_nodes", []):
                url_node = UrlNode(
                    developer_id=developer_id,
                    parent_id=node_config.get("parent_id"),
                    name=node_config.get("name"),
                    url=node_config.get("url"),
                    order=node_config.get("order", 0),
                )
                db.add(url_node)
                db.flush()
                url_nodes_map[node_config.get("id")] = url_node.id
            
            # Create fields and selectors
            for field_config in template_config.get("fields", []):
                url_node_id = url_nodes_map.get(field_config.get("url_node_id"))
                if not url_node_id:
                    continue
                
                field = Field(
                    url_node_id=url_node_id,
                    name=field_config.get("name"),
                    is_child_url=field_config.get("is_child_url", False),
                    order=field_config.get("order", 0),
                )
                db.add(field)
                db.flush()
                
                for selector_config in field_config.get("selectors", []):
                    selector = Selector(
                        field_id=field.id,
                        value=selector_config.get("value"),
                        order=selector_config.get("order", 0),
                    )
                    db.add(selector)
            
            db.commit()
            return {"status": "created", "developer_id": developer_id}
        except Exception as e:
            db.rollback()
            logger.error(f"Error creating template: {e}")
            raise

    @staticmethod
    async def get_template(
        db: Session,
        developer_id: UUID,
    ) -> dict:
        """
        Get complete template for a developer
        
        Args:
            db: Database session
            developer_id: Developer UUID
            
        Returns:
            Template configuration
        """
        try:
            url_nodes = db.query(UrlNode).filter(
                UrlNode.developer_id == developer_id
            ).all()
            
            template = {
                "developer_id": developer_id,
                "url_nodes": [],
                "fields": [],
            }
            
            for node in url_nodes:
                template["url_nodes"].append({
                    "id": str(node.id),
                    "name": node.name,
                    "url": node.url,
                    "parent_id": str(node.parent_id) if node.parent_id else None,
                    "order": node.order,
                })
                
                for field in node.fields:
                    field_data = {
                        "id": str(field.id),
                        "url_node_id": str(node.id),
                        "name": field.name,
                        "is_child_url": field.is_child_url,
                        "order": field.order,
                        "selectors": [],
                    }
                    
                    for selector in field.selectors:
                        field_data["selectors"].append({
                            "id": str(selector.id),
                            "value": selector.value,
                            "order": selector.order,
                        })
                    
                    template["fields"].append(field_data)
            
            return template
        except Exception as e:
            logger.error(f"Error getting template: {e}")
            raise
