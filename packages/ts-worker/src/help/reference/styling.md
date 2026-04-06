# Styling Reference

Style rules control how nodes appear in the diagram based on their
state, type, or position in the topology.

## Adding style rules

```typescript
model.addStyleRules([
  {
    name: "my-rule",
    priority: 10,
    match: { id: "cache" },
    style: { borderColor: "#2ecc71" },
  },
]);
```

Higher `priority` rules are applied later and win on conflicting properties.

## Match conditions

### Declarative matching

```typescript
// Match by node ID
match: {
  id: "cache";
}

// Match by class name
match: {
  data: {
    className: "Pool";
  }
}

// Match by topology
match: {
  topology: {
    inDegree: 0;
  }
} // source nodes
match: {
  topology: {
    isGroup: true;
  }
} // group nodes
match: {
  topology: {
    hasParent: true;
  }
} // nested nodes

// Numeric conditions
match: {
  topology: {
    inDegree: {
      gt: 2;
    }
  }
} // > 2 incoming edges
match: {
  topology: {
    outDegree: {
      lte: 1;
    }
  }
} // <= 1 outgoing edge
```

### Function predicates

```typescript
// Simple predicate
match: (node) => node.id.startsWith("backend-");

// With graph context
match: (node, graph) =>
  graph.referrers(node).some((r) => r.topology.inDegree === 0);
```

**NodeContext** available in predicates:

- `node.id` — node identifier
- `node.type` — node type
- `node.data` — node data properties (e.g. `className`)
- `node.topology` — `{ inDegree, outDegree, isGroup, hasParent }`
- `node.metric(name)` — read a metric value by name

**GraphContext** available in predicates:

- `graph.referrers(node)` — nodes pointing TO this node
- `graph.targets(node)` — nodes this node points TO
- `graph.rank(node, metricName)` — rank of metric value (1 = highest)
- `graph.all()` — all nodes in the graph

## Style properties

### Static styles

```typescript
style: {
  background: "#1a3a2a",
  borderColor: "#2ecc71",
  borderWidth: 2,
  opacity: 0.8,
  boxShadow: "0 0 8px rgba(46, 204, 113, 0.5)",
}
```

### Dynamic styles

```typescript
style: (node) => {
  const util = node.metric("utilization") ?? 0;
  return {
    borderColor: util > 0.8 ? "#e74c3c" : "#2ecc71",
    background: util > 0.8 ? "#3a1a1a" : "#1a3a2a",
  };
};

// With graph context
style: (node, graph) => {
  const rank = graph.rank(node, "qps");
  return { borderWidth: rank === 1 ? 3 : 1 };
};
```

### Display modes

The `display` property controls node visibility and layout:

- `"node"` — normal visible node (default)
- `"group-child"` — rendered inside a parent group
- `"inline"` — rendered as inline text within parent
- `"hidden"` — not rendered

### Grouping

The `groupInto` property assigns a node to a visual parent group:

```typescript
style: {
  groupInto: "backend-cluster";
}
```

## Class-level default styles

Override `static defaultStyleRules()` on a Node class to provide
defaults for all instances of that class:

```typescript
class Pool extends Blueprint {
  static defaultStyleRules(): StyleRuleDescriptor[] {
    return [
      ...super.defaultStyleRules(),
      {
        name: "pool-base",
        match: { data: { className: "Pool" } },
        style: { borderColor: "#3498db" },
      },
    ];
  }
}
```

## Full example

```typescript
model.addStyleRules([
  // Color-code by utilization
  {
    name: "pool-heat",
    priority: 10,
    match: { data: { className: "Pool" } },
    style: (node) => {
      const util = node.metric("utilization") ?? 0;
      return {
        borderColor: util > 0.8 ? "#e74c3c" : "#3498db",
        background: `rgba(${Math.round(200 * util)}, ${Math.round(60 * (1 - util))}, 40, 0.8)`,
      };
    },
  },
  // Highlight source nodes
  {
    name: "sources",
    match: (node) => node.topology.inDegree === 0,
    style: { borderColor: "#2ecc71", background: "#1a3a2a" },
  },
  // Style groups
  {
    name: "groups",
    match: { topology: { isGroup: true } },
    style: { background: "rgba(44, 62, 80, 0.6)", borderColor: "#3498db" },
  },
]);
```
