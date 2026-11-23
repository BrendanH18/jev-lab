// Portable ZIP bundles for saved Workbench datasets.
import { api, h, handleError, toast } from "./common.js";
import { slugOf } from "./dataset-catalog.js";
import { W } from "./workbench-state.js";
import { render } from "./workbench.js";
import { confirmReviewDiscard } from "./workbench-review.js";

export async function exportBundle(id) {
  try {
    const { filename, data } = await api("/api/workbench/datasets/bundle/export", { id });
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
    const link = h("a", { href: url, download: filename });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    handleError(e);
  }
}

async function previewBundle(file) {
  if (!file) return;
  const b = W.bulk.bundle;
  b.data = b.report = null;
  b.busy = true;
  render();
  try {
    if (file.size > 8 * 1024 * 1024) throw new Error("Dataset bundles must be at most 8 MiB.");
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = () => reject(new Error("Could not read the bundle."));
      reader.readAsDataURL(file);
    });
    b.report = await api("/api/workbench/datasets/bundle/preview", { data });
    b.data = data;
    b.name = b.report.dataset.name;
  } catch (e) {
    handleError(e);
  }
  b.busy = false;
  render();
}

async function importBundle() {
  const bulk = W.bulk;
  const b = bulk.bundle;
  const name = b.name.trim();
  const id = slugOf(name);
  if (!id) return toast("Give the imported dataset a name", "error");
  const replace = bulk.datasets.some((x) => x.id === id);
  if (!confirmReviewDiscard(id)) return;
  if (replace && !confirm(`Replace the saved dataset “${id}” with this bundle, including its check and test history?`))
    return;
  b.busy = true;
  render();
  try {
    await api("/api/workbench/datasets/bundle/import", { data: b.data, name, replace });
    // Reports and linked editors for an overwritten dataset refer to the old file.
    delete bulk.checkRuns[id];
    delete bulk.agreeRuns[id];
    if (bulk.dataset.id === id) {
      bulk.dataset.id = null;
      bulk.testScore = null;
    }
    bulk.datasets = (await api("/api/workbench/datasets")).datasets;
    b.data = b.report = null;
    toast(`Imported “${name}”. Load it to work with its rows; run it to get answers.`);
  } catch (e) {
    handleError(e);
  }
  b.busy = false;
  render();
}

export function bundleImportForm() {
  const b = W.bulk.bundle;
  const file = h("input", {
    type: "file",
    accept: ".zip,application/zip",
    disabled: b.busy,
    "aria-label": "Choose dataset bundle",
    onchange: () => previewBundle(file.files[0]),
  });
  const name = h("input", { class: "input", value: b.name, disabled: b.busy, "aria-label": "Imported dataset name" });
  name.addEventListener("input", () => {
    b.name = name.value;
  });
  const d = b.report?.dataset;
  return h(
    "div",
    { class: "grid", style: { gap: "6px" } },
    h("b", {}, "Import dataset bundle"),
    file,
    h(
      "p",
      { class: "faint", style: { fontSize: "12px", margin: 0 } },
      "Preview a ZIP before saving. Bundles carry rows, human labels, questions, gate settings, test history, and pictures. No model calls. Limit: 8 MiB. Review your input data before sharing it.",
    ),
    b.busy ? h("p", { class: "faint" }, "Reading or saving bundle…") : null,
    d
      ? h(
          "div",
          { class: "grid", style: { gap: "6px" } },
          h(
            "span",
            { class: "muted" },
            `${d.rows.length} rows · ${Object.keys(d.questions || {}).length} questions · ${b.report.images} pictures · ${d.check ? "saved check" : "no check"} · ${d.test ? `${d.test.looks.length} test evaluations` : "no test history"}`,
          ),
          h(
            "details",
            {},
            h("summary", {}, "Preview dataset contents"),
            h("pre", { class: "code", style: { maxHeight: "240px", overflow: "auto" } }, JSON.stringify(d, null, 2)),
          ),
          name,
          h(
            "div",
            {},
            h("button", { class: "btn sm primary", disabled: b.busy, onclick: importBundle }, "Import bundle"),
            h(
              "button",
              {
                class: "btn sm ghost",
                disabled: b.busy,
                onclick: () => {
                  b.data = b.report = null;
                  render();
                },
              },
              "Cancel",
            ),
          ),
        )
      : null,
  );
}
