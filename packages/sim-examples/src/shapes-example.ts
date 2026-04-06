/**
 * "All Shapes" example — exercises every supported node shape.
 * Used for visual regression testing to ensure all six shapes render correctly.
 */
import {
  Blueprint,
  component,
  createModel,
  metrics,
  type StyleRuleDescriptor,
} from "@diagram/sim-model";

/** A blueprint that owns a metric, turning it into a group node. */
class GroupBlueprint extends Blueprint {
  params = {
    counter: component.ref(metrics.Counter),
  };

  engineOnStart() {}
}

/** A blueprint that references another node, creating an edge in the topology. */
class ConnectedBlueprint extends Blueprint {
  params = {
    target: component.ref(Blueprint),
  };

  engineOnStart() {}
}

/** Minimal blueprint with no params. */
class LeafBlueprint extends Blueprint {
  params = {};
  engineOnStart() {}
}

export const model = createModel();

// --- Metrics (owning a metric makes the parent a group) -----------------------
const groupCounter = model.create("groupCounter", metrics.Counter);

// --- Nodes — one per shape ----------------------------------------------------

// Leaf nodes (no outgoing edges from params)
const cylinderNode = model.create("cylinder-node", LeafBlueprint, () => ({
  label: "Cylinder",
}));

const circleNode = model.create("circle-node", LeafBlueprint, () => ({
  label: "Circle",
}));

const hexagonNode = model.create("hexagon-node", LeafBlueprint, () => ({
  label: "Hexagon",
}));

// Connected nodes — each references a leaf, creating an edge
const rectangleNode = model.create(
  "rectangle-node",
  ConnectedBlueprint,
  () => ({
    target: cylinderNode,
    label: "Rectangle",
  }),
);

const roundedRectNode = model.create(
  "rounded-rect-node",
  ConnectedBlueprint,
  () => ({
    target: circleNode,
    label: "Rounded Rectangle",
  }),
);

const diamondNode = model.create("diamond-node", ConnectedBlueprint, () => ({
  target: hexagonNode,
  label: "Diamond",
}));

// --- Group node (owns a metric) -----------------------------------------------
// The group references the rectangle node to create another edge
model.create("group-node", GroupBlueprint, () => ({
  counter: groupCounter,
  label: "Group (rectangle)",
  description: "A group node that owns a counter metric",
}));

// Suppress unused-variable warnings for leaf nodes
void rectangleNode;
void roundedRectNode;
void diamondNode;

// ---------------------------------------------------------------------------
// Style rules — assign one shape per node
// ---------------------------------------------------------------------------

const styles: StyleRuleDescriptor[] = [
  {
    name: "shape-rectangle",
    match: { id: "rectangle-node" },
    style: { shape: "rectangle" },
  },
  {
    name: "shape-rounded-rect",
    match: { id: "rounded-rect-node" },
    style: { shape: "rounded-rectangle" },
  },
  {
    name: "shape-cylinder",
    match: { id: "cylinder-node" },
    style: { shape: "cylinder" },
  },
  {
    name: "shape-diamond",
    match: { id: "diamond-node" },
    style: { shape: "diamond" },
  },
  {
    name: "shape-circle",
    match: { id: "circle-node" },
    style: { shape: "circle" },
  },
  {
    name: "shape-hexagon",
    match: { id: "hexagon-node" },
    style: { shape: "hexagon" },
  },
  {
    name: "shape-group",
    match: { id: "group-node" },
    style: { shape: "rectangle" },
  },
];

model.addStyleRules(styles);
