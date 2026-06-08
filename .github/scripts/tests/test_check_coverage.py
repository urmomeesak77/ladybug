"""Unit tests for the Clover coverage gate (CI tooling, not application code)."""
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "check_coverage.py"

CLOVER_TEMPLATE = """<?xml version="1.0" encoding="UTF-8"?>
<coverage generated="1">
  <project timestamp="1">
    <metrics files="1" loc="10" statements="{statements}" \
coveredstatements="{covered}" methods="1" coveredmethods="1"/>
  </project>
</coverage>
"""


def run_gate(statements, covered, threshold):
    with tempfile.NamedTemporaryFile("w", suffix=".xml", delete=False) as handle:
        handle.write(CLOVER_TEMPLATE.format(statements=statements, covered=covered))
        path = handle.name
    try:
        return subprocess.run(
            [sys.executable, str(SCRIPT), path, str(threshold)],
            capture_output=True,
            text=True,
        )
    finally:
        os.unlink(path)


class CoverageGateTest(unittest.TestCase):
    def test_passes_above_threshold(self):
        result = run_gate(100, 95, 90)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_fails_below_threshold(self):
        result = run_gate(100, 80, 90)
        self.assertEqual(result.returncode, 1, result.stdout)

    def test_exactly_at_threshold_passes(self):
        result = run_gate(100, 90, 90)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_zero_statements_passes(self):
        result = run_gate(0, 0, 90)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
