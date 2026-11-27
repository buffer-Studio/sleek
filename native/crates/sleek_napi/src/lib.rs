mod gateway_bridge;
mod panic_guard;

use napi_derive::napi;

pub use gateway_bridge::{GatewayCluster, JsGatewayBatch, JsGatewayBatchEvent, JsGatewayConfig};
use panic_guard::guard_panic;

#[napi]
pub fn shutdown_native_runtime(timeout_ms: Option<u32>) -> napi::Result<()> {
  guard_panic("shutdownNativeRuntime", || {
    gateway_bridge::shutdown_runtime(timeout_ms.unwrap_or(3000));
    Ok(())
  })
}
