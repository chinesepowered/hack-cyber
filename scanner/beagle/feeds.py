"""Tail new releases from npm and PyPI.

npm uses the replication _changes feed. The endpoints moved in 2025: the feed
no longer accepts `since=now` or `descending`, so we read the current
`update_seq` from the database root and walk forward from there.

For npm metadata we request the abbreviated document
(application/vnd.npm.install-v1+json). It is a fraction of the size of the
full document, and it carries the one metadata flag that matters most to us:
`hasInstallScript`. Publisher details are fetched lazily, only for packages
that end up flagged.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from xml.etree import ElementTree

import httpx

from .config import settings

NPM_REPLICATE = "https://replicate.npmjs.com"
NPM_REGISTRY = "https://registry.npmjs.org"
PYPI = "https://pypi.org"

ABBREVIATED = "application/vnd.npm.install-v1+json"


@dataclass
class Release:
    ecosystem: str
    package: str
    version: str
    published_at: datetime
    tarball_url: str
    publisher: str = ""
    publisher_email: str = ""
    repository: str = ""
    has_install_script: bool = False
    install_scripts: dict[str, str] = field(default_factory=dict)
    raw: dict[str, Any] = field(default_factory=dict)

    @property
    def key(self) -> str:
        return f"{self.ecosystem}:{self.package}@{self.version}"


def _headers(accept: str = "application/json") -> dict[str, str]:
    return {"user-agent": settings.user_agent, "accept": accept}


def _parse_iso(value: str | None) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return datetime.now(timezone.utc)


# --------------------------------------------------------------------------
# npm
# --------------------------------------------------------------------------


async def npm_current_seq(client: httpx.AsyncClient) -> int:
    response = await client.get(NPM_REPLICATE + "/", headers=_headers(), timeout=30.0)
    response.raise_for_status()
    return int(response.json()["update_seq"])


async def npm_changes(
    client: httpx.AsyncClient, since: int, limit: int = 200
) -> tuple[list[str], int]:
    """Return (package names, last_seq) for changes after `since`."""
    response = await client.get(
        NPM_REPLICATE + "/_changes",
        params={"since": since, "limit": limit},
        headers=_headers(),
        timeout=60.0,
    )
    response.raise_for_status()
    payload = response.json()
    names = [
        row["id"]
        for row in payload.get("results", [])
        if not row.get("deleted") and not row["id"].startswith("_")
    ]
    return names, int(payload.get("last_seq", since))


async def npm_latest_release(client: httpx.AsyncClient, package: str) -> Release | None:
    response = await client.get(
        f"{NPM_REGISTRY}/{package}",
        headers=_headers(ABBREVIATED),
        timeout=45.0,
    )
    if response.status_code != 200:
        return None
    doc = response.json()
    latest = (doc.get("dist-tags") or {}).get("latest")
    versions = doc.get("versions") or {}
    if not latest or latest not in versions:
        if not versions:
            return None
        latest = sorted(versions)[-1]
    version_doc = versions[latest]
    dist = version_doc.get("dist") or {}
    tarball = dist.get("tarball")
    if not tarball:
        return None
    return Release(
        ecosystem="npm",
        package=package,
        version=latest,
        published_at=_parse_iso(doc.get("modified")),
        tarball_url=tarball,
        has_install_script=bool(version_doc.get("hasInstallScript")),
        raw={"abbreviated": True},
    )


async def npm_enrich(client: httpx.AsyncClient, release: Release) -> Release:
    """Fetch publisher and repository for a flagged package only."""
    try:
        response = await client.get(
            f"{NPM_REGISTRY}/{release.package}", headers=_headers(), timeout=45.0
        )
        if response.status_code != 200:
            return release
        doc = response.json()
    except (httpx.HTTPError, ValueError):
        return release

    version_doc = (doc.get("versions") or {}).get(release.version) or {}
    npm_user = version_doc.get("_npmUser") or {}
    maintainers = doc.get("maintainers") or []
    repo = version_doc.get("repository") or doc.get("repository") or {}
    repo_url = repo.get("url", "") if isinstance(repo, dict) else str(repo)
    times = doc.get("time") or {}

    release.publisher = npm_user.get("name") or (
        maintainers[0].get("name") if maintainers else ""
    )
    release.publisher_email = npm_user.get("email", "")
    release.repository = re.sub(r"^git\+|\.git$", "", repo_url)
    release.install_scripts = {
        k: v
        for k, v in (version_doc.get("scripts") or {}).items()
        if k in {"preinstall", "install", "postinstall", "prepare"}
    }
    if release.version in times:
        release.published_at = _parse_iso(times[release.version])
    release.raw["all_versions"] = len(doc.get("versions") or {})
    release.raw["created"] = times.get("created", "")
    return release


# --------------------------------------------------------------------------
# PyPI
# --------------------------------------------------------------------------

_RSS_TITLE = re.compile(r"^(?P<name>\S+)\s+(?P<version>\S+)$")


async def pypi_recent(client: httpx.AsyncClient) -> list[tuple[str, str]]:
    """Recent PyPI releases as (name, version) from the updates RSS feed."""
    response = await client.get(
        f"{PYPI}/rss/updates.xml", headers=_headers("application/rss+xml"), timeout=30.0
    )
    response.raise_for_status()
    root = ElementTree.fromstring(response.text)
    out: list[tuple[str, str]] = []
    for item in root.iterfind(".//item"):
        title = (item.findtext("title") or "").strip()
        match = _RSS_TITLE.match(title)
        if match:
            out.append((match.group("name"), match.group("version")))
    return out


async def pypi_release(
    client: httpx.AsyncClient, package: str, version: str
) -> Release | None:
    response = await client.get(
        f"{PYPI}/pypi/{package}/{version}/json", headers=_headers(), timeout=45.0
    )
    if response.status_code != 200:
        return None
    doc = response.json()
    info = doc.get("info") or {}
    urls = doc.get("urls") or []
    # Prefer the sdist: it carries setup.py, which is where install-time code
    # lives. Fall back to the wheel.
    chosen = next((u for u in urls if u.get("packagetype") == "sdist"), None)
    chosen = chosen or next(iter(urls), None)
    if not chosen or not chosen.get("url"):
        return None

    project_urls = info.get("project_urls") or {}
    repository = ""
    for key in ("Source", "Source Code", "Repository", "Homepage", "Code"):
        if project_urls.get(key):
            repository = project_urls[key]
            break

    return Release(
        ecosystem="pypi",
        package=package,
        version=version,
        published_at=_parse_iso(chosen.get("upload_time_iso_8601")),
        tarball_url=chosen["url"],
        publisher=info.get("author") or info.get("maintainer") or "",
        publisher_email=info.get("author_email") or info.get("maintainer_email") or "",
        repository=repository,
        raw={"packagetype": chosen.get("packagetype", "")},
    )
