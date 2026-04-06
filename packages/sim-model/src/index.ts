// @diagram/sim-model barrel exports
export {
  SENTINEL,
  component,
  isSentinel,
  type DefaultFactory,
  type SentinelMarker,
  type RefSentinel,
  type NumericSentinel,
  type ParamSentinel,
  type ArraySentinel,
  type RecordSentinel,
  type ResolveParams,
} from "./sentinel";
export { InputNode, type InputDescriptor } from "./input";

export { Node } from "./node";
export {
  Metric,
  type MetricSnapshot,
  type MetricValue,
  type MetricParams,
  type SummaryParams,
} from "./metric";
export { type MetricUnit, formatMetricValue } from "./unit";
export { Blueprint, Engine } from "./blueprint";
export {
  type HttpMethod,
  type HttpRequestOpts,
  type HttpResponse,
} from "./builtins/blueprints/http-server";
export { Distribution } from "./distribution";
export { distributions, metrics, blueprints } from "./builtins";
export { createModel, Model, type Registration } from "./model";
export type {
  StyleRuleDescriptor,
  StyleDescriptor,
  DisplayMode,
  NodeShape,
  MatchCondition,
  NumericCondition,
  DataCondition,
  TopologyCondition,
  TopoEntry,
  NodeContext,
  GraphContext,
  MatchPredicate,
  StyleFunction,
} from "./style-rule-descriptor";
