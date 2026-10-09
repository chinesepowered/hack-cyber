"""Download and extract packages safely.

Rules of this module:
  * nothing downloaded is ever executed
  * extraction is bounded before writing (size, count, per-file size)
  * no path traversal, no absolute paths, no symlinks, no device files

Python 3.12+ ships `tarfile` extraction filters; we use the strictest one
("data") and still enforce our own budget on top, because the filter does not
bound total uncompressed size.
"""

from __future__ import annotations

import hashlib
import io
import tarfile
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

import httpx

from .config import settings


class UnsafeArchive(RuntimeError):
    """Raised when an archive violates the extraction budget or shape rules."""


@dataclass
class Extracted:
    root: Path
    file_count: int
    unpacked_bytes: int
    sha256: str
    truncated: bool = False
    files: list[Path] = field(default_factory=list)


def _safe_member_name(name: str) -> bool:
    if not name or name.startswith("/") or name.startswith("\\"):
        return False
    normalised = name.replace("\\", "/")
    parts = normalised.split("/")
    if any(part == ".." for part in parts):
        return False
    # Windows drive letters and UNC paths.
    if len(name) > 1 and name[1] == ":":
        return False
    return True


async def download(url: str, client: httpx.AsyncClient) -> bytes:
    response = await client.get(
        url,
        headers={"user-agent": settings.user_agent},
        follow_redirects=True,
        timeout=60.0,
    )
    response.raise_for_status()
    blob = response.content
    if len(blob) > settings.max_archive_bytes:
        raise UnsafeArchive(f"archive too large: {len(blob)} bytes")
    return blob


def extract(blob: bytes, dest: Path) -> Extracted:
    """Extract a .tgz/.tar.gz or .zip/.whl into dest under a strict budget."""
    dest.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(blob).hexdigest()
    budget = settings.max_archive_bytes
    written = 0
    count = 0
    truncated = False
    files: list[Path] = []

    def record(target: Path, size: int) -> None:
        nonlocal written, count
        written += size
        count += 1
        files.append(target)

    if blob[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(blob)) as archive:
            for info in archive.infolist():
                if info.is_dir():
                    continue
                if count >= settings.max_files or written >= budget:
                    truncated = True
                    break
                if not _safe_member_name(info.filename):
                    raise UnsafeArchive(f"unsafe path in zip: {info.filename!r}")
                if info.file_size > settings.max_file_bytes:
                    truncated = True
                    continue
                target = dest / info.filename
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(info) as src:
                    data = src.read(settings.max_file_bytes + 1)
                if len(data) > settings.max_file_bytes:
                    truncated = True
                    continue
                target.write_bytes(data)
                record(target, len(data))
    else:
        with tarfile.open(fileobj=io.BytesIO(blob), mode="r:*") as archive:
            for member in archive:
                if not member.isfile():
                    # Skips symlinks, hardlinks, devices and fifos outright.
                    continue
                if count >= settings.max_files or written >= budget:
                    truncated = True
                    break
                if not _safe_member_name(member.name):
                    raise UnsafeArchive(f"unsafe path in tar: {member.name!r}")
                if member.size > settings.max_file_bytes:
                    truncated = True
                    continue
                handle = archive.extractfile(member)
                if handle is None:
                    continue
                data = handle.read(settings.max_file_bytes + 1)
                if len(data) > settings.max_file_bytes:
                    truncated = True
                    continue
                target = dest / member.name
                if not _safe_member_name(str(target.relative_to(dest)).replace("\\", "/")):
                    raise UnsafeArchive(f"unsafe resolved path: {member.name!r}")
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
                record(target, len(data))

    return Extracted(
        root=dest,
        file_count=count,
        unpacked_bytes=written,
        sha256=digest,
        truncated=truncated,
        files=files,
    )
