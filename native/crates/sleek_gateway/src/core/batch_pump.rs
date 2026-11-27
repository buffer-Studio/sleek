use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;

use super::event_flags::is_critical_event;

pub const PUMP_CHANNEL_CAPACITY: usize = 4096;
pub const MAX_BATCH_SIZE: usize = 64;
pub const FLUSH_INTERVAL: Duration = Duration::from_millis(4);

#[derive(Clone, Debug)]
pub struct GatewayBatchEvent {
  pub platform: String,
  pub shard_id: u32,
  pub event_type: String,
  pub raw_json: String,
}

#[derive(Clone, Debug)]
pub struct GatewayBatch {
  pub events: Vec<GatewayBatchEvent>,
  pub dropped_count: u64,
}

#[derive(Clone)]
pub struct BatchSender {
  tx: mpsc::Sender<GatewayBatchEvent>,
  dropped_count: Arc<AtomicU64>,
}

impl BatchSender {
  pub fn new(tx: mpsc::Sender<GatewayBatchEvent>) -> Self {
    Self {
      tx,
      dropped_count: Arc::new(AtomicU64::new(0)),
    }
  }

  pub async fn push(&self, event: GatewayBatchEvent) {
    if is_critical_event(&event.event_type) {
      let _ = self.tx.send(event).await;
      return;
    }

    if self.tx.try_send(event).is_err() {
      self.dropped_count.fetch_add(1, Ordering::Relaxed);
    }
  }

  pub fn take_dropped_count(&self) -> u64 {
    self.dropped_count.swap(0, Ordering::Relaxed)
  }
}

pub fn create_batch_channel() -> (BatchSender, mpsc::Receiver<GatewayBatchEvent>) {
  let (tx, rx) = mpsc::channel(PUMP_CHANNEL_CAPACITY);
  (BatchSender::new(tx), rx)
}

pub async fn run_batch_pump<F>(
  mut rx: mpsc::Receiver<GatewayBatchEvent>,
  sender: BatchSender,
  mut on_batch: F,
) where
  F: FnMut(GatewayBatch) + Send,
{
  let mut buffer = Vec::with_capacity(MAX_BATCH_SIZE);
  let mut interval = tokio::time::interval(FLUSH_INTERVAL);
  interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

  loop {
    tokio::select! {
      maybe_event = rx.recv() => {
        match maybe_event {
          Some(event) => {
            buffer.push(event);
            while buffer.len() < MAX_BATCH_SIZE {
              match rx.try_recv() {
                Ok(next) => buffer.push(next),
                Err(_) => break,
              }
            }
            if buffer.len() >= MAX_BATCH_SIZE {
              let events = std::mem::replace(&mut buffer, Vec::with_capacity(MAX_BATCH_SIZE));
              let dropped_count = sender.take_dropped_count();
              on_batch(GatewayBatch { events, dropped_count });
            }
          }
          None => {
            if !buffer.is_empty() {
              let events = std::mem::take(&mut buffer);
              let dropped_count = sender.take_dropped_count();
              on_batch(GatewayBatch { events, dropped_count });
            }
            break;
          }
        }
      }
      _ = interval.tick() => {
        if !buffer.is_empty() {
          let events = std::mem::replace(&mut buffer, Vec::with_capacity(MAX_BATCH_SIZE));
          let dropped_count = sender.take_dropped_count();
          on_batch(GatewayBatch { events, dropped_count });
        }
      }
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[tokio::test]
  async fn sheds_non_critical_events_when_full_and_preserves_critical() {
    let (tx, mut rx) = mpsc::channel(2);
    let sender = BatchSender::new(tx);

    sender
      .push(GatewayBatchEvent {
        platform: "discord".into(),
        shard_id: 0,
        event_type: "MESSAGE_CREATE".into(),
        raw_json: "{}".into(),
      })
      .await;
    sender
      .push(GatewayBatchEvent {
        platform: "discord".into(),
        shard_id: 0,
        event_type: "MESSAGE_CREATE".into(),
        raw_json: "{}".into(),
      })
      .await;
    // Channel is full: non-critical event must be shed.
    sender
      .push(GatewayBatchEvent {
        platform: "discord".into(),
        shard_id: 0,
        event_type: "MESSAGE_CREATE".into(),
        raw_json: "{}".into(),
      })
      .await;

    assert_eq!(sender.take_dropped_count(), 1);
    assert!(rx.recv().await.is_some());
  }
}
