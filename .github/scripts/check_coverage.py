#!/usr/bin/env python3
"""Fail CI when Clover line/statement coverage falls below a threshold.

Usage: python check_coverage.py <clover.xml> <min_percent>

Reads the project-level <metrics> aggregate emitted by PHPUnit/Clover and
compares coveredstatements/statements against the minimum. Stdlib only so it
runs on the runner's preinstalled python3 with no extra dependency.
"""
import sys
import xml.etree.ElementTree as ET


def coverage_percent(clover_path):
    metrics = ET.parse(clover_path).getroot().find("project/metrics")
    if metrics is None:
        raise ValueError("no <project><metrics> element in clover report")
    statements = int(metrics.get("statements", 0))
    covered = int(metrics.get("coveredstatements", 0))
    if statements == 0:
        return 100.0
    return covered / statements * 100


def main(argv):
    if len(argv) != 3:
        print("usage: check_coverage.py <clover.xml> <min_percent>", file=sys.stderr)
        return 2
    clover_path = argv[1]
    try:
        min_percent = float(argv[2])
        percent = coverage_percent(clover_path)
    except (FileNotFoundError, ET.ParseError, ValueError) as error:
        print(f"coverage gate error: {error}", file=sys.stderr)
        return 2
    print(f"coverage: {percent:.2f}% (min {min_percent:.2f}%)")
    if percent < min_percent:
        print("coverage gate FAILED", file=sys.stderr)
        return 1
    print("coverage gate passed")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
