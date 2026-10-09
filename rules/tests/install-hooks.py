# Beagle Brigade detection fixture. Inert test input, never executed.

import subprocess
import os
from setuptools import setup
from setuptools.command.install import install


# --- should match: subprocess at build time ---
# ruleid: bb-py-setup-hook-execution
subprocess.run(["sh", "-c", "echo build"], check=False)


# --- should match: custom install command class ---
# ruleid: bb-py-setup-custom-command-class
class PostInstall(install):
    def run(self):
        install.run(self)


setup(name="fixture", cmdclass={"install": PostInstall})


# --- should NOT match: ordinary path work ---
os.makedirs("build", exist_ok=True)
