// Lab host: what a page gets from createLab(packs). It indexes the packs by surface, keeps each surface's
// session-only presentation state (filters, sort, open blocks, drafts), and answers the three calls a surface makes:
//   LAB.matches(surfaceId, item, ctx)   inside the surface's own "is this item shown" test
//   LAB.arrange(surfaceId, items, ctx)  on the shown items, to apply a Lab sort
//   LAB.section(env, surfaceId, ctx)    to render the Lab tools block
// A surface's ctx is { items(), shown(), data, actions, refresh(), itemName(item, index), env }: items() is the whole
// list as plain objects, shown() what every filter (the page's and Lab's) leaves, data the read-only values packs may
// read, actions the page's own operations, and env { toast, copy, download }. State lives only in this object:
// nothing here reads or writes storage, the network or the model.
import { featureKey, improvementsOf, keysMatch, matchesFilters, parseKeys, sortByFact, filterActive, typingTarget } from "./kit.js";
import { renderSection } from "./ui.js";

const newView = () => ({ open: {}, filters: [], sort: null, sortDir: "asc", factQuery: "", draft: { key: "", op: "", value: "" }, summaryKey: "",
  findings: null, transform: { key: "", values: {}, preview: null, undo: null, error: "" },
  importer: { key: "", text: "", preview: null, error: "" },
  tool: { key: "", query: "", group: "", values: {}, result: null, error: "" }, panels: {} });

// builders: the ctx builders of static/js/lab/surfaces/*.js for this page, so page code can reach them as LAB.builders.
export function createLab(packs, builders = {}) {
  const surfaces = new Map();
  const seen = new Set();
  for (const pack of packs) {
    if (seen.has(pack.id)) throw new Error(`Lab pack ${pack.id} is loaded twice`);
    seen.add(pack.id);
    if (!surfaces.has(pack.surface)) {
      surfaces.set(pack.surface, { id: pack.surface, packs: [], count: 0, facts: new Map(), byKind: {} });
    }
    const surface = surfaces.get(pack.surface);
    surface.packs.push(pack);
    for (const feature of pack.features) {
      const key = featureKey(pack, feature);
      (surface.byKind[feature.kind] ||= []).push([key, feature, pack]);
      if (feature.kind === "fact") surface.facts.set(key, feature);
    }
    surface.count += improvementsOf(pack).length;
  }
  const views = new Map();
  const mounted = new Map();
  const view = (id) => {
    if (!views.has(id)) views.set(id, newView());
    return views.get(id);
  };
  const entries = (id, kind) => surfaces.get(id)?.byKind[kind] || [];

  const lab = {
    packs,
    builders,
    surface: (id) => surfaces.get(id) || null,
    surfaceIds: () => [...surfaces.keys()],
    entries,
    view,
    // How many improvements a surface holds, for its "Lab tools · N" heading.
    count: (id) => surfaces.get(id)?.count || 0,
    matches(id, item, ctx) {
      const surface = surfaces.get(id);
      return !surface || !views.has(id) || matchesFilters(item, views.get(id).filters, surface.facts, ctx);
    },
    arrange(id, items, ctx) {
      const surface = surfaces.get(id);
      const sort = surface && views.has(id) ? views.get(id).sort : null;
      return sort && surface.facts.has(sort.key) ? sortByFact(items, sort, surface.facts, ctx) : items;
    },
    refine(id, items, ctx) {
      return lab.arrange(id, items.filter((item) => lab.matches(id, item, ctx)), ctx);
    },
    // Active Lab filters plus an active Lab sort, for a surface's own "filters active" count.
    active(id) {
      const state = views.get(id);
      const surface = surfaces.get(id);
      if (!state || !surface) return 0;
      return state.filters.filter((filter) => surface.facts.has(filter.key) && filterActive(filter)).length + (state.sort && surface.facts.has(state.sort.key) ? 1 : 0);
    },
    reset(id) {
      const state = views.get(id);
      if (state) { state.filters = []; state.sort = null; state.findings = null; }
    },
    // Remember a surface's latest ctx so its commands can run from the palette and from shortcuts.
    mount(id, ctx) { mounted.set(id, ctx); },
    unmount(id) { mounted.delete(id); },
    unmountAll(keep = []) {
      for (const id of [...mounted.keys()]) if (!keep.includes(id)) mounted.delete(id);
    },
    mountedIds: () => [...mounted.keys()],
    // [[key, command, ctx], ...] for every mounted surface, in pack order.
    commandEntries() {
      const out = [];
      for (const [id, ctx] of mounted) for (const [key, command] of entries(id, "command")) out.push([key, command, ctx]);
      return out;
    },
    // Runs the first mounted command whose shortcut matches a keydown. Chords without Ctrl, Cmd or Alt are ignored
    // while the user is typing. Returns the command's key, or null when nothing ran.
    handleKey(event, onError = () => {}) {
      for (const [key, command, ctx] of lab.commandEntries()) {
        if (!command.keys || !keysMatch(event, command.keys)) continue;
        if (parseKeys(command.keys).bare && typingTarget(event.target)) continue;
        let available = true;
        try { available = !command.when || command.when(ctx) !== false; } catch { available = false; }
        if (!available) continue;
        try { Promise.resolve(command.run(ctx)).catch(onError); } catch (error) { onError(error); }
        return key;
      }
      return null;
    },
    // The Lab tools block for a surface, or null when no pack contributes to it. Gives ctx its env (toast, copy,
    // download) and mounts the surface so its commands are reachable.
    section(env, id, ctx, options = {}) {
      if (!surfaces.has(id)) return null;
      if (!ctx.env) ctx.env = env;
      mounted.set(id, ctx);
      return renderSection(env, lab, id, ctx, options);
    },
    improvements: () => packs.flatMap((pack) => improvementsOf(pack)),
  };
  return lab;
}
