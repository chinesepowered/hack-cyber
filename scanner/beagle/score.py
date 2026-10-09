"""Turn findings and signals into a score, a verdict and a readable summary.

The scoring exists because single rules are weak evidence. `child_process.exec`
appears in thousands of honest build scripts. Credential reads appear in honest
CLI tools. What almost never appears in an honest package is install-time
execution combined with credential access, or obfuscation combined with a
loader. Combinations carry the weight here, not individual hits.
"""

from __future__ import annotations

from dataclasses import dataclass

from .scan import Finding
from .signals import Signal

EXFIL = {
    "bb-js-credential-file-exfiltration",
    "bb-py-credential-file-exfiltration",
    "bb-js-env-exfiltration",
    "bb-py-env-exfiltration",
}
LOADER = {
    "bb-js-remote-payload-execution",
    "bb-py-remote-payload-execution",
    "bb-js-decoded-blob-execution",
    "bb-py-decoded-blob-execution",
    "bb-js-reverse-shell-shape",
}
INSTALL = {
    "bb-meta-install-hook",
    "bb-js-install-hook-process-spawn",
    "bb-js-install-hook-network",
    "bb-py-setup-hook-execution",
    "bb-py-setup-custom-command-class",
}
OBFUSCATION = {"bb-heur-invisible-unicode", "bb-heur-encoded-blob"}
RECON = {"bb-js-recon-sensitive-paths"}

MALICIOUS_AT = 70
SUSPICIOUS_AT = 40


@dataclass
class Verdict:
    score: int
    verdict: str
    severity: str
    summary: str
    rule_ids: list[str]
    signal_ids: list[str]
    mitre: list[str]
    reasons: list[str]


def _combo(rules: set[str], a: set[str], b: set[str]) -> bool:
    return bool(rules & a) and bool(rules & b)


def assess(findings: list[Finding], signals: list[Signal]) -> Verdict:
    # One contribution per rule, at its highest weight. A loop that triggers
    # the same rule forty times is not forty times more suspicious.
    per_rule: dict[str, int] = {}
    mitre: set[str] = set()
    for finding in findings:
        per_rule[finding.rule_id] = max(per_rule.get(finding.rule_id, 0), finding.weight)
        mitre.update(finding.mitre)

    rules = set(per_rule)
    score = sum(per_rule.values()) + sum(signal.weight for signal in signals)
    reasons: list[str] = []

    install_time = rules & INSTALL or any(f.install_context for f in findings)

    if install_time and rules & EXFIL:
        score += 35
        reasons.append("credential access runs at install time")
    if install_time and rules & LOADER:
        score += 30
        reasons.append("a remote or decoded payload is executed at install time")
    if rules & OBFUSCATION and (rules & EXFIL or rules & LOADER):
        score += 20
        reasons.append("the dangerous code is obfuscated")
    if rules & RECON and rules & EXFIL:
        score += 15
        reasons.append("credential paths are read and the data leaves the machine")

    score = max(0, min(100, score))

    if score >= MALICIOUS_AT:
        verdict, severity = "malicious", "critical"
    elif score >= SUSPICIOUS_AT:
        verdict, severity = "suspicious", "high"
    else:
        verdict, severity = "clean", "low"

    if not reasons:
        if rules & EXFIL:
            reasons.append("credential data reaches an outbound call")
        elif rules & LOADER:
            reasons.append("code is fetched or decoded and then executed")
        elif signals:
            reasons.append(signals[0].detail)

    headline = {
        "malicious": "Malicious package",
        "suspicious": "Suspicious package",
        "clean": "No malicious behaviour found",
    }[verdict]
    summary = headline if not reasons else f"{headline}: {'; '.join(reasons[:3])}."

    return Verdict(
        score=score,
        verdict=verdict,
        severity=severity,
        summary=summary,
        rule_ids=sorted(rules),
        signal_ids=sorted({s.signal_id for s in signals}),
        mitre=sorted(mitre),
        reasons=reasons,
    )
