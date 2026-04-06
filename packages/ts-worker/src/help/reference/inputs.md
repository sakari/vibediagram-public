# Inputs Reference

`InputNode` creates a UI control (slider or toggle) that users can
adjust at runtime while the simulation runs.

## Number input

```typescript
const rate = model.create("rate", InputNode, () => ({
  kind: "number",
  defaultValue: 50,
  min: 1,
  max: 200,
  step: 1,
  label: "Request Rate",
}));
```

## Boolean input

```typescript
const enabled = model.create("cacheEnabled", InputNode, () => ({
  kind: "boolean",
  defaultValue: 1, // 1 = true, 0 = false
  label: "Cache Enabled",
}));
```

## Reading the value

Access the current value inside a Blueprint via `this.params`:

```typescript
class Server extends Blueprint {
  params = {
    rate: component.ref(InputNode),
  };

  engineOnStart() {
    void this.run();
  }

  async run() {
    for (;;) {
      const interval = 1 / this.params.rate.value;
      await this.engine.timeout(interval);
      // send request...
    }
  }
}
```

The `.value` property reflects the user's current slider/toggle position
and updates immediately when the user changes it during simulation.

## Declaring input params

```typescript
class MyNode extends Blueprint {
  params = {
    capacity: component.ref(InputNode),
  };
}
```

Each `component.ref(InputNode)` creates a diagram edge and the input
appears as a child node with a slider or toggle control.
