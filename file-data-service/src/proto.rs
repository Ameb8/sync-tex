// src/proto.rs
//
// This module simply re-exports the code that tonic-build generated at compile
// time from proto/compaction.proto.  All gRPC message types and the server
// trait live here.

/// The generated module name matches the `package` declaration in the .proto
/// file (`package compaction;`).
pub mod compaction {
    // `include_proto!` expands to an `include!` pointing at the file that
    // tonic-build wrote into OUT_DIR during the build step.
    tonic::include_proto!("compaction");
}