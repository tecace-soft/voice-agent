"""Scenario tests: a scripted caller talks to the real GPT-Live receptionist once per scenario.

The design is docs/superpowers/specs/2026-10-01-scenario-tests-design.md. transcribe-backend owns
the scenarios, the sandbox tools and the grading; this package only drives the call.
"""
