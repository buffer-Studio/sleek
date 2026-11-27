use std::panic::AssertUnwindSafe;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures_util::{FutureExt, StreamExt};
use serde::Deserialize;
use serde_json::value::RawValue;
use tokio::sync::watch;
use twilight_gateway::{CloseFrame, Config, Intents, Message, Shard, ShardId};

use crate::core::batch_pump::{BatchSender, GatewayBatchEvent};
use crate::core::event_flags::{is_fatal_close_code, should_forward};
use crate::core::identify_queue::IdentifyGate;

#[derive(Deserialize)]
struct OuterEnvelope<'a> {
  op: u8,
  t: Option<&'a str>,
  #[serde(borrow)]
  d: Option<&'a RawValue>,
}

pub async fn run_discord_shard(
  token: String,
  shard_id: u32,
  shard_total: u32,
  intents_bits: u64,
  interest: Arc<AtomicU64>,
  identify_gate: IdentifyGate,
  sender: BatchSender,
  mut shutdown_rx: watch::Receiver<bool>,
) {
  let inner_sender = sender.clone();
  let fut = AssertUnwindSafe(async move {
    let sender = inner_sender;
    let intents = Intents::from_bits_truncate(intents_bits);
    let config = Config::new(token, intents);
    let mut shard = Shard::with_config(ShardId::new(shard_id, shard_total), config);

    identify_gate.request("discord", shard_id).await;

    loop {
      tokio::select! {
        changed = shutdown_rx.changed() => {
          if changed.is_ok() && *shutdown_rx.borrow() {
            shard.close(CloseFrame::NORMAL);
            break;
          }
        }
        item = shard.next() => {
          match item {
            Some(Ok(Message::Text(text))) => {
              if let Ok(env) = serde_json::from_str::<OuterEnvelope<'_>>(&text) {
                if env.op == 0 {
                  if let Some(event_type) = env.t {
                    if should_forward(event_type, interest.load(Ordering::Relaxed)) {
                      let raw_json = env.d.map_or_else(|| "{}".to_string(), |d| d.get().to_string());
                      sender.push(GatewayBatchEvent {
                        platform: "discord".to_string(),
                        shard_id,
                        event_type: event_type.to_string(),
                        raw_json,
                      }).await;
                    }
                  }
                } else if env.op == 9 {
                  // InvalidSession: request fresh IDENTIFY permission before re-identifying.
                  identify_gate.request("discord", shard_id).await;
                }
              }
            }
            Some(Ok(Message::Close(frame))) => {
              let (code, reason) = frame.map_or((1000, String::new()), |f| (f.code, f.reason.to_string()));
              let fatal = is_fatal_close_code(code);
              let event_type = if fatal { "GATEWAY_FATAL_CLOSE" } else { "GATEWAY_CLOSED" };
              sender.push(GatewayBatchEvent {
                platform: "discord".to_string(),
                shard_id,
                event_type: event_type.to_string(),
                raw_json: format!(r#"{{"code":{},"reason":{}}}"#, code, serde_json::to_string(&reason).unwrap_or_else(|_| "\"\"".to_string())),
              }).await;
              if fatal || *shutdown_rx.borrow() {
                break;
              }
              tokio::time::sleep(Duration::from_secs(2)).await;
            }
            Some(Err(err)) => {
              sender.push(GatewayBatchEvent {
                platform: "discord".to_string(),
                shard_id,
                event_type: "GATEWAY_CLOSED".to_string(),
                raw_json: format!(r#"{{"code":1006,"reason":{}}}"#, serde_json::to_string(&err.to_string()).unwrap_or_else(|_| "\"error\"".to_string())),
              }).await;
              tokio::time::sleep(Duration::from_secs(2)).await;
            }
            None => break,
          }
        }
      }
    }
  });

  if let Err(_panic) = fut.catch_unwind().await {
    sender
      .push(GatewayBatchEvent {
        platform: "discord".to_string(),
        shard_id,
        event_type: "GATEWAY_CLOSED".to_string(),
        raw_json: r#"{"code":1011,"reason":"rust shard task panicked"}"#.to_string(),
      })
      .await;
  }
}
