use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ErrorStrategy, ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;
use sleek_gateway::{GatewayBatch, GatewayConfig, GatewaySupervisor};

use crate::panic_guard::guard_panic;

static RUNTIME: OnceLock<Mutex<Option<tokio::runtime::Runtime>>> = OnceLock::new();

fn with_runtime<T, F>(f: F) -> napi::Result<T>
where
  F: FnOnce(&tokio::runtime::Handle) -> T,
{
  let mutex = RUNTIME.get_or_init(|| {
    let rt = tokio::runtime::Builder::new_multi_thread()
      .enable_all()
      .thread_name("sleek-gateway")
      .build()
      .expect("failed to build tokio runtime");
    Mutex::new(Some(rt))
  });
  let guard = mutex
    .lock()
    .map_err(|_| Error::from_reason("Tokio runtime lock poisoned"))?;
  let rt = guard
    .as_ref()
    .ok_or_else(|| Error::from_reason("Native runtime has already been shut down"))?;
  Ok(f(rt.handle()))
}

pub fn shutdown_runtime(timeout_ms: u32) {
  if let Some(mutex) = RUNTIME.get() {
    if let Ok(mut guard) = mutex.lock() {
      if let Some(rt) = guard.take() {
        rt.shutdown_timeout(Duration::from_millis(u64::from(timeout_ms)));
      }
    }
  }
}

#[napi(object)]
pub struct JsGatewayBatchEvent {
  pub platform: String,
  pub shard_id: u32,
  pub event_type: String,
  pub raw_json: String,
}

#[napi(object)]
pub struct JsGatewayBatch {
  pub events: Vec<JsGatewayBatchEvent>,
  pub dropped_count: f64,
}

#[napi(object)]
pub struct JsIdentifyRequest {
  pub platform: String,
  pub shard_id: u32,
}

#[napi(object)]
pub struct JsGatewayConfig {
  pub discord_token: Option<String>,
  pub discord_intents: Option<f64>,
  pub discord_shard_start: Option<u32>,
  pub discord_shard_end: Option<u32>,
  pub discord_total_shards: Option<u32>,
  pub fluxer_token: Option<String>,
  pub fluxer_ws_url: Option<String>,
  pub fluxer_shard_start: Option<u32>,
  pub fluxer_shard_end: Option<u32>,
  pub fluxer_total_shards: Option<u32>,
  pub interest_mask: Option<f64>,
}

#[napi]
pub struct GatewayCluster {
  supervisor: Mutex<Option<GatewaySupervisor>>,
}

#[napi]
impl GatewayCluster {
  #[napi(constructor)]
  pub fn new() -> napi::Result<Self> {
    guard_panic("GatewayCluster::new", || {
      Ok(Self {
        supervisor: Mutex::new(None),
      })
    })
  }

  #[napi]
  pub fn start(
    &self,
    config: JsGatewayConfig,
    #[napi(ts_arg_type = "(err: Error | null, batch: JsGatewayBatch) => void")]
    on_batch: ThreadsafeFunction<JsGatewayBatch, ErrorStrategy::CalleeHandled>,
    #[napi(ts_arg_type = "((err: Error | null, req: JsIdentifyRequest) => void) | undefined")]
    on_identify_request: Option<ThreadsafeFunction<JsIdentifyRequest, ErrorStrategy::CalleeHandled>>,
  ) -> napi::Result<()> {
    guard_panic("GatewayCluster::start", || {
      let mut guard = self
        .supervisor
        .lock()
        .map_err(|_| Error::from_reason("GatewayCluster lock poisoned"))?;
      if guard.is_some() {
        return Err(Error::from_reason("GatewayCluster is already started"));
      }

      let gw_config = GatewayConfig {
        discord_token: config.discord_token,
        discord_intents: config.discord_intents.map_or(513, |v| v as u64),
        discord_shard_start: config.discord_shard_start.unwrap_or(0),
        discord_shard_end: config.discord_shard_end.unwrap_or(0),
        discord_total_shards: config.discord_total_shards.unwrap_or(1),
        fluxer_token: config.fluxer_token,
        fluxer_ws_url: config
          .fluxer_ws_url
          .unwrap_or_else(|| "wss://gateway.fluxer.com/?v=1&encoding=json".to_string()),
        fluxer_shard_start: config.fluxer_shard_start.unwrap_or(0),
        fluxer_shard_end: config.fluxer_shard_end.unwrap_or(0),
        fluxer_total_shards: config.fluxer_total_shards.unwrap_or(1),
        interest_mask: config.interest_mask.map(|v| v as u64),
      };

      let identify_cb = on_identify_request.map(|tsfn| {
        move |platform: String, shard_id: u32| {
          let _ = tsfn.call(
            Ok(JsIdentifyRequest { platform, shard_id }),
            ThreadsafeFunctionCallMode::NonBlocking,
          );
        }
      });

      let supervisor = with_runtime(|handle| {
        let _entered = handle.enter();
        GatewaySupervisor::start(
          gw_config,
          move |batch: GatewayBatch| {
            let js_batch = JsGatewayBatch {
              events: batch
                .events
                .into_iter()
                .map(|e| JsGatewayBatchEvent {
                  platform: e.platform,
                  shard_id: e.shard_id,
                  event_type: e.event_type,
                  raw_json: e.raw_json,
                })
                .collect(),
              dropped_count: batch.dropped_count as f64,
            };
            let _ = on_batch.call(Ok(js_batch), ThreadsafeFunctionCallMode::NonBlocking);
          },
          identify_cb,
        )
      })?;

      *guard = Some(supervisor);
      Ok(())
    })
  }

  #[napi]
  pub fn set_event_interest(&self, mask: f64) -> napi::Result<()> {
    guard_panic("GatewayCluster::setEventInterest", || {
      let guard = self
        .supervisor
        .lock()
        .map_err(|_| Error::from_reason("GatewayCluster lock poisoned"))?;
      if let Some(supervisor) = guard.as_ref() {
        supervisor.set_event_interest(mask as u64);
      }
      Ok(())
    })
  }

  #[napi]
  pub fn grant_identify(&self, platform: String, shard_id: u32) -> napi::Result<()> {
    guard_panic("GatewayCluster::grantIdentify", || {
      let guard = self
        .supervisor
        .lock()
        .map_err(|_| Error::from_reason("GatewayCluster lock poisoned"))?;
      if let Some(supervisor) = guard.as_ref() {
        with_runtime(|handle| {
          handle.block_on(supervisor.grant_identify(&platform, shard_id));
        })?;
      }
      Ok(())
    })
  }

  #[napi]
  pub fn stop(&self, timeout_ms: Option<u32>) -> napi::Result<()> {
    guard_panic("GatewayCluster::stop", || {
      let mut guard = self
        .supervisor
        .lock()
        .map_err(|_| Error::from_reason("GatewayCluster lock poisoned"))?;
      if let Some(supervisor) = guard.take() {
        let ms = u64::from(timeout_ms.unwrap_or(3000));
        with_runtime(|handle| {
          handle.block_on(supervisor.stop(ms));
        })?;
      }
      Ok(())
    })
  }
}
