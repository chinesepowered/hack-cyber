"""Metadata signals: what the registry record says, independent of the code.

Code analysis answers "does this package do something dangerous". Metadata
answers "should this package be doing anything at all". A postinstall hook in
a two-hour-old package whose name is one character from `react` is a different
proposition from the same hook in a decade-old build tool.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from .feeds import Release

# Curated popular names used for typosquat distance. Kept small and in-repo so
# the scanner works offline; beagle seed-top-packages can replace it with a
# larger list loaded into ClickHouse.
TOP_NPM = """
react react-dom vue angular svelte next nuxt express koa fastify axios lodash
underscore moment dayjs chalk commander yargs inquirer debug webpack rollup
vite esbuild babel eslint prettier jest mocha chai sinon typescript tslib
rxjs redux zustand immer classnames clsx uuid nanoid dotenv cors helmet
mongoose sequelize prisma knex pg mysql2 redis ioredis socket.io ws
node-fetch got request superagent cheerio puppeteer playwright jsdom
semver glob rimraf fs-extra mkdirp minimist chokidar nodemon pm2 concurrently
tailwindcss postcss autoprefixer sass less styled-components emotion
graphql apollo-server bull agenda winston pino morgan body-parser
""".split()

TOP_PYPI = """
requests urllib3 numpy pandas scipy matplotlib flask django fastapi starlette
pydantic sqlalchemy alembic celery redis boto3 botocore click typer rich
pytest tox black ruff mypy flake8 isort setuptools wheel pip virtualenv
pillow opencv-python scikit-learn torch tensorflow keras transformers
beautifulsoup4 lxml selenium httpx aiohttp uvicorn gunicorn jinja2
cryptography pyyaml toml python-dateutil pytz six attrs packaging
""".split()


@dataclass
class Signal:
    signal_id: str
    weight: int
    detail: str


def levenshtein(a: str, b: str, cap: int = 3) -> int:
    """Edit distance with early exit once the distance exceeds `cap`."""
    if abs(len(a) - len(b)) > cap:
        return cap + 1
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        current = [i]
        for j, cb in enumerate(b, 1):
            current.append(
                min(
                    previous[j] + 1,
                    current[j - 1] + 1,
                    previous[j - 1] + (ca != cb),
                )
            )
        if min(current) > cap:
            return cap + 1
        previous = current
    return previous[-1]


def _normalise(name: str) -> str:
    # Strip an npm scope, and fold the separators typosquats play with.
    name = re.sub(r"^@[^/]+/", "", name)
    return name.lower().replace("_", "-").replace(".", "-")


def typosquat_of(package: str, ecosystem: str) -> tuple[str, int] | None:
    # Nobody fat-fingers their way into a scope: `@circle-fin/cli` was being
    # reported as a squat of `chai` because "cli" is two edits from it.
    if package.startswith("@"):
        return None
    candidates = TOP_NPM if ecosystem == "npm" else TOP_PYPI
    target = _normalise(package)
    if target in candidates:
        return None
    # Two edits between short names is coincidence, not intent.
    max_distance = 1 if len(target) < 6 else 2
    best: tuple[str, int] | None = None
    for candidate in candidates:
        distance = levenshtein(target, candidate)
        if distance <= max_distance and (best is None or distance < best[1]):
            best = (candidate, distance)
    return best


def metadata_signals(release: Release, now: datetime | None = None) -> list[Signal]:
    now = now or datetime.now(timezone.utc)
    out: list[Signal] = []

    squat = typosquat_of(release.package, release.ecosystem)
    if squat:
        name, distance = squat
        out.append(
            Signal(
                "typosquat-candidate",
                30 if distance == 1 else 18,
                f"{release.package!r} is {distance} edit(s) from popular package {name!r}",
            )
        )

    if release.has_install_script or release.install_scripts:
        created = release.raw.get("created")
        age_note = ""
        if created:
            try:
                created_at = datetime.fromisoformat(str(created).replace("Z", "+00:00"))
                if now - created_at < timedelta(days=30):
                    out.append(
                        Signal(
                            "new-package-install-hook",
                            25,
                            f"package first published {(now - created_at).days}d ago "
                            "and runs code at install time",
                        )
                    )
                age_note = f" (first published {(now - created_at).days}d ago)"
            except ValueError:
                pass
        out.append(
            Signal("has-install-hook", 5, f"declares install-time scripts{age_note}")
        )

    if not release.repository:
        out.append(
            Signal("no-source-repository", 8, "no source repository declared in metadata")
        )

    total_versions = release.raw.get("all_versions")
    if isinstance(total_versions, int) and total_versions == 1:
        out.append(Signal("first-ever-release", 6, "first ever release of this package"))

    return out
