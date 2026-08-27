import { parse } from 'protobufjs';

const schema = parse(`
  syntax = "proto3";
  package agentusage.otlp;

  message ExportMetricsServiceRequest {
    repeated ResourceMetrics resource_metrics = 1;
  }

  message ResourceMetrics {
    Resource resource = 1;
    repeated ScopeMetrics scope_metrics = 2;
    string schema_url = 3;
  }

  message Resource {
    repeated KeyValue attributes = 1;
    uint32 dropped_attributes_count = 2;
  }

  message ScopeMetrics {
    InstrumentationScope scope = 1;
    repeated Metric metrics = 2;
    string schema_url = 3;
  }

  message InstrumentationScope {
    string name = 1;
    string version = 2;
    repeated KeyValue attributes = 3;
    uint32 dropped_attributes_count = 4;
  }

  message Metric {
    string name = 1;
    string description = 2;
    string unit = 3;
    oneof data {
      Sum sum = 7;
    }
  }

  message Sum {
    repeated NumberDataPoint data_points = 1;
    AggregationTemporality aggregation_temporality = 2;
    bool is_monotonic = 3;
  }

  enum AggregationTemporality {
    AGGREGATION_TEMPORALITY_UNSPECIFIED = 0;
    AGGREGATION_TEMPORALITY_DELTA = 1;
    AGGREGATION_TEMPORALITY_CUMULATIVE = 2;
  }

  message NumberDataPoint {
    repeated KeyValue attributes = 7;
    fixed64 start_time_unix_nano = 2;
    fixed64 time_unix_nano = 3;
    oneof value {
      double as_double = 4;
      sfixed64 as_int = 6;
    }
    uint32 flags = 8;
  }

  message KeyValue {
    string key = 1;
    AnyValue value = 2;
  }

  message AnyValue {
    oneof value {
      string string_value = 1;
      bool bool_value = 2;
      int64 int_value = 3;
      double double_value = 4;
      bytes bytes_value = 7;
    }
  }
`).root;

const exportRequest = schema.lookupType('agentusage.otlp.ExportMetricsServiceRequest');

export function decodeOtlpMetricsProtobuf(payload: Uint8Array): unknown {
  const decoded = exportRequest.decode(payload);
  return exportRequest.toObject(decoded, {
    longs: String,
    enums: String,
    bytes: String,
    defaults: false,
    oneofs: false
  });
}

export function encodeOtlpMetricsProtobuf(payload: object): Uint8Array {
  const message = exportRequest.fromObject(payload);
  const verificationError = exportRequest.verify(message);
  if (verificationError) throw new Error(`Invalid OTLP metrics fixture: ${verificationError}`);
  return exportRequest.encode(message).finish();
}
