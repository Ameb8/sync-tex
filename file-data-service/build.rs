// build.rs — executed by Cargo before compiling the main crate.
//
// Invokes the tonic-build code generator which:
//   1. Runs `protoc` on our .proto file.
//   2. Emits Rust source for the prost message types.
//   3. Emits Rust source for the tonic server/client stubs.
//
// The generated code is placed in OUT_DIR and included via the `include_proto!`
// macro in src/proto.rs.

fn main() -> Result<(), Box<dyn std::error::Error>> {
    tonic_build::configure()
        // Emit the server-side trait and the service descriptor.
        .build_server(true)
        // We don't need a client stub within this binary itself.
        .build_client(false)
        .compile_protos(
            &["proto/compaction.proto"], // source .proto files
            &["proto"],                  // include path (for imports)
        )?;

    // Tell Cargo to re-run this script if the proto definition changes.
    println!("cargo:rerun-if-changed=proto/compaction.proto");

    Ok(())
}