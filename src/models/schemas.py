from pydantic import BaseModel
from typing import Optional, Any

class QueryResult(BaseModel):
    query_id: str
    success: bool
    data: Optional[list[dict]] = None
    formatted_output: Optional[str] = None
    error: Optional[str] = None

class UserMessage(BaseModel):
    user_id: str
    message: str
    timestamp: Optional[str] = None
