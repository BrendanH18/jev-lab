import { $, api, currentStatus, h, mount } from "./common.js";
import { W } from "./workbench-state.js";

// Shared suggestions for saved checks, upgrades, and Compare. Any model name can still be typed.
export function loadModels() {
  const c = W.compare;
  if (c.models || c.modelsLoading || !currentStatus()?.configured) return;
  c.modelsLoading = true;
  api("/api/models")
    .then((res) => {
      c.models = (res.models || []).map((m) => m.name);
      const list = $("#cmp-models");
      if (list)
        mount(
          list,
          c.models.map((n) => h("option", { value: n })),
        );
    })
    .catch(() => {
      c.models = []; /* typing a name still works */
    })
    .finally(() => {
      c.modelsLoading = false;
    });
}
