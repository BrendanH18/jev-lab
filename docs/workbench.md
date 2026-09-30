# Workbench guide

Open `/workbench` on your running Jev Lab server. The Workbench lets you edit requests, inspect
answers, save expectations, evaluate batches, and export requests for your own application.

## Build a request

State may be text or a JSON value. Questions are an object keyed by stable question IDs. Start
with this fictional support ticket and paste the questions into the JSON editor:

**State**

```json
{"text": "Order A-1041 arrived damaged. Please refund it."}
```

**Questions**

```json
{
  "department": {
    "type": "choice",
    "instructions": "Which team should handle this ticket?",
    "criteria": {
      "billing": "Refunds, charges, or payment questions",
      "shipping": "Delivery tracking or missing parcels",
      "other": "Anything else"
    }
  },
  "wants_refund": {
    "type": "noul",
    "instructions": "Does the customer explicitly ask for a refund?"
  },
  "urgency": {
    "type": "score",
    "instructions": "How much time pressure does the ticket express?",
    "criteria": [
      "No deadline or time pressure",
      "Soon, without an immediate deadline",
      "Immediate action or an explicit urgent deadline"
    ]
  }
}
```

**Run** makes a live, paid call. Inspect each answer and its probabilities, then open **Inspect
JSON** to see the exact request and response. Adjust the questions or criteria and rerun to
compare. The built-in examples provide twelve starting patterns.

## Save expectations

Save a run as a test, name it, and edit its expectations to the behavior you intend. Defaults
reflect the observed answer; review them rather than treating them as ground truth.

Expectations are keyed by question ID:

```json
{
  "department": {"choice": "billing", "min": 0.7},
  "wants_refund": {"min": 0.8},
  "urgency": {"min": 0, "max": 1}
}
```

| Question type | Supported checks |
| --- | --- |
| Choice | `choice` checks the selected option; `min`/`max` bound the probability of that selected option |
| Noul | `min`/`max` bound the `noul` value between 0 and 1 |
| Score | `min`/`max` bound the returned numeric score |

Bounds are inclusive. An answer without an expectation is marked unchecked and does not fail
the run. Rerunning saved tests makes new API calls. Pin `TYPESAFE_DEFAULT_MODEL` to a specific
version when you want to compare wording changes against the same model.

Tests persist in `data/workbench/` as JSON containing state, questions, expectations, and notes.
These files can be committed, so use synthetic data and review each fixture first.

## Evaluate rows in bulk

Supply one text row per line or a JSON array. Text rows become objects using the selected field
name (default `text`); object and array rows are sent as their own state. The same question set
is evaluated for every row, with eight concurrent calls. The results can be sorted and exported
as CSV.

Empty rows are removed, and only the first 200 remaining rows are processed. Each row uses a
separate model call. A missing-key or budget error stops new work where possible; already admitted
calls may complete. Per-row errors remain visible in the results.

## Export a request

Export generates Python using the official SDK, JavaScript using the official SDK, or curl.
Generation runs locally and does not require a model call. The exports expect you to supply
`TYPESAFE_API_KEY` in the destination environment; they do not contain your configured key.
Exported requests call the provider directly and do not inherit Jev Lab's local spending guards
or business policies. Review the generated code before running it.

## Application limits

| Input | Limit |
| --- | --- |
| Questions per Workbench request | 100 |
| Options per Choice question | 255 |
| Levels per Score question | 2–25 |
| State in the single-request editor and saved tests | 120,000 characters after JSON serialization |
| Bulk rows | First 200 nonempty rows |
| HTTP request body | 4 MiB |

These are local application limits, not a statement of provider-wide API limits. Validation
behavior is defined in [`jev/workbench.py`](../jev/workbench.py).
