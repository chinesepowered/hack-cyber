"""Configuration, loaded from the repo-root .env."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(REPO_ROOT / ".env")


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, "") or default)
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    clickhouse_url: str = os.getenv("CLICKHOUSE_URL", "http://localhost:8123")
    clickhouse_user: str = os.getenv("CLICKHOUSE_USER", "default")
    clickhouse_password: str = os.getenv("CLICKHOUSE_PASSWORD", "")
    clickhouse_database: str = os.getenv("CLICKHOUSE_DATABASE", "beagle")

    user_agent: str = os.getenv(
        "BEAGLE_USER_AGENT", "beagle-brigade/0.1 (cyberdefense hackathon scanner)"
    )
    sandbox_dir: Path = REPO_ROOT / (os.getenv("BEAGLE_SANDBOX_DIR", "./sandbox").lstrip("./"))
    rules_dir: Path = REPO_ROOT / "rules"

    # Archive safety limits. A malicious package can be a decompression bomb,
    # so every extraction is bounded before a single byte is written.
    max_archive_bytes: int = _int("BEAGLE_MAX_ARCHIVE_BYTES", 64 * 1024 * 1024)
    max_file_bytes: int = _int("BEAGLE_MAX_FILE_BYTES", 4 * 1024 * 1024)
    max_files: int = _int("BEAGLE_MAX_FILES", 3000)

    concurrency: int = _int("BEAGLE_CONCURRENCY", 8)
    semgrep_timeout_s: int = _int("BEAGLE_SEMGREP_TIMEOUT", 60)

    @property
    def clickhouse_auth(self) -> tuple[str, str]:
        return (self.clickhouse_user, self.clickhouse_password)


settings = Settings()
