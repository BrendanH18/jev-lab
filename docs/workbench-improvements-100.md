# 100 Workbench improvements

This batch continues the Workbench's local authoring and dataset management work. No new
service or dependency is required. Browsing and editor controls make no model calls and
never persist model answers. Paid runs remain explicit and keep their spend-preview guards.

The complete inventory is split by workflow:

| Numbers | Workflow | Inventory |
| --- | --- | --- |
| 1–30 | Build: authored-content diagnostics, navigation and sharing | [30 authoring improvements](build-improvements-100.md) |
| 31–60 | Tests: suite triage, measurements and selection recovery | [30 saved-test improvements](tests-improvements-100.md) |
| 61–90 | Datasets: split/guideline metadata, search, sorting and pins | [30 catalog improvements](catalog-improvements-100.md) |
| 91–100 | Examples: discovery, request previews and compact browsing | [10 gallery improvements](examples-improvements-100.md) |

Advanced authoring, suite and catalog controls sit in disclosures. Filters compose and change
presentation only. Metadata exports keep explicit allowlists; they do not contain inputs, labels,
notes, instructions, model answers or check configuration. Authored question and request handoffs
are separately labeled and contain only their explicitly selected authored content.

Focused tests cover the new filters, stable sorts, Unicode counts, unknown observations, hidden
selections and pins, sharing boundaries, mounted queues, and examples' explicit editor handoff.
No built-in scenario or model question wording changed, so live scenario validation is unchanged.
