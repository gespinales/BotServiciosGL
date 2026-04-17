from typing import Optional
import oracledb
import sys
from config.settings import config
from src.models.schemas import QueryResult

class OracleConnection:
    def __init__(self):
        self.connection = None

    def connect(self):
        self.connection = oracledb.connect(
            user=config.oracle_user,
            password=config.oracle_password,
            dsn=config.oracle_dsn
        )

    def disconnect(self):
        if self.connection:
            self.connection.close()

    def execute_query(self, sql: str, params: Optional[dict] = None) -> list[dict]:
        if not self.connection:
            self.connect()
        
        cursor = self.connection.cursor()
        cursor.execute(sql, params or {})
        
        columns = [col[0] for col in cursor.description]
        rows = cursor.fetchall()
        
        return [dict(zip(columns, row)) for row in rows]

db = OracleConnection()
