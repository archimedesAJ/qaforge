# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-05-18

### Added
- **Test case management** — create, edit, archive, and version manual, functional, UI auto, API, perf, and exploratory test cases
- **Test runs** — open runs, pick cases, execute, and close with a pass-rate summary
- **Manual runner** — step-by-step test execution with pass/fail/blocked/skipped per step
- **Exploratory runner** — charter-based sessions with a live session log and debrief
- **API runner** — in-browser HTTP test execution with header and body configuration
- **JUnit XML ingest** — CI/CD pipeline integration with auto-import of unmatched test cases
- **Performance metrics ingest** — k6/Locust/JMeter results with baseline comparison and threshold breach detection
- **Results viewer** — filterable, searchable results table with CSV and PDF export
- **Coverage snapshots** — per-test-case pass rate and staleness tracking computed on run close
- **Flakiness scores** — transition-based flakiness scoring for automated test cases
- **Trend series** — daily pass rate aggregation for dashboard charts
- **Insights dashboard** — coverage, flakiness, and trend charts per project
- **Project management** — multi-project workspace with member roles (admin, editor, viewer)
- **API keys** — project-scoped API keys for CI/CD integration
- **AI assistant** — Anthropic Claude integration for test case suggestions
- **Production Docker** — one-command deployment with `docker compose up`
- **Database indexes** — performance indexes on `RunResult`, `CoverageSnapshot`, `FlakinessScore`, and `TrendSeries`
