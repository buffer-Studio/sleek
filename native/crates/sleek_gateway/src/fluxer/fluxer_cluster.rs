use std::panic::AssertUnwindSafe;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures_util::{FutureExt, SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::value::RawValue;
use tokio::sync::watch;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message as WsMessage;

use crate::core::batch_pump::{BatchSender, GatewayBatchEvent};
use crate::core::event_flags::{is_fatal_close_code, should_forward};
use crate::core::identify_queue::IdentifyGate;

#[derive(Deserialize)]
struct FluxerEnvelope<'a> {
  op: u8,
  s: Option<u64>,
  t: Option<&'a str>,
  #[serde(borrow)]
  d: Option<&'a RawValue>,
}

#[derive(Deserialize)]
struct HelloData {
  heartbeat_interval: u64,
}

#[derive(Deserialize)]
struct ReadySession {
  session_id: Option<String>,
}

pub async fn run_fluxer_shard(
  token: String,
  ws_url: String,
  shard_id: u32,
  shard_total: u32,
  interest: Arc<AtomicU64>,
  identify_gate: IdentifyGate,
  sender: BatchSender,
  mut shutdown_rx: watch::Receiver<bool>,
) {
  let inner_sender = sender.clone();
  let fut = AssertUnwindSafe(async move {
    let sender = inner_sender;
    let mut session_id: Option<String> = None;
    let mut last_seq: Option<u64> = None;

    loop {
      if *shutdown_rx.borrow() {
        break;
      }

      if session_id.is_none() {
        identify_gate.request("fluxer", shard_id).await;
      }

      let conn = connect_async(&ws_url).await;
      let (ws_stream, _) = match conn {
        Ok(pair) => pair,
        Err(err) => {
          sender.push(GatewayBatchEvent {
            platform: "fluxer".to_string(),
            shard_id,
            event_type: "GATEWAY_CLOSED".to_string(),
            raw_json: format!(r#"{{"code":1006,"reason":{}}}"#, serde_json::to_string(&err.to_string()).unwrap_or_else(|_| "\"connect error\"".to_string())),
          }).await;
          tokio::time::sleep(Duration::from_secs(3)).await;
          continue;
        }
      };

      let (mut write, mut read) = ws_stream.split();
      let mut heartbeat_interval = tokio::time::interval(Duration::from_secs(30));
      let mut heartbeat_armed = false;

      loop {
        tokio::select! {
          changed = shutdown_rx.changed() => {
            if changed.is_ok() && *shutdown_rx.borrow() {
              let _ = write.send(WsMessage::Close(None)).await;
              return;
            }
          }
          _ = heartbeat_interval.tick(), if heartbeat_armed => {
            let hb = match last_seq {
              Some(seq) => format!(r#"{{"op":1,"d":{}}}"#, seq),
              None => r#"{"op":1,"d":null}"#.to_string(),
            };
            if write.send(WsMessage::Text(hb.into())).await.is_err() {
              break;
            }
          }
          msg = read.next() => {
            match msg {
              Some(Ok(WsMessage::Text(text))) => {
                if let Ok(env) = serde_json::from_str::<FluxerEnvelope<'_>>(&text) {
                  if let Some(seq) = env.s {
                    last_seq = Some(seq);
                  }
                  match env.op {
                    10 => {
                      if let Some(raw_d) = env.d {
                        if let Ok(hello) = serde_json::from_str::<HelloData>(raw_d.get()) {
                          heartbeat_interval = tokio::time::interval(Duration::from_millis(hello.heartbeat_interval.max(1000)));
                          heartbeat_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                          heartbeat_armed = true;
                        }
                      }
                      let handshake = if let (Some(sid), Some(seq)) = (&session_id, last_seq) {
                        serde_json::json!({
                          "op": 6,
                          "d": {
                            "token": token,
                            "session_id": sid,
                            "seq": seq
                          }
                        })
                      } else {
                        serde_json::json!({
                          "op": 2,
                          "d": {
                            "token": token,
                            "properties": {
                              "os": std::env::consts::OS,
                              "browser": "sleek",
                              "device": "sleek"
                            },
                            "shard": [shard_id, shard_total],
                            "ignored_events": ["TYPING_START", "PRESENCE_UPDATE"]
                          }
                        })
                      };
                      if write.send(WsMessage::Text(handshake.to_string().into())).await.is_err() {
                        break;
                      }
                    }
                    0 => {
                      if let Some(event_type) = env.t {
                        if event_type == "READY" {
                          if let Some(raw_d) = env.d {
                            if let Ok(ready) = serde_json::from_str::<ReadySession>(raw_d.get()) {
                              if ready.session_id.is_some() {
                                session_id = ready.session_id;
                              }
                            }
                          }
                        }
                        if should_forward(event_type, interest.load(Ordering::Relaxed)) {
                          let raw_json = env.d.map_or_else(|| "{}".to_string(), |d| d.get().to_string());
                          sender.push(GatewayBatchEvent {
                            platform: "fluxer".to_string(),
                            shard_id,
                            event_type: event_type.to_string(),
                            raw_json,
                          }).await;
                        }
                      }
                    }
                    7 => break,
                    9 => {
                      session_id = None;
                      last_seq = None;
                      break;
                    }
                    _ => {}
                  }
                }
              }
              Some(Ok(WsMessage::Close(frame))) => {
                let (code, reason) = frame.map_or((1000, String::new()), |f| (f.code.into(), f.reason.to_string()));
                let fatal = is_fatal_close_code(code);
                let event_type = if fatal { "GATEWAY_FATAL_CLOSE" } else { "GATEWAY_CLOSED" };
                sender.push(GatewayBatchEvent {
                  platform: "fluxer".to_string(),
                  shard_id,
                  event_type: event_type.to_string(),
                  raw_json: format!(r#"{{"code":{},"reason":{}}}"#, code, serde_json::to_string(&reason).unwrap_or_else(|_| "\"\"".to_string())),
                }).await;
                if fatal {
                  return;
                }
                break;
              }
              Some(Err(_)) | None => break,
              _ => {}
            }
          }
        }
      }

      if *shutdown_rx.borrow() {
        break;
      }
      tokio::time::sleep(Duration::from_secs(2)).await;
    }
  });

  if let Err(_panic) = fut.catch_unwind().await {
    sender
      .push(GatewayBatchEvent {
        platform: "fluxer".to_string(),
        shard_id,
        event_type: "GATEWAY_CLOSED".to_string(),
        raw_json: r#"{"code":1011,"reason":"rust fluxer task panicked"}"#.to_string(),
      })
      .await;
  }
}
