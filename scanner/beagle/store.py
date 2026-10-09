"""ClickHouse client over the HTTP interface.

Deliberately thin: one dependency (httpx), parameterised queries via
ClickHouse's own {name:Type} binding, and JSONEachRow for inserts.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Iterable

import httpx

from .config import settings

IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")


def identifier(name: str) -> str:
    """Table names cannot be bound as query parameters, so they are checked
    against a strict identifier pattern before being formatted into SQL."""
    if not IDENTIFIER.match(name):
        raise ValueError(f"refusing unsafe SQL identifier: {name!r}")
    return name


class ClickHouse:
    def __init__(self, url: str | None = None, database: str | None = None) -> None:
        self.url = (url or settings.clickhouse_url).rstrip("/")
        self.database = database or settings.clickhouse_database
        # Credentials travel in headers, never in the query string. A query
        # string ends up in proxy logs, server access logs and error messages;
        # the first version of this client put the password there.
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(120.0),
            headers={
                "X-ClickHouse-User": settings.clickhouse_user,
                "X-ClickHouse-Key": settings.clickhouse_password,
            },
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> "ClickHouse":
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.aclose()

    @staticmethod
    def _encode_param(value: Any) -> str:
        """Render a Python value the way ClickHouse parses bound parameters.

        Arrays are not JSON here: ClickHouse wants ['a','b'] with single
        quotes, and rejects the double-quoted JSON form outright.
        """
        if isinstance(value, str):
            return value
        if isinstance(value, bool):
            return "1" if value else "0"
        if isinstance(value, (int, float)):
            return str(value)
        if isinstance(value, (list, tuple)):
            parts = []
            for item in value:
                text = str(item).replace("\\", "\\\\").replace("'", "\\'")
                parts.append(f"'{text}'")
            return "[" + ",".join(parts) + "]"
        return json.dumps(value)

    def _params(self, extra: dict[str, Any] | None, with_db: bool) -> dict[str, str]:
        params: dict[str, str] = {}
        if with_db:
            params["database"] = self.database
        for key, value in (extra or {}).items():
            params[f"param_{key}"] = self._encode_param(value)
        return params

    async def execute(
        self,
        sql: str,
        *,
        body: str | bytes | None = None,
        params: dict[str, Any] | None = None,
        with_db: bool = True,
    ) -> str:
        """Run a statement. `body` carries row data for INSERT ... FORMAT."""
        query_params = self._params(params, with_db)
        if body is None:
            response = await self._client.post(self.url, params=query_params, content=sql)
        else:
            query_params["query"] = sql
            payload = body.encode() if isinstance(body, str) else body
            response = await self._client.post(self.url, params=query_params, content=payload)
        if response.status_code >= 400:
            raise RuntimeError(f"ClickHouse {response.status_code}: {response.text[:600]}")
        return response.text

    async def query(self, sql: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        # nosemgrep: sqlalchemy-execute-raw-query -- not SQLAlchemy; values are bound as ClickHouse {name:Type} parameters
        text = await self.execute(sql + "\nFORMAT JSON", params=params)
        if not text.strip():
            return []
        return json.loads(text).get("data", [])

    async def insert(self, table: str, rows: Iterable[dict[str, Any]]) -> int:
        payload = "\n".join(json.dumps(row, default=str) for row in rows)
        if not payload:
            return 0
        # nosemgrep: sqlalchemy-execute-raw-query -- table name checked by identifier(); rows go in the body as JSON
        await self.execute(f"INSERT INTO {identifier(table)} FORMAT JSONEachRow", body=payload)
        return payload.count("\n") + 1

    async def apply_schema(self, schema_path: Path) -> list[str]:
        """Run schema.sql statement by statement, ignoring comments."""
        raw = schema_path.read_text(encoding="utf-8")
        statements: list[str] = []
        for chunk in raw.split(";"):
            lines = [ln for ln in chunk.splitlines() if not ln.strip().startswith("--")]
            statement = "\n".join(lines).strip()
            if statement:
                statements.append(statement)
        applied: list[str] = []
        for statement in statements:
            # CREATE DATABASE must not be sent with a database context that
            # does not exist yet.
            with_db = not statement.upper().startswith("CREATE DATABASE")
            await self.execute(statement, with_db=with_db)
            applied.append(statement.split("\n")[0][:80])
        return applied
